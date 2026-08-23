#!/usr/bin/env python3
import json
import os
import sys
import subprocess
from companion.companion_app import load_config, save_config, run_command_in_shell
from companion.notes_manager import (
    create_note,
    get_note,
    delete_note,
    get_scratchpad,
    update_scratchpad,
    search_notes,
    generate_share_link,
)


class CmdBarDBusService:
    """
    Python D-Bus Service implementation for CmdBar.
    Exposes AddCommand, RemoveCommand, ExecuteCommand, GetCommands,
    GetNotes, GetNote, AddNote, DeleteNote, GetScratchpad, UpdateScratchpad,
    SearchNotes, ShareNoteLink, and manages signals.
    """

    def __init__(self, config_path=None):
        """
        Initializes the CmdBar D-Bus service.

        :param config_path: Optional custom path to config file.
        :visibility: public
        """
        self.config_path = config_path
        self._executed_listeners = []
        self._output_listeners = []

    def add_listener(self, on_executed=None, on_output=None):
        """
        Adds execution/output listeners for D-Bus signals.

        :param on_executed: Signal callback for executed command.
        :param on_output: Signal callback for command output.
        :visibility: public
        """
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
        """
        Gets list of commands serialized as JSON string.

        :returns: JSON string of commands list.
        :visibility: public
        """
        return json.dumps(self.get_commands())

    def get_notes(self) -> list:
        """
        Gets list of notes from config.

        :returns: List of note dicts.
        :visibility: public
        """
        config = load_config(self.config_path)
        return config.get("notes", [])

    def get_notes_json(self) -> str:
        """
        Gets list of notes serialized as JSON string.

        :returns: JSON string of notes list.
        :visibility: public
        """
        return json.dumps(self.get_notes())

    def get_note_json(self, note_id: str) -> str:
        """
        Gets single note by ID serialized as JSON string.

        :param note_id: Target note ID.
        :returns: JSON string of note or empty string.
        :visibility: public
        """
        notes = self.get_notes()
        note = get_note(notes, note_id)
        return json.dumps(note) if note else ""

    def add_note(self, title: str, content: str, tags_json: str = "[]") -> str:
        """
        Adds a new note and saves config.

        :param title: Note title string.
        :param content: Note content string.
        :param tags_json: JSON string of tags list.
        :returns: JSON string of created note or empty string on failure.
        :visibility: public
        """
        try:
            tags = json.loads(tags_json) if tags_json else []
        except Exception:
            tags = []

        config = load_config(self.config_path)
        notes = config.setdefault("notes", [])
        new_note = create_note(notes, title=title, content=content, tags=tags)
        if save_config(config, self.config_path):
            return json.dumps(new_note)
        return ""

    def delete_note(self, note_id: str) -> bool:
        """
        Deletes a note by ID and saves config.

        :param note_id: Target note ID.
        :returns: True if deleted and saved, False otherwise.
        :visibility: public
        """
        config = load_config(self.config_path)
        notes = config.get("notes", [])
        if delete_note(notes, note_id):
            return save_config(config, self.config_path)
        return False

    def get_scratchpad_json(self) -> str:
        """
        Gets scratchpad note serialized as JSON string.

        :returns: JSON string of scratchpad note.
        :visibility: public
        """
        config = load_config(self.config_path)
        notes = config.setdefault("notes", [])
        sp = get_scratchpad(notes)
        save_config(config, self.config_path)
        return json.dumps(sp)

    def update_scratchpad_json(self, content: str) -> str:
        """
        Updates scratchpad content and saves config.

        :param content: New scratchpad content.
        :returns: JSON string of updated scratchpad note.
        :visibility: public
        """
        config = load_config(self.config_path)
        notes = config.setdefault("notes", [])
        sp = update_scratchpad(notes, content)
        save_config(config, self.config_path)
        return json.dumps(sp)

    def search_notes_json(self, query: str) -> str:
        """
        Searches notes by query string and returns JSON array string.

        :param query: Search term or tag filter.
        :returns: JSON string of matching notes array.
        :visibility: public
        """
        notes = self.get_notes()
        results = search_notes(notes, query)
        return json.dumps(results)

    def share_note_link(self, note_id: str) -> str:
        """
        Generates shareable link for a note by ID.

        :param note_id: Target note ID.
        :returns: Shareable link string or empty string.
        :visibility: public
        """
        notes = self.get_notes()
        note = get_note(notes, note_id)
        if not note:
            return ""
        return generate_share_link(note)

