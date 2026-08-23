#!/usr/bin/env python3
import json
import os
import sys
import subprocess
from companion.companion_app import load_config, save_config, run_command_in_shell
from companion.iot_service import IoTTriggerManager

class CmdBarDBusService:
    """
    Python D-Bus Service implementation for CmdBar.
    Exposes AddCommand, RemoveCommand, ExecuteCommand, GetCommands,
    TriggerIoTEvent, GetIoTTriggers, RegisterIoTTrigger,
    and manages signals for CommandExecuted and CommandOutput.
    """
    def __init__(self, config_path=None):
        self.config_path = config_path
        self._executed_listeners = []
        self._output_listeners = []
        self.iot_manager = IoTTriggerManager(config_path=config_path, dbus_service=self)

    def add_listener(self, on_executed=None, on_output=None):
        if on_executed:
            self._executed_listeners.append(on_executed)
        if on_output:
            self._output_listeners.append(on_output)

    def add_command(self, name: str, command: str, category: str = "External") -> bool:
        if not name or not str(name).strip():
            return False
        if not command or not str(command).strip():
            return False

        cat_name = str(category).strip() if category and str(category).strip() else "External"
        config = load_config()
        categories = config.setdefault("categories", [])

        target_cat = None
        for cat in categories:
            if cat.get("name") == cat_name:
                target_cat = cat
                break

        if not target_cat:
            target_cat = {"name": cat_name, "commands": []}
            categories.append(target_cat)

        cmds = target_cat.setdefault("commands", [])
        clean_name = str(name).strip()
        clean_cmd = str(command).strip()

        existing = None
        for c in cmds:
            if c.get("name") == clean_name:
                existing = c
                break

        if existing:
            existing["template"] = clean_cmd
            existing["command"] = clean_cmd
        else:
            cmds.append({"name": clean_name, "template": clean_cmd, "command": clean_cmd})

        return save_config(config)

    def remove_command(self, name: str) -> bool:
        if not name or not str(name).strip():
            return False
        clean_name = str(name).strip()
        config = load_config()
        categories = config.get("categories", [])

        removed = False
        for cat in categories:
            cmds = cat.get("commands", [])
            init_len = len(cmds)
            cat["commands"] = [c for c in cmds if c.get("name") != clean_name]
            if len(cat["commands"]) < init_len:
                removed = True

        if removed:
            save_config(config)
        return removed

    def execute_command(self, name: str) -> bool:
        if not name or not str(name).strip():
            return False
        clean_name = str(name).strip()
        config = load_config()

        found_cmd = None
        for cat in config.get("categories", []):
            for c in cat.get("commands", []):
                if c.get("name") == clean_name or c.get("template") == clean_name or c.get("command") == clean_name:
                    found_cmd = c
                    break
            if found_cmd:
                break

        cmd_name = found_cmd.get("name") if found_cmd else clean_name
        cmd_str = found_cmd.get("template", found_cmd.get("command", clean_name)) if found_cmd else clean_name

        code, stdout, stderr = run_command_in_shell(cmd_str)
        success = (code == 0)

        for listener in self._output_listeners:
            try:
                listener(cmd_name, stdout, stderr)
            except Exception:
                pass

        for listener in self._executed_listeners:
            try:
                listener(cmd_name, code, success)
            except Exception:
                pass

        return True

    def get_commands(self) -> list:
        config = load_config()
        all_cmds = []
        for cat in config.get("categories", []):
            cat_name = cat.get("name", "")
            for c in cat.get("commands", []):
                all_cmds.append({
                    "name": c.get("name", ""),
                    "command": c.get("template", c.get("command", "")),
                    "category": cat_name,
                    "placeholder": c.get("placeholder", ""),
                    "parameters": c.get("parameters", {})
                })
        return all_cmds

    def get_commands_json(self) -> str:
        return json.dumps(self.get_commands())

    def trigger_iot_event(self, source: str, topic_or_endpoint: str, payload_json: str) -> bool:
        """
        Triggers an IoT event via D-Bus from MQTT, Webhooks, or Home Automation sources.
        :visibility: public
        """
        if not source or not topic_or_endpoint:
            return False
        
        src = str(source).lower().strip()
        endpoint = str(topic_or_endpoint).strip()
        
        try:
            payload = json.loads(payload_json) if payload_json and str(payload_json).strip().startswith(("{", "[")) else (payload_json or "")
        except Exception:
            payload = payload_json or ""

        if src in ("mqtt", "broker"):
            res = self.iot_manager.process_mqtt_message(endpoint, payload)
        elif src in ("webhook", "http"):
            res = self.iot_manager.process_webhook_request(endpoint, {}, payload)
        elif src in ("homeassistant", "ha", "openhab"):
            res = self.iot_manager.process_home_assistant_event(payload if isinstance(payload, dict) else {"command": payload})
        elif src in ("sensor", "telemetry"):
            triggered = self.iot_manager.evaluate_sensor_telemetry(endpoint, payload)
            res = {"success": True, "triggers": triggered}
        else:
            res = self.iot_manager.execute_command_with_safety(endpoint, payload if isinstance(payload, dict) else {})

        return bool(res.get("success", False))

    def get_iot_triggers(self) -> list:
        """
        Returns list of registered sensor rules and IoT triggers.
        :visibility: public
        """
        return self.iot_manager.get_sensor_rules()

    def register_iot_trigger(self, trigger_json: str) -> bool:
        """
        Registers a new IoT sensor trigger rule from JSON string.
        :visibility: public
        """
        try:
            data = json.loads(trigger_json)
            if not isinstance(data, dict):
                return False
            return self.iot_manager.register_sensor_rule(
                sensor_id=data.get("sensor_id", "*"),
                metric=data.get("metric", "value"),
                operator=data.get("operator", "=="),
                threshold=data.get("threshold"),
                command_name=data.get("command_name"),
                parameters=data.get("parameters", {}),
                cooldown_seconds=data.get("cooldown_seconds", 10.0),
                persist=True
            )
        except Exception:
            return False
