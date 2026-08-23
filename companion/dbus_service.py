#!/usr/bin/env python3
import json
import os
import sys
import subprocess
from companion.companion_app import load_config, save_config, run_command_in_shell
from companion.screenshot_service import ScreenshotService, annotate_image, generate_share_url, strip_metadata

class CmdBarDBusService:
    """
    Python D-Bus Service implementation for CmdBar.
    Exposes AddCommand, RemoveCommand, ExecuteCommand, GetCommands, CaptureScreenshot,
    and manages signals for CommandExecuted and CommandOutput.
    """
    def __init__(self, config_path=None):
        self.config_path = config_path
        self._executed_listeners = []
        self._output_listeners = []
        self._screenshot_service = ScreenshotService(config_path=config_path)

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

    def capture_screenshot(
        self,
        mode: str = "fullscreen",
        save_path: str = "",
        copy_to_clipboard: bool = True,
        annotate_json: str = "",
        share: bool = False,
        strip_meta: bool = True
    ) -> str:
        """
        D-Bus handler for CaptureScreenshot.
        """
        annotate = []
        if annotate_json:
            try:
                annotate = json.loads(annotate_json)
            except Exception:
                pass

        res = self._screenshot_service.capture(
            mode=mode,
            save_path=save_path or None,
            copy_to_clipboard=copy_to_clipboard,
            annotate=annotate,
            share=share,
            strip_meta=strip_meta
        )
        return json.dumps(res)

    def annotate_screenshot(self, image_base64: str, annotate_json: str) -> str:
        """
        D-Bus handler for AnnotateScreenshot.
        """
        annotate = []
        if annotate_json:
            try:
                annotate = json.loads(annotate_json)
            except Exception:
                pass
        sample_bytes = image_base64.encode('utf-8') if isinstance(image_base64, str) else b''
        annotated_bytes, count, lst = annotate_image(sample_bytes, annotate)
        return json.dumps({"success": True, "annotations_applied": count, "annotations_list": lst})

    def upload_screenshot(self, image_base64: str, options_json: str) -> str:
        """
        D-Bus handler for UploadScreenshot.
        """
        opts = {}
        if options_json:
            try:
                opts = json.loads(options_json)
            except Exception:
                pass
        service_url = opts.get("service_url", "https://cmdbar.share/upload")
        sample_bytes = image_base64.encode('utf-8') if isinstance(image_base64, str) else b''
        res = generate_share_url(sample_bytes, service_url=service_url)
        return json.dumps(res)

