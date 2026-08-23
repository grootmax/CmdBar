#!/usr/bin/env python3
import json
import os
import sys
import subprocess
import time
from companion.companion_app import load_config, save_config, run_command_in_shell
from companion.stream_deck import get_stream_deck_manager

class CmdBarDBusService:
    """
    Python D-Bus Service implementation for CmdBar.
    Exposes AddCommand, RemoveCommand, ExecuteCommand, GetCommands,
    Stream Deck integration APIs, and manages signals for CommandExecuted and CommandOutput.
    :visibility: public
    """
    def __init__(self, config_path=None):
        self.config_path = config_path
        self._executed_listeners = []
        self._output_listeners = []
        self.stream_deck_manager = get_stream_deck_manager(dbus_service=self)

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

        saved = save_config(config)
        if saved and self.stream_deck_manager:
            self.stream_deck_manager.load_profiles(config)
        return saved

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
            if self.stream_deck_manager:
                self.stream_deck_manager.load_profiles(config)
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

        start_time = time.perf_counter()
        code, stdout, stderr = run_command_in_shell(cmd_str)
        exec_ms = (time.perf_counter() - start_time) * 1000.0
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

        if self.stream_deck_manager:
            self.stream_deck_manager.update_command_feedback(cmd_name, code, success, exec_ms)

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

    def get_stream_deck_profiles(self) -> str:
        """Returns JSON string containing available Stream Deck profiles and active profile."""
        if self.stream_deck_manager:
            summary = self.stream_deck_manager.get_status_summary()
            return json.dumps({
                "active_profile": summary["active_profile"],
                "profiles": summary["available_profiles"]
            })
        return json.dumps({"active_profile": "Default", "profiles": ["Default"]})

    def set_stream_deck_profile(self, profile_name: str) -> bool:
        """Switches the active Stream Deck profile."""
        if self.stream_deck_manager:
            return self.stream_deck_manager.switch_profile(profile_name)
        return False

    def get_stream_deck_status(self) -> str:
        """Returns diagnostic status JSON summary for Stream Deck integration."""
        if self.stream_deck_manager:
            return json.dumps(self.stream_deck_manager.get_status_summary())
        return json.dumps({})

    def trigger_stream_deck_button(self, key_index: int) -> bool:
        """Simulates key press on active Stream Deck grid."""
        if self.stream_deck_manager:
            res = self.stream_deck_manager.handle_key_down("simulated_ctx", key_index)
            return res.get("status") in ("executed", "profile_switched")
        return False

