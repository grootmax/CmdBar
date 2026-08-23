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
    Mobile Companion endpoints, and manages signals for CommandExecuted and CommandOutput.
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

    def register_mobile_device(self, device_id: str, name: str, platform: str) -> str:
        dev = self.mobile_service.device_manager.register_device(device_id, name, platform)
        return json.dumps(dev)

    def get_mobile_quick_actions(self) -> str:
        actions = self.mobile_service.quick_action_manager.get_quick_actions()
        return json.dumps(actions)

    def execute_mobile_quick_action(
        self, device_id: str, action_id: str, params_json: str = "{}", biometric_token: str = ""
    ) -> str:
        try:
            params = json.loads(params_json) if params_json else {}
        except Exception:
            params = {}
        res = self.mobile_service.quick_action_manager.execute_quick_action(
            device_id, action_id, params=params, biometric_token=biometric_token or None
        )
        return json.dumps(res)

    def get_mobile_widget_data(self, widget_type: str = "all", device_id: str = "", size: str = "medium") -> str:
        data = self.mobile_service.widget_provider.get_widget_data(
            widget_type=widget_type, device_id=device_id or None, size=size
        )
        return json.dumps(data)

    def process_mobile_offline_queue(self) -> str:
        results = self.mobile_service.offline_queue.process_all_queued_requests()
        return json.dumps(results)
