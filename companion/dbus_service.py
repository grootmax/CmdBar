#!/usr/bin/env python3
import json
import os
import sys
import subprocess
from companion.companion_app import load_config, save_config, run_command_in_shell
from companion.notes import (
    create_note,
    search_notes,
    get_note_by_id,
    generate_share_link,
    parse_share_link,
)

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

    def get_notes(self) -> list:
        config = load_config()
        return config.get("notes", [])

    def get_notes_json(self) -> str:
        return json.dumps(self.get_notes())

    def add_note(self, title: str, content: str = "", tags_str: str = "", attached_command: str = None) -> dict:
        config = load_config()
        notes = config.setdefault("notes", [])

        tags = []
        if tags_str:
            try:
                tags = json.loads(tags_str)
            except Exception:
                tags = [t.strip() for t in str(tags_str).split(",") if t.strip()]

        note = create_note(
            title=title or "Untitled Note",
            content=content or "",
            tags=tags,
            attached_command=attached_command or None,
        )
        notes.append(note)
        save_config(config)
        return note

    def add_note_json(self, title: str, content: str = "", tags_str: str = "", attached_command: str = None) -> str:
        return json.dumps(self.add_note(title, content, tags_str, attached_command))

    def search_notes(self, query: str) -> list:
        config = load_config()
        return search_notes(config.get("notes", []), query)

    def search_notes_json(self, query: str) -> str:
        return json.dumps(self.search_notes(query))

    def share_note_link(self, note_id: str) -> str:
        config = load_config()
        note = get_note_by_id(config.get("notes", []), note_id)
        if not note:
            return ""
        return generate_share_link(note)

    def import_note_link(self, link: str) -> dict:
        imported = parse_share_link(link)
        if not imported:
            return {}
        config = load_config()
        notes = config.setdefault("notes", [])
        notes.append(imported)
        save_config(config)
        return imported

    def import_note_link_json(self, link: str) -> str:
        return json.dumps(self.import_note_link(link))
