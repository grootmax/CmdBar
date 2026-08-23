#!/usr/bin/env python3
import json
import os
import sys
import subprocess
from companion.companion_app import load_config, save_config, run_command_in_shell

class CmdBarDBusService:
    """
    Python D-Bus Service implementation for CmdBar.
    Exposes AddCommand, RemoveCommand, ExecuteCommand, GetCommands,
    and manages signals for CommandExecuted and CommandOutput.
    """
    def __init__(self, config_path=None):
        self.config_path = config_path
        self._executed_listeners = []
        self._output_listeners = []

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

    def get_numpad_layers(self) -> dict:
        config = load_config()
        numpad = config.get("numpad", {})
        if not numpad:
            from app.config_schema import DEFAULT_CONFIG
            numpad = DEFAULT_CONFIG["numpad"]
        else:
            if "enabled" not in numpad:
                numpad["enabled"] = True
            if "active_layer" not in numpad:
                numpad["active_layer"] = 0
            if "layers" not in numpad:
                from app.config_schema import DEFAULT_CONFIG
                numpad["layers"] = DEFAULT_CONFIG["numpad"]["layers"]
        return numpad

    def get_numpad_layers_json(self) -> str:
        return json.dumps(self.get_numpad_layers())

    def set_active_numpad_layer(self, layer_index: int) -> bool:
        config = load_config()
        numpad = config.setdefault("numpad", {})
        layers = numpad.get("layers", [])
        if not layers:
            from app.config_schema import DEFAULT_CONFIG
            numpad["layers"] = DEFAULT_CONFIG["numpad"]["layers"]
            layers = numpad["layers"]

        idx = int(layer_index)
        if idx < 0 or idx >= len(layers):
            idx = 0

        numpad["active_layer"] = idx
        save_config(config)

        layer_name = layers[idx].get("name", f"Layer {idx + 1}") if idx < len(layers) else f"Layer {idx + 1}"
        if hasattr(self, "_numpad_layer_listeners"):
            for listener in self._numpad_layer_listeners:
                try:
                    listener(idx, layer_name)
                except Exception:
                    pass

        return True

    def execute_numpad_key(self, key_index: int) -> bool:
        config = load_config()
        numpad = config.get("numpad", {})
        layers = numpad.get("layers", [])
        active_idx = numpad.get("active_layer", 0)

        if not layers or active_idx < 0 or active_idx >= len(layers):
            from app.config_schema import DEFAULT_CONFIG
            layers = DEFAULT_CONFIG["numpad"]["layers"]
            active_idx = 0

        active_layer = layers[active_idx]
        keys = active_layer.get("keys", {})
        k_str = str(key_index)

        key_info = keys.get(k_str) or keys.get(int(key_index))
        if not key_info:
            return False

        if isinstance(key_info, dict):
            cmd_name = key_info.get("name", f"Numpad {key_index}")
            cmd_str = key_info.get("command", "")
        else:
            cmd_name = f"Numpad {key_index}"
            cmd_str = str(key_info)

        if not cmd_str:
            return False

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

    def toggle_numpad_overlay(self) -> bool:
        return True
