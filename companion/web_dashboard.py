#!/usr/bin/env python3
"""
CmdBar Web Dashboard Backend HTTP Server and REST API.
Serves static Web UI dashboard assets and exposes configuration,
preview, team collaboration, and export/import REST APIs.
"""

import os
import json
import sys
import http.server
import socketserver
import threading
import webbrowser
from app.config_schema import (
    load_config,
    save_config,
    resolve_command_preview,
    validate_parameter_value,
)

DEFAULT_DASHBOARD_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "dashboard")
)

TEAM_PRESETS = {
    "DevOps": {
        "name": "DevOps & Infrastructure",
        "commands": [
            {
                "name": "Docker Logs",
                "command": "docker logs -f <container>",
                "mode": "shell-quoted",
                "parameters": {
                    "container": {
                        "regex": "^[a-zA-Z0-9_-]+$",
                        "placeholder": "e.g. app-web",
                    }
                },
            },
            {
                "name": "Kubectl Get Pods",
                "command": "kubectl get pods -n <namespace>",
                "mode": "shell-quoted",
                "parameters": {
                    "namespace": {
                        "regex": "^[a-zA-Z0-9_-]+$",
                        "placeholder": "e.g. default",
                    }
                },
            },
        ],
    },
    "Frontend": {
        "name": "Frontend Development",
        "commands": [
            {
                "name": "Run Dev Server",
                "command": "npm run dev",
                "mode": "shell-quoted",
            },
            {"name": "Run Unit Tests", "command": "npm test", "mode": "shell-quoted"},
            {
                "name": "Build Production Bundle",
                "command": "npm run build",
                "mode": "shell-quoted",
            },
        ],
    },
    "SRE": {
        "name": "SRE & System Diagnostics",
        "commands": [
            {
                "name": "Ping Endpoint",
                "command": "ping -c 4 <host>",
                "mode": "shell-quoted",
                "parameters": {
                    "host": {"regex": "^[a-zA-Z0-9.-]+$", "placeholder": "e.g. 8.8.8.8"}
                },
            },
            {"name": "Check Disk Usage", "command": "df -h", "mode": "shell-quoted"},
            {
                "name": "System Uptime & Load",
                "command": "uptime",
                "mode": "shell-quoted",
            },
        ],
    },
}


class CmdBarDashboardHandler(http.server.SimpleHTTPRequestHandler):
    """
    HTTP Request Handler serving Web Dashboard frontend and REST APIs.
    :visibility: public
    """

    def __init__(self, *args, directory=None, **kwargs):
        if directory is None:
            directory = DEFAULT_DASHBOARD_DIR
        super().__init__(*args, directory=directory, **kwargs)

    def do_GET(self):
        """
        Handles GET requests for static dashboard assets and REST APIs.
        :visibility: public
        """
        if self.path == "/api/config":
            cfg = load_config()
            self._send_json(cfg)
            return

        if self.path == "/api/team/presets":
            self._send_json(TEAM_PRESETS)
            return

        if self.path == "/api/status":
            self._send_json(
                {
                    "status": "online",
                    "version": "1.0.0",
                    "service": "CmdBar Web Dashboard",
                    "offline_capable": True,
                }
            )
            return

        if self.path == "/api/export":
            cfg = load_config()
            cfg["_export_timestamp"] = self.date_time_string()
            self._send_json(cfg)
            return

        return super().do_GET()

    def do_POST(self):
        """
        Handles POST requests for configuration saves, live preview calculations,
        team preset applications, and imports.
        :visibility: public
        """
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b""

        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except Exception:
            payload = {}

        if self.path == "/api/config":
            if not isinstance(payload, dict) or "categories" not in payload:
                self._send_json(
                    {"error": "Invalid configuration structure"}, status=400
                )
                return
            save_config(payload)
            self._send_json({"success": True, "message": "Configuration saved cleanly"})
            return

        if self.path == "/api/preview":
            template = payload.get("template", "")
            mode = payload.get("mode", "shell-quoted")
            param_values = payload.get("parameter_values", {})
            param_schemas = payload.get("parameters_schema", {})

            resolved, errors = resolve_command_preview(
                template, mode, param_values, param_schemas
            )
            self._send_json({"resolved": resolved, "errors": errors})
            return

        if self.path == "/api/team/collaborate":
            action = payload.get("action")
            if action == "apply_preset":
                preset_name = payload.get("preset_name")
                if preset_name in TEAM_PRESETS:
                    cfg = load_config()
                    preset = TEAM_PRESETS[preset_name]

                    # Merge preset
                    categories = cfg.setdefault("categories", [])
                    target_cat = next(
                        (c for c in categories if c.get("name") == preset["name"]), None
                    )
                    if not target_cat:
                        target_cat = {"name": preset["name"], "commands": []}
                        categories.append(target_cat)

                    for cmd in preset["commands"]:
                        if not any(
                            c.get("name") == cmd["name"] for c in target_cat["commands"]
                        ):
                            target_cat["commands"].append(cmd)

                    save_config(cfg)
                    self._send_json({"success": True, "config": cfg})
                    return
                else:
                    self._send_json({"error": "Unknown team preset"}, status=400)
                    return

            self._send_json(
                {"success": True, "message": "Collaboration payload processed"}
            )
            return

        if self.path == "/api/import":
            if isinstance(payload, dict) and "categories" in payload:
                save_config(payload)
                self._send_json({"success": True, "message": "Import successful"})
            else:
                self._send_json({"error": "Invalid imported config JSON"}, status=400)
            return

        self._send_json({"error": "Endpoint not found"}, status=404)

    def _send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)


def start_dashboard_server(host="127.0.0.1", port=8080, open_browser=False):
    """
    Starts the CmdBar Web Dashboard HTTP server.
    :param host: Host IP address to bind (default: 127.0.0.1)
    :param port: TCP port number (default: 8080)
    :param open_browser: Automatically launch default web browser
    :returns: socketserver.TCPServer instance
    :visibility: public
    """
    handler_factory = lambda *args, **kwargs: CmdBarDashboardHandler(
        *args, directory=DEFAULT_DASHBOARD_DIR, **kwargs
    )

    # Allow port reuse
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer((host, port), handler_factory)

    url = f"http://{host}:{port}/"
    print(f"\n=============================================")
    print(f"CmdBar Web Dashboard running at: {url}")
    print(f"=============================================\n")

    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    return httpd


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="CmdBar Web Dashboard Server")
    parser.add_argument(
        "--port", type=int, default=8080, help="Port to run dashboard server on"
    )
    parser.add_argument(
        "--host", type=str, default="127.0.0.1", help="Host address to bind"
    )
    parser.add_argument("--open", action="store_true", help="Open browser on start")
    args = parser.parse_args()

    httpd = start_dashboard_server(
        host=args.host, port=args.port, open_browser=args.open
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down CmdBar Web Dashboard server...")
        httpd.server_close()
