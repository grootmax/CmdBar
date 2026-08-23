#!/usr/bin/env python3
import json
import os
import sys
import uuid
import subprocess
from companion.companion_app import load_config, save_config, run_command_in_shell
from app.cron_scheduler import CronScheduler, is_valid_cron_expression

class CmdBarDBusService:
    """
    Python D-Bus Service implementation for CmdBar.
    Exposes AddCommand, RemoveCommand, ExecuteCommand, GetCommands,
    AddSchedule, RemoveSchedule, GetSchedules, RunScheduleNow,
    and manages signals for CommandExecuted, CommandOutput, and ScheduleExecuted.
    """
    def __init__(self, config_path=None):
        self.config_path = config_path
        self._executed_listeners = []
        self._output_listeners = []
        self._schedule_executed_listeners = []
        self.scheduler = CronScheduler(config_path=config_path)

    def add_listener(self, on_executed=None, on_output=None, on_schedule_executed=None):
        if on_executed:
            self._executed_listeners.append(on_executed)
        if on_output:
            self._output_listeners.append(on_output)
        if on_schedule_executed:
            self._schedule_executed_listeners.append(on_schedule_executed)

    def _load_config(self):
        if self.config_path:
            return load_config(self.config_path)
        return load_config()

    def _save_config(self, config):
        if self.config_path:
            return save_config(config, self.config_path)
        return save_config(config)

    def add_command(self, name: str, command: str, category: str = "External") -> bool:
        if not name or not str(name).strip():
            return False
        if not command or not str(command).strip():
            return False

        cat_name = str(category).strip() if category and str(category).strip() else "External"
        config = self._load_config()
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

        return self._save_config(config)

    def remove_command(self, name: str) -> bool:
        if not name or not str(name).strip():
            return False
        clean_name = str(name).strip()
        config = self._load_config()
        categories = config.get("categories", [])

        removed = False
        for cat in categories:
            cmds = cat.get("commands", [])
            init_len = len(cmds)
            cat["commands"] = [c for c in cmds if c.get("name") != clean_name]
            if len(cat["commands"]) < init_len:
                removed = True

        if removed:
            self._save_config(config)
        return removed

    def execute_command(self, name: str) -> bool:
        if not name or not str(name).strip():
            return False
        clean_name = str(name).strip()
        config = self._load_config()

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
        config = self._load_config()
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

    def get_schedules(self) -> list:
        config = self._load_config()
        return config.get("schedules", [])

    def get_schedules_json(self) -> str:
        return json.dumps(self.get_schedules())

    def add_schedule(self, s_id: str, name: str, command: str, schedule: str, timezone: str = "Local", prevent_overlap: bool = True) -> bool:
        if not name or not str(name).strip():
            return False
        if not command or not str(command).strip():
            return False
        if not schedule or not is_valid_cron_expression(schedule):
            return False

        config = self._load_config()
        schedules = config.setdefault("schedules", [])
        clean_id = str(s_id).strip() if s_id and str(s_id).strip() else str(uuid.uuid4())
        clean_name = str(name).strip()

        sched_obj = {
            "id": clean_id,
            "name": clean_name,
            "command": str(command).strip(),
            "schedule": str(schedule).strip(),
            "timezone": str(timezone).strip() if timezone else "Local",
            "enabled": True,
            "prevent_overlap": bool(prevent_overlap),
            "email_reports": {"enabled": False, "recipients": [], "trigger": "on_failure"},
            "last_run": None,
            "next_run": None,
            "last_status": "never_run",
            "last_output": "",
            "last_error": ""
        }

        existing_idx = None
        for idx, s in enumerate(schedules):
            if s.get("id") == clean_id or s.get("name") == clean_name:
                existing_idx = idx
                break

        if existing_idx is not None:
            schedules[existing_idx] = sched_obj
        else:
            schedules.append(sched_obj)

        self.scheduler.set_schedules(schedules)
        return self._save_config(config)

    def remove_schedule(self, s_id_or_name: str) -> bool:
        if not s_id_or_name or not str(s_id_or_name).strip():
            return False
        clean_target = str(s_id_or_name).strip()
        config = self._load_config()
        schedules = config.get("schedules", [])

        init_len = len(schedules)
        new_schedules = [s for s in schedules if s.get("id") != clean_target and s.get("name") != clean_target]

        if len(new_schedules) < init_len:
            config["schedules"] = new_schedules
            self.scheduler.set_schedules(new_schedules)
            return self._save_config(config)
        return False

    def run_schedule_now(self, s_id_or_name: str) -> bool:
        if not s_id_or_name or not str(s_id_or_name).strip():
            return False
        res = self.scheduler.run_job_now(str(s_id_or_name).strip())
        success = res.get("status") == "success"

        for listener in self._schedule_executed_listeners:
            try:
                listener(str(s_id_or_name), res.get("exit_code", -1), success, res.get("status", "failed"))
            except Exception:
                pass

        return success

