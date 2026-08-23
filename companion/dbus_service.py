#!/usr/bin/env python3
import json
import os
import sys
import subprocess
from companion.companion_app import load_config, save_config, run_command_in_shell
from companion.event_triggers import EventTriggerEngine

class CmdBarDBusService:
    """
    Python D-Bus Service implementation for CmdBar.
    Exposes AddCommand, RemoveCommand, ExecuteCommand, GetCommands,
    TriggerEvent, GetTriggers, AddTrigger, RemoveTrigger,
    and manages signals for CommandExecuted, CommandOutput, and EventTriggered.
    :visibility: public
    """
    def __init__(self, config_path=None):
        self.config_path = config_path
        self._executed_listeners = []
        self._output_listeners = []
        self._event_triggered_listeners = []
        self.trigger_engine = EventTriggerEngine()

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

    def add_event_listener(self, on_event_triggered=None):
        if on_event_triggered:
            self._event_triggered_listeners.append(on_event_triggered)

    def trigger_event(self, event_type: str, payload_json: str = "{}") -> bool:
        """
        Triggers an event and processes matching triggers.
        :visibility: public
        """
        try:
            payload = json.loads(payload_json) if payload_json else {}
        except Exception:
            payload = {}

        def executor(cmd, params, context):
            return run_command_in_shell(cmd)

        results = self.trigger_engine.process_event(event_type, payload, command_executor=executor)
        for res in results:
            for listener in self._event_triggered_listeners:
                try:
                    listener(res["trigger_id"], event_type, res["command"], res["success"])
                except Exception:
                    pass
        return True

    def get_triggers(self) -> list:
        """
        Returns list of registered triggers.
        :visibility: public
        """
        return self.trigger_engine.get_triggers()

    def get_triggers_json(self) -> str:
        """
        Returns registered triggers as JSON string.
        :visibility: public
        """
        return json.dumps(self.get_triggers())

    def add_trigger(self, trigger_json: str) -> bool:
        """
        Adds a trigger from JSON string.
        :visibility: public
        """
        try:
            trig = json.loads(trigger_json)
            return self.trigger_engine.add_trigger(trig)
        except Exception:
            return False

    def remove_trigger(self, trigger_id: str) -> bool:
        """
        Removes a trigger by ID.
        :visibility: public
        """
        return self.trigger_engine.remove_trigger(trigger_id)
