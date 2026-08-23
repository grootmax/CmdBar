#!/usr/bin/env python3
import json
import subprocess
import shlex
import os
import sys

class CmdBarDBusClient:
    """
    Python client bindings for CmdBar D-Bus API.
    Enables external applications to dynamically manage and execute commands in CmdBar
    and listen to execution and output signals.
    """
    def __init__(self, bus_name="org.gnome.CmdBar", object_path="/org/gnome/CmdBar", interface_name="org.gnome.CmdBar", service=None):
        self.bus_name = bus_name
        self.object_path = object_path
        self.interface_name = interface_name
        self.service = service
        self._executed_callbacks = []
        self._output_callbacks = []

    def _call_method(self, method_name, *args):
        if self.service:
            import re
            snake_name = re.sub(r'(?<!^)(?=[A-Z])', '_', method_name).lower()
            if hasattr(self.service, snake_name):
                return getattr(self.service, snake_name)(*args)
            elif hasattr(self.service, method_name):
                return getattr(self.service, method_name)(*args)

        cmd = [
            "gdbus", "call",
            "--session",
            "--dest", self.bus_name,
            "--object-path", self.object_path,
            "--method", f"{self.interface_name}.{method_name}"
        ]
        for arg in args:
            if isinstance(arg, bool):
                cmd.append("true" if arg else "false")
            elif isinstance(arg, int):
                cmd.append(str(arg))
            else:
                cmd.append(shlex.quote(str(arg)))

        try:
            res = subprocess.run(" ".join(cmd), shell=True, capture_output=True, text=True, timeout=5)
            if res.returncode != 0:
                return False
            output = res.stdout.strip()
            if output.startswith("(") and output.endswith(")"):
                inner = output[1:-1].strip()
                if inner.endswith(","):
                    inner = inner[:-1].strip()
                if inner == "true":
                    return True
                elif inner == "false":
                    return False
                elif (inner.startswith("'") and inner.endswith("'")) or (inner.startswith('"') and inner.endswith('"')):
                    return inner[1:-1]
                return inner
            return output
        except Exception:
            return False

    def add_command(self, name: str, command: str, category: str = "External") -> bool:
        """Add or update a command dynamically in CmdBar."""
        res = self._call_method("AddCommand", name, command, category)
        return bool(res)

    def remove_command(self, name: str) -> bool:
        """Remove a command by name from CmdBar."""
        res = self._call_method("RemoveCommand", name)
        return bool(res)

    def execute_command(self, name: str) -> bool:
        """Execute a command by name or direct command string."""
        res = self._call_method("ExecuteCommand", name)
        return bool(res)

    def get_commands(self) -> list:
        """Retrieve all commands from CmdBar as a list of dictionaries."""
        res = self._call_method("GetCommands")
        if isinstance(res, list):
            return res
        if isinstance(res, str):
            try:
                clean_str = res
                if clean_str.startswith("'") and clean_str.endswith("'"):
                    clean_str = clean_str[1:-1]
                return json.loads(clean_str)
            except Exception:
                return []
        return []

    def register_mobile_device(self, device_id: str, name: str, platform: str, push_token: str = "") -> bool:
        """Register or pair a mobile device (iOS/Android) via D-Bus."""
        res = self._call_method("RegisterMobileDevice", device_id, name, platform, push_token)
        return bool(res)

    def get_mobile_devices(self) -> list:
        """Get list of paired mobile devices via D-Bus."""
        res = self._call_method("GetMobileDevices")
        if isinstance(res, list):
            return res
        if isinstance(res, str):
            try:
                clean_str = res
                if clean_str.startswith("'") and clean_str.endswith("'"):
                    clean_str = clean_str[1:-1]
                return json.loads(clean_str)
            except Exception:
                return []
        return []

    def get_mobile_widget_payload(self, platform: str = "ios", family: str = "medium") -> dict:
        """Get mobile widget payload dictionary via D-Bus."""
        res = self._call_method("GetMobileWidgetPayload", platform, family)
        if isinstance(res, dict):
            return res
        if isinstance(res, str):
            try:
                clean_str = res
                if clean_str.startswith("'") and clean_str.endswith("'"):
                    clean_str = clean_str[1:-1]
                return json.loads(clean_str)
            except Exception:
                return {}
        return {}

    def process_mobile_offline_queue(self, max_items: int = 50) -> list:
        """Process queued mobile offline actions via D-Bus."""
        res = self._call_method("ProcessMobileOfflineQueue", max_items)
        if isinstance(res, list):
            return res
        if isinstance(res, str):
            try:
                clean_str = res
                if clean_str.startswith("'") and clean_str.endswith("'"):
                    clean_str = clean_str[1:-1]
                return json.loads(clean_str)
            except Exception:
                return []
        return []

    def send_mobile_push_notification(self, device_id: str, title: str, body: str) -> bool:
        """Send a push notification to a registered device via D-Bus."""
        res = self._call_method("SendMobilePushNotification", device_id, title, body)
        return bool(res)


    def on_command_executed(self, callback):
        """Register callback for CommandExecuted signals: callback(name, exit_code, success)"""
        self._executed_callbacks.append(callback)
        if self.service and hasattr(self.service, "add_listener"):
            self.service.add_listener(on_executed=callback)

    def on_command_output(self, callback):
        """Register callback for CommandOutput signals: callback(name, stdout, stderr)"""
        self._output_callbacks.append(callback)
        if self.service and hasattr(self.service, "add_listener"):
            self.service.add_listener(on_output=callback)

    def emit_signal_executed(self, name: str, exit_code: int, success: bool):
        for cb in self._executed_callbacks:
            try:
                cb(name, exit_code, success)
            except Exception:
                pass

    def emit_signal_output(self, name: str, stdout: str, stderr: str):
        for cb in self._output_callbacks:
            try:
                cb(name, stdout, stderr)
            except Exception:
                pass
