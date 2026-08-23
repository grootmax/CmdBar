#!/usr/bin/env python3
import json
import os
import sys
import subprocess
from companion.companion_app import load_config, save_config, run_command_in_shell
from companion.system_monitor import SystemMonitor, collect_system_metrics

class CmdBarDBusService:
    """
    Python D-Bus Service implementation for CmdBar.
    Exposes AddCommand, RemoveCommand, ExecuteCommand, GetCommands,
    GetSystemMetrics, GetResourceMonitorCSV, SetResourceThresholds,
    and manages signals for CommandExecuted, CommandOutput, and HighResourceUsageAlert.
    """
    def __init__(self, config_path=None):
        self.config_path = config_path
        self._executed_listeners = []
        self._output_listeners = []
        self._alert_listeners = []
        self._system_monitor = SystemMonitor()

    def add_listener(self, on_executed=None, on_output=None, on_alert=None):
        if on_executed:
            self._executed_listeners.append(on_executed)
        if on_output:
            self._output_listeners.append(on_output)
        if on_alert:
            self._alert_listeners.append(on_alert)

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

    def get_system_metrics(self) -> dict:
        sample = collect_system_metrics()
        self._system_monitor.record_sample(sample)
        summary = self._system_monitor.format_menu_summary(sample)
        history = self._system_monitor.get_history()

        def notify_alert(title, msg, alert):
            for listener in self._alert_listeners:
                try:
                    listener(alert["resource"], alert["value"], alert["threshold"])
                except Exception:
                    pass

        alerts = self._system_monitor.check_and_notify(sample, notify_alert)
        return {
            "current": sample,
            "summary": summary,
            "history": history,
            "alerts": alerts
        }

    def get_system_metrics_json(self) -> str:
        return json.dumps(self.get_system_metrics())

    def get_resource_monitor_csv(self) -> str:
        if not self._system_monitor.get_history():
            self._system_monitor.record_sample()
        return self._system_monitor.export_to_csv()

    def set_resource_thresholds(self, json_or_dict) -> bool:
        try:
            if isinstance(json_or_dict, str):
                thresholds = json.loads(json_or_dict)
            else:
                thresholds = json_or_dict
            self._system_monitor.set_thresholds(thresholds)
            return True
        except Exception:
            return False

