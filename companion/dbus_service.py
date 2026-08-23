#!/usr/bin/env python3
import json
import os
import sys
import subprocess
from companion.companion_app import load_config, save_config, run_command_in_shell
from companion.mobile_companion import MobileCompanionService

class CmdBarDBusService:
    """
    Python D-Bus Service implementation for CmdBar.
    Exposes AddCommand, RemoveCommand, ExecuteCommand, GetCommands,
    mobile companion methods, and manages signals.
    :visibility: public
    """
    def __init__(self, config_path=None):
        self.config_path = config_path
        self._executed_listeners = []
        self._output_listeners = []
        self.mobile_service = MobileCompanionService()

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

    def register_mobile_device(self, device_id: str, name: str, platform: str, push_token: str = "") -> bool:
        """
        Registers a mobile device via D-Bus.
        :visibility: public
        """
        try:
            self.mobile_service.device_mgr.register_device(device_id, name, platform, push_token)
            self.mobile_service.save_config()
            return True
        except Exception:
            return False

    def get_mobile_devices(self) -> list:
        """
        Returns paired mobile devices list via D-Bus.
        :visibility: public
        """
        return self.mobile_service.device_mgr.list_devices()

    def get_mobile_devices_json(self) -> str:
        """
        Returns JSON string of paired mobile devices.
        :visibility: public
        """
        return json.dumps(self.get_mobile_devices())

    def get_mobile_widget_payload(self, platform: str = "ios", family: str = "medium") -> str:
        """
        Returns widget payload JSON string for mobile widgets.
        :visibility: public
        """
        payload = self.mobile_service.widget_mgr.get_widget_payload(
            platform=platform,
            widget_family=family,
            queue_count=self.mobile_service.queue_mgr.get_stats().get("queued", 0)
        )
        return json.dumps(payload)

    def process_mobile_offline_queue(self, max_items: int = 50) -> str:
        """
        Processes pending offline queue items and returns result JSON.
        :visibility: public
        """
        results = self.mobile_service.queue_mgr.process_queue(max_items=max_items)
        return json.dumps(results)

    def send_mobile_push_notification(self, device_id: str, title: str, body: str) -> bool:
        """
        Dispatches a push notification to a registered device.
        :visibility: public
        """
        try:
            self.mobile_service.push_mgr.send_push_notification(device_id, title, body)
            return True
        except Exception:
            return False

