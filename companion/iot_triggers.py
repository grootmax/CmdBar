#!/usr/bin/env python3
"""
CmdBar IoT Trigger Support Module
Provides MQTT topic subscription, Webhook listening, Home Automation bridge (Home Assistant),
and Sensor-based rules engine with debouncing and cooldown support.
"""

import json
import time
import re
import hmac
import hashlib
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from typing import Dict, Any, Optional, Callable, List, Tuple


class SensorTriggerEngine:
    """
    Evaluates sensor telemetry against user-defined trigger rules.
    Supports operators: '>', '<', '==', '!=', '>=', '<=', 'contains'.
    Includes cooldown / debounce window management per rule.
    :visibility: public
    """

    def __init__(self, rules: Optional[List[Dict[str, Any]]] = None):
        """
        Initialize the SensorTriggerEngine with a list of rule definitions.
        :visibility: public
        """
        self.rules: List[Dict[str, Any]] = rules or []
        self._last_triggered: Dict[str, float] = {}

    def set_rules(self, rules: List[Dict[str, Any]]) -> None:
        """
        Update the set of active sensor trigger rules.
        :visibility: public
        """
        self.rules = rules or []

    def evaluate_condition(
        self, operator: str, sensor_value: Any, target_value: Any
    ) -> bool:
        """
        Evaluates a single rule condition operator against a sensor value and target value.
        :visibility: public
        """
        op = str(operator).strip().lower()

        # String containment check
        if op == "contains":
            return str(target_value).lower() in str(sensor_value).lower()

        # Try numeric conversion for comparison operators
        try:
            num_sensor = float(sensor_value)
            num_target = float(target_value)

            if op in (">", "greater_than"):
                return num_sensor > num_target
            elif op in ("<", "less_than"):
                return num_sensor < num_target
            elif op in (">=", "greater_or_equal"):
                return num_sensor >= num_target
            elif op in ("<=", "less_or_equal"):
                return num_sensor <= num_target
            elif op in ("==", "eq", "equal"):
                return num_sensor == num_target
            elif op in ("!=", "neq", "not_equal"):
                return num_sensor != num_target
        except (ValueError, TypeError):
            pass

        # String fallback for equality
        if op in ("==", "eq", "equal"):
            return str(sensor_value).strip() == str(target_value).strip()
        elif op in ("!=", "neq", "not_equal"):
            return str(sensor_value).strip() != str(target_value).strip()

        return False

    def is_in_cooldown(self, rule_id: str, cooldown_seconds: float) -> bool:
        """
        Checks if a rule is currently within its cooldown/debounce period.
        :visibility: public
        """
        if cooldown_seconds <= 0:
            return False
        last_time = self._last_triggered.get(rule_id, 0.0)
        return (time.time() - last_time) < cooldown_seconds

    def process_sensor_reading(
        self, sensor_name: str, value: Any
    ) -> List[Dict[str, Any]]:
        """
        Processes an incoming sensor reading and returns all triggered rules that passed cooldown.
        :visibility: public
        """
        triggered = []
        now = time.time()

        for rule in self.rules:
            rule_sensor = rule.get("sensor_name") or rule.get("sensor")
            if (
                not rule_sensor
                or str(rule_sensor).strip().lower() != str(sensor_name).strip().lower()
            ):
                continue

            rule_id = rule.get("id") or f"{rule_sensor}_{rule.get('command')}"
            cooldown = float(
                rule.get("cooldown_seconds") or rule.get("cooldown") or 0.0
            )

            if self.is_in_cooldown(rule_id, cooldown):
                continue

            operator = rule.get("operator", "==")
            target_val = rule.get("value")

            if self.evaluate_condition(operator, value, target_val):
                self._last_triggered[rule_id] = now
                triggered.append(rule)

        return triggered


class HomeAutomationBridge:
    """
    Provides integration and discovery configuration for Home Automation platforms (Home Assistant, openHAB, Node-RED).
    :visibility: public
    """

    def __init__(
        self, platform: str = "homeassistant", discovery_prefix: str = "homeassistant"
    ):
        """
        Initialize the Home Automation Bridge.
        :visibility: public
        """
        self.platform = platform
        self.discovery_prefix = discovery_prefix

    def generate_ha_discovery_payload(
        self, command_name: str, topic_prefix: str = "cmdbar"
    ) -> Tuple[str, Dict[str, Any]]:
        """
        Generates Home Assistant MQTT Discovery topic and payload dictionary for a CmdBar shortcut.
        :visibility: public
        """
        sanitized_id = re.sub(r"[^a-zA-Z0-9_]", "_", command_name.lower().strip())
        discovery_topic = f"{self.discovery_prefix}/button/cmdbar_{sanitized_id}/config"

        payload = {
            "name": f"CmdBar {command_name}",
            "unique_id": f"cmdbar_btn_{sanitized_id}",
            "command_topic": f"{topic_prefix}/trigger/{command_name}",
            "availability_topic": f"{topic_prefix}/status",
            "payload_press": json.dumps({"command": command_name}),
            "device": {
                "identifiers": ["cmdbar_desktop_integration"],
                "name": "CmdBar System Controller",
                "model": "CmdBar IoT Bridge",
                "manufacturer": "CmdBar",
            },
        }
        return discovery_topic, payload

    def build_event_trigger(
        self, event_type: str, entity_id: str, action_command: str
    ) -> Dict[str, Any]:
        """
        Builds a structured home automation event trigger mapping object.
        :visibility: public
        """
        return {
            "event_type": event_type,
            "entity_id": entity_id,
            "command": action_command,
            "timestamp": time.time(),
        }


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    """
    Threaded HTTP Server for non-blocking handling of webhook requests.
    """

    daemon_threads = True


class WebhookRequestHandler(BaseHTTPRequestHandler):
    """
    HTTP Request Handler for CmdBar IoT Webhooks.
    Validates secret tokens, processes commands and sensor payloads.
    """

    server: "WebhookListenerServer"

    def log_message(self, format, *args):
        # Silence standard HTTP logging unless required
        pass

    def _send_json_response(self, code: int, data: Dict[str, Any]) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _verify_secret(self) -> bool:
        expected_secret = getattr(self.server, "secret", "") or ""
        if not expected_secret:
            return True

        provided_secret = self.headers.get("X-CmdBar-Secret", "")
        if not provided_secret:
            auth_header = self.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                provided_secret = auth_header[7:].strip()

        # Timing-safe constant time comparison
        return hmac.compare_digest(
            provided_secret.encode("utf-8"), expected_secret.encode("utf-8")
        )

    def do_GET(self):
        if self.path in ("/health", "/status"):
            self._send_json_response(
                200, {"status": "ok", "service": "CmdBar IoT Webhook Listener"}
            )
        else:
            self._send_json_response(404, {"error": "Endpoint not found"})

    def do_POST(self):
        if not self._verify_secret():
            self._send_json_response(
                401, {"error": "Unauthorized: Invalid or missing secret token"}
            )
            return

        content_length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"

        try:
            payload = json.loads(raw_body.decode("utf-8") or "{}")
        except Exception:
            self._send_json_response(400, {"error": "Invalid JSON payload"})
            return

        path = self.path.rstrip("/")

        # Webhook endpoint: /webhook/trigger or /webhook/trigger/<command_name>
        if path.startswith("/webhook/trigger") or path.startswith("/api/v1/trigger"):
            command_name = payload.get("command")
            if not command_name and path.count("/") >= 2:
                parts = path.split("/")
                if len(parts) >= 3 and parts[-1] not in ("trigger", "v1"):
                    command_name = parts[-1]

            if not command_name:
                self._send_json_response(
                    400, {"error": "Missing 'command' parameter in request"}
                )
                return

            args = payload.get("args", {})
            if not isinstance(args, dict):
                args = {}

            executor = getattr(self.server, "executor_callback", None)
            if executor:
                res = executor(command_name, args)
                if res.get("success", False):
                    self._send_json_response(200, res)
                else:
                    self._send_json_response(400, res)
            else:
                self._send_json_response(
                    200, {"status": "received", "command": command_name, "args": args}
                )

        # Sensor endpoint: /webhook/sensor or /api/v1/sensor
        elif path.startswith("/webhook/sensor") or path.startswith("/api/v1/sensor"):
            sensor_name = payload.get("sensor_name") or payload.get("sensor")
            sensor_val = payload.get("value") or payload.get("data")

            if not sensor_name:
                self._send_json_response(
                    400, {"error": "Missing 'sensor_name' parameter in request"}
                )
                return

            sensor_handler = getattr(self.server, "sensor_callback", None)
            if sensor_handler:
                triggered_rules = sensor_handler(sensor_name, sensor_val)
                self._send_json_response(
                    200,
                    {
                        "status": "processed",
                        "sensor_name": sensor_name,
                        "value": sensor_val,
                        "triggered_rules_count": len(triggered_rules),
                    },
                )
            else:
                self._send_json_response(
                    200,
                    {
                        "status": "received",
                        "sensor_name": sensor_name,
                        "value": sensor_val,
                    },
                )

        else:
            self._send_json_response(404, {"error": f"Unknown endpoint '{self.path}'"})


class WebhookListenerServer:
    """
    Manages background thread lifecycle for the Webhook HTTP Listener.
    :visibility: public
    """

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 8088,
        secret: str = "",
        executor_callback: Optional[Callable] = None,
        sensor_callback: Optional[Callable] = None,
    ):
        """
        Initialize the Webhook Listener Server.
        :visibility: public
        """
        self.host = host
        self.port = port
        self.secret = secret
        self.executor_callback = executor_callback
        self.sensor_callback = sensor_callback
        self._httpd: Optional[ThreadedHTTPServer] = None
        self._thread: Optional[threading.Thread] = None

    def start(self) -> bool:
        """
        Starts the HTTP server on a background daemon thread.
        :visibility: public
        """
        try:
            self._httpd = ThreadedHTTPServer(
                (self.host, self.port), WebhookRequestHandler
            )
            self._httpd.secret = self.secret  # type: ignore
            self._httpd.executor_callback = self.executor_callback  # type: ignore
            self._httpd.sensor_callback = self.sensor_callback  # type: ignore

            self._thread = threading.Thread(
                target=self._httpd.serve_forever, daemon=True
            )
            self._thread.start()
            return True
        except Exception as e:
            print(f"Failed to start Webhook listener on {self.host}:{self.port}: {e}")
            return False

    def stop(self) -> None:
        """
        Stops and shuts down the HTTP server.
        :visibility: public
        """
        if self._httpd:
            try:
                self._httpd.shutdown()
                self._httpd.server_close()
            except Exception:
                pass
            self._httpd = None


class MQTTTriggerHandler:
    """
    MQTT client wrapper handling connection, topic subscriptions, message routing,
    and publishing execution responses.
    :visibility: public
    """

    def __init__(
        self,
        host: str = "localhost",
        port: int = 1883,
        topic_prefix: str = "cmdbar",
        username: str = "",
        password: str = "",
        executor_callback: Optional[Callable] = None,
        sensor_callback: Optional[Callable] = None,
    ):
        """
        Initialize the MQTT Trigger Handler.
        :visibility: public
        """
        self.host = host
        self.port = port
        self.topic_prefix = topic_prefix.rstrip("/")
        self.username = username
        self.password = password
        self.executor_callback = executor_callback
        self.sensor_callback = sensor_callback
        self._is_connected = False
        self._subscribed_topics: List[str] = []

    def build_topic(self, action: str, subtopic: str = "") -> str:
        """
        Builds a formatted MQTT topic under the configured prefix.
        :visibility: public
        """
        parts = [self.topic_prefix, action]
        if subtopic:
            parts.append(subtopic)
        return "/".join(parts)

    def parse_mqtt_message(self, topic: str, payload_str: str) -> Dict[str, Any]:
        """
        Parses an incoming MQTT message topic and payload string into a structured trigger dict.
        :visibility: public
        """
        prefix_pattern = re.escape(self.topic_prefix) + r"/(trigger|sensor)(?:/(.+))?"
        match = re.match(prefix_pattern, topic)

        action_type = match.group(1) if match else "trigger"
        subpath = match.group(2) if match else ""

        parsed_payload = {}
        if payload_str and payload_str.strip():
            try:
                parsed_payload = json.loads(payload_str)
            except Exception:
                parsed_payload = {"raw": payload_str}

        if action_type == "trigger":
            cmd_name = parsed_payload.get("command") or subpath or "Unknown"
            args = parsed_payload.get("args", {})
            return {"type": "trigger", "command": cmd_name, "args": args}
        else:
            sensor_name = parsed_payload.get("sensor_name") or subpath or "Unknown"
            val = parsed_payload.get("value", parsed_payload.get("data"))
            return {"type": "sensor", "sensor_name": sensor_name, "value": val}

    def process_message(self, topic: str, payload_str: str) -> Dict[str, Any]:
        """
        Processes an incoming MQTT message and executes the mapped command or sensor rule.
        :visibility: public
        """
        msg_data = self.parse_mqtt_message(topic, payload_str)

        if msg_data["type"] == "trigger":
            cmd = msg_data["command"]
            args = msg_data.get("args", {})
            if self.executor_callback:
                return self.executor_callback(cmd, args)
            return {"status": "received", "command": cmd}
        elif msg_data["type"] == "sensor":
            s_name = msg_data["sensor_name"]
            val = msg_data.get("value")
            if self.sensor_callback:
                triggered = self.sensor_callback(s_name, val)
                return {"status": "processed", "triggered_count": len(triggered)}
            return {"status": "received", "sensor_name": s_name, "value": val}

        return {"error": "Unknown action type"}


class IoTTriggerManager:
    """
    Central Manager for IoT Trigger integrations (MQTT, Webhook, Home Automation, Sensor Engine).
    :visibility: public
    """

    def __init__(
        self,
        config: Optional[Dict[str, Any]] = None,
        executor_callback: Optional[Callable] = None,
    ):
        """
        Initialize the IoT Trigger Manager with configuration and execution callback.
        :visibility: public
        """
        self.config = config or {}
        self.executor_callback = executor_callback
        self.sensor_engine = SensorTriggerEngine()
        self.ha_bridge = HomeAutomationBridge()
        self.webhook_server: Optional[WebhookListenerServer] = None
        self.mqtt_handler: Optional[MQTTTriggerHandler] = None
        self._active = False

        if self.config:
            self.reload_config(self.config)

    def _execute_command(
        self, command_name: str, args: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Executes a command via executor callback or local D-Bus bridge.
        """
        if self.executor_callback:
            try:
                res = self.executor_callback(command_name, args or {})
                if isinstance(res, dict):
                    return res
                return {
                    "success": bool(res),
                    "command": command_name,
                    "exit_code": 0 if res else 1,
                }
            except Exception as e:
                return {"success": False, "command": command_name, "error": str(e)}
        return {"success": True, "command": command_name, "status": "simulated"}

    def _handle_sensor_update(
        self, sensor_name: str, value: Any
    ) -> List[Dict[str, Any]]:
        """
        Evaluates sensor readings against trigger rules and executes satisfied commands.
        """
        triggered_rules = self.sensor_engine.process_sensor_reading(sensor_name, value)
        for rule in triggered_rules:
            cmd = rule.get("command")
            if cmd:
                cmd_args = rule.get("args", {})
                self._execute_command(cmd, cmd_args)
        return triggered_rules

    def reload_config(self, config: Dict[str, Any]) -> None:
        """
        Reloads configuration and restarts active listeners/bridges.
        :visibility: public
        """
        self.config = config or {}
        iot_cfg = self.config.get("iot", {})

        # 1. Sensor Trigger Engine rules
        sensor_rules = iot_cfg.get("sensor_triggers", [])
        self.sensor_engine.set_rules(sensor_rules)

        # 2. Home Automation Bridge settings
        ha_cfg = iot_cfg.get("home_automation", {})
        self.ha_bridge = HomeAutomationBridge(
            platform=ha_cfg.get("platform", "homeassistant"),
            discovery_prefix=ha_cfg.get("discovery_prefix", "homeassistant"),
        )

        # Stop existing services if running
        self.stop()

        if not iot_cfg.get("enabled", True):
            return

        # 3. Webhook Listener
        wh_cfg = iot_cfg.get("webhook", {})
        if wh_cfg.get("enabled", False):
            self.webhook_server = WebhookListenerServer(
                host=wh_cfg.get("host", "127.0.0.1"),
                port=int(wh_cfg.get("port", 8088)),
                secret=wh_cfg.get("secret", ""),
                executor_callback=self._execute_command,
                sensor_callback=self._handle_sensor_update,
            )
            self.webhook_server.start()

        # 4. MQTT Handler
        mqtt_cfg = iot_cfg.get("mqtt", {})
        if mqtt_cfg.get("enabled", False):
            self.mqtt_handler = MQTTTriggerHandler(
                host=mqtt_cfg.get("host", "localhost"),
                port=int(mqtt_cfg.get("port", 1883)),
                topic_prefix=mqtt_cfg.get("topic_prefix", "cmdbar"),
                username=mqtt_cfg.get("username", ""),
                password=mqtt_cfg.get("password", ""),
                executor_callback=self._execute_command,
                sensor_callback=self._handle_sensor_update,
            )

        self._active = True

    def start(self) -> None:
        """
        Starts all configured IoT trigger services.
        :visibility: public
        """
        if self.config:
            self.reload_config(self.config)

    def stop(self) -> None:
        """
        Stops all running IoT trigger services.
        :visibility: public
        """
        if self.webhook_server:
            self.webhook_server.stop()
            self.webhook_server = None
        self.mqtt_handler = None
        self._active = False
