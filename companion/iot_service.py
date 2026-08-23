#!/usr/bin/env python3
"""
IoT Trigger Service for CmdBar.
Provides MQTT message parsing, Webhook listening, Home Automation bridge,
and Sensor-based trigger rule evaluation with security validation.
"""

import json
import time
import os
import sys
import hmac
import hashlib
import re
import shlex
import threading
from urllib.parse import unquote
from http.server import HTTPServer, BaseHTTPRequestHandler
from companion.companion_app import (
    load_config,
    save_config,
    run_command_in_shell,
    validate_input,
    substitute_and_quote_command,
)


class SensorRule:
    """
    Represents a sensor-based trigger condition rule.
    """
    def __init__(
        self,
        sensor_id: str,
        metric: str,
        operator: str,
        threshold,
        command_name: str,
        parameters: dict = None,
        cooldown_seconds: float = 10.0,
    ):
        self.sensor_id = sensor_id
        self.metric = metric
        self.operator = operator.lower() if operator else "=="
        self.threshold = threshold
        self.command_name = command_name
        self.parameters = parameters or {}
        self.cooldown_seconds = float(cooldown_seconds) if cooldown_seconds is not None else 10.0
        self.last_triggered_at = 0.0

    def to_dict(self) -> dict:
        return {
            "sensor_id": self.sensor_id,
            "metric": self.metric,
            "operator": self.operator,
            "threshold": self.threshold,
            "command_name": self.command_name,
            "parameters": self.parameters,
            "cooldown_seconds": self.cooldown_seconds,
        }


class IoTTriggerManager:
    """
    IoT Trigger Manager supporting MQTT topics, HTTP Webhooks,
    Home Automation state/event bridges, and Sensor threshold rules.
    """

    def __init__(self, config_path=None, dbus_service=None, webhook_secret=None):
        """
        Initializes the IoT Trigger Manager.
        :visibility: public
        """
        self.config_path = config_path
        self.dbus_service = dbus_service
        self.webhook_secret = webhook_secret or os.environ.get("CMDBAR_WEBHOOK_SECRET")
        self.sensor_rules = []
        self.last_trigger_times = {}
        self._load_iot_config()

    def _load_iot_config(self):
        config = load_config()
        iot_cfg = config.get("iot", {})
        if not self.webhook_secret:
            self.webhook_secret = iot_cfg.get("webhook_secret")
        rules = iot_cfg.get("sensor_rules", [])
        self.sensor_rules = []
        for r in rules:
            if isinstance(r, dict):
                self.sensor_rules.append(
                    SensorRule(
                        sensor_id=r.get("sensor_id", "*"),
                        metric=r.get("metric", "value"),
                        operator=r.get("operator", "=="),
                        threshold=r.get("threshold"),
                        command_name=r.get("command_name"),
                        parameters=r.get("parameters", {}),
                        cooldown_seconds=r.get("cooldown_seconds", 10.0),
                    )
                )

    def register_sensor_rule(
        self,
        sensor_id: str,
        metric: str,
        operator: str,
        threshold,
        command_name: str,
        parameters: dict = None,
        cooldown_seconds: float = 10.0,
        persist: bool = True,
    ) -> bool:
        """
        Registers a new sensor rule and optionally persists it to config.
        :visibility: public
        """
        if not sensor_id or not command_name:
            return False

        rule = SensorRule(
            sensor_id=sensor_id,
            metric=metric,
            operator=operator,
            threshold=threshold,
            command_name=command_name,
            parameters=parameters,
            cooldown_seconds=cooldown_seconds,
        )
        self.sensor_rules.append(rule)

        if persist:
            config = load_config()
            iot_cfg = config.setdefault("iot", {})
            rules_cfg = iot_cfg.setdefault("sensor_rules", [])
            rules_cfg.append(rule.to_dict())
            save_config(config)

        return True

    def get_sensor_rules(self) -> list:
        """
        Returns list of registered sensor rules as dictionaries.
        :visibility: public
        """
        return [r.to_dict() for r in self.sensor_rules]

    def clear_sensor_rules(self):
        """
        Clears all in-memory sensor rules.
        :visibility: public
        """
        self.sensor_rules.clear()

    def set_webhook_secret(self, secret: str, persist: bool = True):
        """
        Sets the webhook secret token used for HMAC/token validation.
        :visibility: public
        """
        self.webhook_secret = secret
        if persist:
            config = load_config()
            iot_cfg = config.setdefault("iot", {})
            iot_cfg["webhook_secret"] = secret
            save_config(config)

    def execute_command_with_safety(self, command_name: str, parameters: dict = None) -> dict:
        """
        Finds target command, validates parameters against schema regex,
        constructs shell-quoted command, and executes it.
        :visibility: public
        """
        if not command_name or not str(command_name).strip():
            return {
                "success": False,
                "error": "Command name is required",
                "code": 400,
                "stdout": "",
                "stderr": "",
            }

        clean_cmd_name = str(command_name).strip()
        config = load_config()

        found_cmd = None
        for cat in config.get("categories", []):
            for c in cat.get("commands", []):
                if (
                    c.get("name") == clean_cmd_name
                    or c.get("template") == clean_cmd_name
                    or c.get("command") == clean_cmd_name
                ):
                    found_cmd = c
                    break
            if found_cmd:
                break

        if not found_cmd:
            return {
                "success": False,
                "error": f"Command '{clean_cmd_name}' not found in configuration",
                "code": 404,
                "stdout": "",
                "stderr": "",
            }

        template = found_cmd.get("template", found_cmd.get("command", ""))
        params_schema = found_cmd.get("parameters", {})
        provided_params = parameters or {}

        # Validate provided parameters against schema regexes
        validated_params = {}
        if isinstance(params_schema, dict):
            for param_key, param_cfg in params_schema.items():
                pattern = param_cfg.get("regex") if isinstance(param_cfg, dict) else None
                val = provided_params.get(param_key, "")
                if val is not None and str(val) != "":
                    str_val = str(val).strip()
                    if pattern and not validate_input(str_val, pattern):
                        return {
                            "success": False,
                            "error": f"Parameter '{param_key}' value '{str_val}' failed validation regex '{pattern}'",
                            "code": 422,
                            "stdout": "",
                            "stderr": "",
                        }
                    validated_params[param_key] = str_val
                elif isinstance(param_cfg, dict) and param_cfg.get("default") is not None:
                    validated_params[param_key] = str(param_cfg.get("default"))

        elif isinstance(params_schema, list):
            for param_cfg in params_schema:
                if isinstance(param_cfg, dict):
                    param_key = param_cfg.get("name")
                    pattern = param_cfg.get("regex")
                    if param_key and param_key in provided_params:
                        str_val = str(provided_params[param_key]).strip()
                        if pattern and not validate_input(str_val, pattern):
                            return {
                                "success": False,
                                "error": f"Parameter '{param_key}' value '{str_val}' failed validation regex '{pattern}'",
                                "code": 422,
                                "stdout": "",
                                "stderr": "",
                            }
                        validated_params[param_key] = str_val

        # Substitute parameters safely with shell quoting
        final_cmd = substitute_and_quote_command(template, validated_params)

        if self.dbus_service:
            # Execute through D-Bus service if attached
            res = self.dbus_service.execute_command(clean_cmd_name)
            return {
                "success": res,
                "command_name": clean_cmd_name,
                "executed_command": final_cmd,
                "code": 200 if res else 500,
                "stdout": "",
                "stderr": "",
            }

        exit_code, stdout, stderr = run_command_in_shell(final_cmd)
        success = exit_code == 0
        return {
            "success": success,
            "command_name": clean_cmd_name,
            "executed_command": final_cmd,
            "exit_code": exit_code,
            "stdout": stdout,
            "stderr": stderr,
            "code": 200 if success else 500,
        }

    def process_mqtt_message(self, topic: str, payload, qos: int = 0) -> dict:
        """
        Processes an incoming MQTT topic and payload.
        Supported topic conventions:
          - cmdbar/trigger/<command_name>
          - cmdbar/devices/<device_id>/telemetry
          - cmdbar/sensors/<sensor_id>
          - cmdbar/homeassistant/event
        :visibility: public
        """
        if not topic or not isinstance(topic, str):
            return {"success": False, "error": "Invalid topic", "code": 400}

        topic = topic.strip()
        data = {}
        if isinstance(payload, bytes):
            payload = payload.decode("utf-8", errors="ignore")
        if isinstance(payload, str) and payload.strip().startswith("{"):
            try:
                data = json.loads(payload)
            except Exception:
                data = {"raw_payload": payload}
        elif isinstance(payload, dict):
            data = payload
        else:
            data = {"raw_payload": str(payload)}

        parts = topic.split("/")

        # Direct trigger topic: cmdbar/trigger/<command_name>
        if len(parts) >= 3 and parts[0] == "cmdbar" and parts[1] == "trigger":
            cmd_name = "/".join(parts[2:])
            parameters = data.get("parameters") or data.get("params") or {}
            if not parameters and "raw_payload" in data and data["raw_payload"] != str(data):
                parameters = {"value": data["raw_payload"]}
            return self.execute_command_with_safety(cmd_name, parameters)

        # Telemetry / Sensor topic: cmdbar/sensors/<sensor_id> or cmdbar/devices/<device_id>/telemetry
        if (len(parts) >= 3 and parts[0] == "cmdbar" and parts[1] in ("sensors", "devices")) or "telemetry" in topic:
            sensor_id = parts[2] if len(parts) >= 3 else "mqtt_sensor"
            telemetry_data = data.get("telemetry") or data
            triggered_results = self.evaluate_sensor_telemetry(sensor_id, telemetry_data)
            return {
                "success": True,
                "type": "telemetry",
                "sensor_id": sensor_id,
                "rule_triggers": triggered_results,
                "code": 200,
            }

        # Home Assistant event topic: cmdbar/homeassistant/event
        if "homeassistant" in topic or "openhab" in topic:
            return self.process_home_assistant_event(data)

        # Explicit payload trigger: payload contains command field
        if "command" in data or "command_name" in data:
            cmd_name = data.get("command") or data.get("command_name")
            parameters = data.get("parameters") or data.get("params") or {}
            return self.execute_command_with_safety(cmd_name, parameters)

        return {
            "success": False,
            "error": f"Topic '{topic}' did not match any active MQTT trigger pattern",
            "code": 404,
        }

    def verify_webhook_auth(self, headers: dict, raw_payload: bytes or str) -> bool:
        """
        Verifies HTTP webhook authentication headers against the secret key using
        token matching or HMAC-SHA256 signature verification.
        :visibility: public
        """
        if not self.webhook_secret:
            return True  # If no secret configured, open access allowed

        headers_lower = {str(k).lower(): str(v) for k, v in (headers or {}).items()}

        # 1. Check X-CmdBar-Secret header
        provided_secret = headers_lower.get("x-cmdbar-secret")
        if provided_secret and hmac.compare_digest(provided_secret, self.webhook_secret):
            return True

        # 2. Check Authorization Bearer header
        auth_header = headers_lower.get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
            if hmac.compare_digest(token, self.webhook_secret):
                return True

        # 3. Check HMAC SHA256 Signature header (X-CmdBar-Signature or X-Hub-Signature-256)
        sig_header = headers_lower.get("x-cmdbar-signature") or headers_lower.get("x-hub-signature-256")
        if sig_header:
            if sig_header.startswith("sha256="):
                sig_header = sig_header[7:]
            if isinstance(raw_payload, str):
                raw_payload = raw_payload.encode("utf-8")
            elif raw_payload is None:
                raw_payload = b""
            expected_sig = hmac.new(
                self.webhook_secret.encode("utf-8"), raw_payload, hashlib.sha256
            ).hexdigest()
            if hmac.compare_digest(sig_header.lower(), expected_sig.lower()):
                return True

        return False

    def process_webhook_request(self, endpoint: str, headers: dict, payload) -> dict:
        """
        Processes an HTTP webhook POST request.
        :visibility: public
        """
        raw_bytes = b""
        if isinstance(payload, (bytes, bytearray)):
            raw_bytes = bytes(payload)
            try:
                payload_str = raw_bytes.decode("utf-8")
                payload_data = json.loads(payload_str)
            except Exception:
                payload_data = {}
        elif isinstance(payload, str):
            raw_bytes = payload.encode("utf-8")
            try:
                payload_data = json.loads(payload)
            except Exception:
                payload_data = {}
        elif isinstance(payload, dict):
            payload_data = payload
            raw_bytes = json.dumps(payload).encode("utf-8")
        else:
            payload_data = {}

        # Auth check
        if not self.verify_webhook_auth(headers, raw_bytes):
            return {
                "success": False,
                "error": "Unauthorized: Invalid or missing secret/signature",
                "code": 401,
            }

        endpoint = unquote(endpoint or "/").strip()

        # Check Home Assistant route
        if "/homeassistant" in endpoint or "/ha/event" in endpoint or "/openhab" in endpoint:
            return self.process_home_assistant_event(payload_data)

        # Check Sensor telemetry route
        if "/sensor" in endpoint or "/telemetry" in endpoint:
            sensor_id = payload_data.get("sensor_id") or payload_data.get("entity_id") or "webhook_sensor"
            telemetry = payload_data.get("telemetry") or payload_data.get("data") or payload_data
            triggered = self.evaluate_sensor_telemetry(sensor_id, telemetry)
            return {
                "success": True,
                "type": "sensor_telemetry",
                "sensor_id": sensor_id,
                "rule_triggers": triggered,
                "code": 200,
            }

        # General command trigger route
        cmd_name = payload_data.get("command") or payload_data.get("command_name")
        if not cmd_name and endpoint.startswith("/trigger/"):
            cmd_name = endpoint[9:]

        if not cmd_name:
            return {
                "success": False,
                "error": "Missing 'command' or 'command_name' in webhook payload",
                "code": 400,
            }

        parameters = payload_data.get("parameters") or payload_data.get("params") or {}
        return self.execute_command_with_safety(cmd_name, parameters)

    def process_home_assistant_event(self, event_data: dict) -> dict:
        """
        Translates Home Assistant / openHAB entity state changes and automation webhooks.
        :visibility: public
        """
        if not isinstance(event_data, dict):
            return {"success": False, "error": "Invalid event data format", "code": 400}

        # 1. Direct command action payload
        if "action" in event_data and event_data.get("action") in ("trigger_cmdbar", "execute_command", "run"):
            cmd_name = event_data.get("command") or event_data.get("name")
            params = event_data.get("parameters") or event_data.get("data") or {}
            return self.execute_command_with_safety(cmd_name, params)

        # 2. State change event
        event_type = event_data.get("event_type") or event_data.get("event")
        data = event_data.get("data") if isinstance(event_data.get("data"), dict) else event_data

        entity_id = data.get("entity_id") or event_data.get("entity_id")
        new_state = data.get("new_state") or data.get("state") or event_data.get("state")

        if entity_id:
            state_val = (
                new_state.get("state") if isinstance(new_state, dict) else str(new_state or "")
            )
            # Pass as telemetry event
            triggered = self.evaluate_sensor_telemetry(entity_id, {"state": state_val, "raw": data})
            
            # If explicit command mapped
            if "command" in data:
                res = self.execute_command_with_safety(data["command"], data.get("parameters", {}))
                triggered.append(res)

            return {
                "success": True,
                "entity_id": entity_id,
                "state": state_val,
                "rule_triggers": triggered,
                "code": 200,
            }

        # 3. Explicit command field
        if "command" in event_data or "command_name" in event_data:
            cmd_name = event_data.get("command") or event_data.get("command_name")
            params = event_data.get("parameters") or {}
            return self.execute_command_with_safety(cmd_name, params)

        return {
            "success": False,
            "error": "Could not extract Home Assistant entity_id or command from event payload",
            "code": 400,
        }

    def evaluate_sensor_telemetry(self, sensor_id: str, telemetry_data) -> list:
        """
        Evaluates registered sensor rules against incoming telemetry data,
        applying threshold comparison and cooldown deduplication.
        :visibility: public
        """
        results = []
        now = time.time()

        for rule in self.sensor_rules:
            if rule.sensor_id not in (sensor_id, "*"):
                continue

            # Cooldown check
            if (now - rule.last_triggered_at) < rule.cooldown_seconds:
                continue

            # Extract metric value
            val = None
            if isinstance(telemetry_data, dict):
                val = telemetry_data.get(rule.metric)
                if val is None and rule.metric == "state":
                    val = telemetry_data.get("value") or telemetry_data.get("val")
                if val is None and len(telemetry_data) == 1:
                    val = next(iter(telemetry_data.values()))
            else:
                val = telemetry_data

            if val is None:
                continue

            # Evaluate operator
            is_matched = self._evaluate_condition(val, rule.operator, rule.threshold)

            if is_matched:
                rule.last_triggered_at = now
                params = dict(rule.parameters)
                params["sensor_id"] = str(sensor_id)
                params["metric_value"] = str(val)

                res = self.execute_command_with_safety(rule.command_name, params)
                res["rule"] = rule.to_dict()
                results.append(res)

        return results

    def _evaluate_condition(self, val, operator: str, threshold) -> bool:
        try:
            op = operator.lower() if operator else "=="
            if op in (">", ">=", "<", "<="):
                num_val = float(val)
                num_thresh = float(threshold)
                if op == ">":
                    return num_val > num_thresh
                elif op == ">=":
                    return num_val >= num_thresh
                elif op == "<":
                    return num_val < num_thresh
                elif op == "<=":
                    return num_val <= num_thresh
            elif op in ("==", "eq"):
                return str(val).strip().lower() == str(threshold).strip().lower()
            elif op in ("!=", "ne"):
                return str(val).strip().lower() != str(threshold).strip().lower()
            elif op == "contains":
                return str(threshold).lower() in str(val).lower()
            elif op == "between" and isinstance(threshold, (list, tuple)) and len(threshold) == 2:
                num_val = float(val)
                return float(threshold[0]) <= num_val <= float(threshold[1])
        except (ValueError, TypeError):
            pass
        return False


class WebhookListenerServer:
    """
    HTTP Webhook Listener Server running on background thread.
    """

    def __init__(self, iot_manager: IoTTriggerManager, host: str = "127.0.0.1", port: int = 8088):
        self.iot_manager = iot_manager
        self.host = host
        self.port = port
        self.httpd = None
        self.thread = None

    def start(self):
        """
        Starts the HTTP Webhook listener server.
        :visibility: public
        """
        manager = self.iot_manager

        class WebhookHandler(BaseHTTPRequestHandler):
            def do_POST(self):
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length) if content_length > 0 else b""
                res = manager.process_webhook_request(self.path, dict(self.headers), body)

                code = res.get("code", 200)
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(res).encode("utf-8"))

            def log_message(self, format, *args):
                pass  # Suppress stdout logs during test execution

        self.httpd = HTTPServer((self.host, self.port), WebhookHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever)
        self.thread.daemon = True
        self.thread.start()

    def stop(self):
        """
        Stops the HTTP Webhook listener server.
        :visibility: public
        """
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
            self.httpd = None
