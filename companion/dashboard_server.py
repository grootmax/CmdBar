import os
import sys
import time
import json
import threading
import http.server
import socketserver
from urllib.parse import parse_qs, urlparse

# Ensure repository root is in sys.path
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from app.config_schema import (
    load_config,
    save_config,
    resolve_command_preview,
    validate_parameter_value,
    DEFAULT_CONFIG
)

DEFAULT_PORT = 8080
DASHBOARD_DIR = os.path.join(REPO_ROOT, "dashboard")

# Shared SSE event trigger for real-time team collaboration sync
collab_event = threading.Event()
latest_event_data = {"type": "init"}

def merge_configs_structural(local_cfg, remote_cfg):
    """
    Performs a 2-way structural merge of local and remote configurations.
    """
    local = json.loads(json.dumps(local_cfg))
    remote = json.loads(json.dumps(remote_cfg))

    if "categories" not in local or not isinstance(local["categories"], list):
        local["categories"] = []
    if "categories" not in remote or not isinstance(remote["categories"], list):
        remote["categories"] = []

    merged_cats = local["categories"]

    for r_cat in remote["categories"]:
        if not isinstance(r_cat, dict) or "name" not in r_cat:
            continue
        r_name = str(r_cat["name"]).strip().lower()
        
        # Check if category exists in local
        existing_cat = None
        for l_cat in merged_cats:
            if isinstance(l_cat, dict) and str(l_cat.get("name", "")).strip().lower() == r_name:
                existing_cat = l_cat
                break

        r_cmds = r_cat.get("commands", r_cat.get("shortcuts", []))
        if not isinstance(r_cmds, list):
            r_cmds = []

        if existing_cat:
            if "commands" not in existing_cat:
                existing_cat["commands"] = []
            
            for r_cmd in r_cmds:
                if not isinstance(r_cmd, dict) or "name" not in r_cmd:
                    continue
                cmd_name = str(r_cmd["name"]).strip().lower()
                
                # Check if command already exists in category
                has_cmd = any(
                    isinstance(c, dict) and str(c.get("name", "")).strip().lower() == cmd_name
                    for c in existing_cat["commands"]
                )
                if not has_cmd:
                    existing_cat["commands"].append(r_cmd)
        else:
            merged_cats.append({
                "name": r_cat["name"],
                "commands": r_cmds
            })

    local["categories"] = merged_cats
    return local

class DashboardHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DASHBOARD_DIR, **kwargs)

    def is_safe_path(self, path):
        # Security: Prevent path traversal attack
        abs_target = os.path.abspath(os.path.join(DASHBOARD_DIR, path.lstrip("/")))
        return abs_target.startswith(DASHBOARD_DIR)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # SSE Endpoint for Real-Time Collaboration Sync
        if path == '/api/events':
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Connection', 'keep-alive')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

            try:
                self.wfile.write(b": ping\n\n")
                self.wfile.flush()
            except Exception:
                return

            while True:
                collab_event.wait(timeout=15)
                if collab_event.is_set():
                    try:
                        msg = f"data: {json.dumps(latest_event_data)}\n\n"
                        self.wfile.write(msg.encode('utf-8'))
                        self.wfile.flush()
                    except Exception:
                        break
                else:
                    # Heartbeat
                    try:
                        self.wfile.write(b": keepalive\n\n")
                        self.wfile.flush()
                    except Exception:
                        break
            return

        # API GET /api/config
        if path == '/api/config':
            try:
                config_data = load_config()
                self._send_json(200, config_data)
            except Exception as e:
                self._send_json(500, {"error": f"Failed to load config: {str(e)}"})
            return

        # API GET /api/status
        if path == '/api/status':
            self._send_json(200, {
                "status": "online",
                "version": "1.0.0",
                "offline_capable": True,
                "server_time": time.time()
            })
            return

        # API GET /api/collaboration/workspaces
        if path == '/api/collaboration/workspaces':
            self._send_json(200, {
                "workspaces": [
                    {"id": "default", "name": "Personal Workspace", "active": True},
                    {"id": "team-alpha", "name": "Team Alpha (DevOps)", "active": False}
                ]
            })
            return

        # Serve static dashboard files
        if path == '/' or path == '':
            path = '/index.html'

        rel_path = path.lstrip('/')
        if not self.is_safe_path(rel_path):
            self.send_error(403, "Forbidden: Invalid file path")
            return

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # CSRF / Origin Check for security on state-changing POST requests
        origin = self.headers.get('Origin')
        requested_with = self.headers.get('X-Requested-With')
        if origin and not (origin.startswith('http://localhost') or origin.startswith('http://127.0.0.1')):
            self._send_json(403, {"error": "Forbidden: Cross-Origin POST prohibited"})
            return

        content_len = int(self.headers.get('Content-Length', 0))
        post_body = self.rfile.read(content_len) if content_len > 0 else b'{}'

        try:
            req_data = json.loads(post_body.decode('utf-8')) if post_body else {}
        except Exception:
            self._send_json(400, {"error": "Invalid JSON request body"})
            return

        # API POST /api/config
        if path == '/api/config':
            if not isinstance(req_data, dict) or "categories" not in req_data:
                self._send_json(400, {"error": "Invalid configuration schema: 'categories' field required"})
                return

            try:
                save_config(req_data)

                # Sync commands.json format for GNOME extension
                commands_json_path = os.path.expanduser("~/.config/cmdbar/commands.json")
                try:
                    os.makedirs(os.path.dirname(commands_json_path), exist_ok=True)
                    with open(commands_json_path, "w") as f:
                        json.dump(req_data, f, indent=2)
                except Exception:
                    pass

                # Broadcast real-time SSE event
                global latest_event_data
                latest_event_data = {"type": "config_updated", "timestamp": time.time()}
                collab_event.set()
                time.sleep(0.05)
                collab_event.clear()

                self._send_json(200, {"status": "success", "message": "Configuration saved & synced successfully"})
            except Exception as e:
                self._send_json(500, {"error": f"Failed to save configuration: {str(e)}"})
            return

        # API POST /api/preview
        if path == '/api/preview':
            cmd_template = req_data.get("command", "")
            mode = req_data.get("mode", "shell-quoted")
            param_vals = req_data.get("parameters", {})
            param_schema = req_data.get("parameters_schema", {})

            resolved, errors = resolve_command_preview(cmd_template, mode, param_vals, param_schema)
            self._send_json(200, {
                "resolved_command": resolved,
                "validation_errors": errors,
                "is_valid": len(errors) == 0
            })
            return

        # API POST /api/collaboration/merge
        if path == '/api/collaboration/merge':
            local_cfg = req_data.get("local_config", load_config())
            remote_cfg = req_data.get("remote_config", {})

            if not isinstance(remote_cfg, dict):
                self._send_json(400, {"error": "Invalid remote configuration payload"})
                return

            merged = merge_configs_structural(local_cfg, remote_cfg)
            self._send_json(200, {
                "status": "success",
                "merged_config": merged
            })
            return

        # API POST /api/collaboration/share
        if path == '/api/collaboration/share':
            config_data = load_config()
            self._send_json(200, {
                "share_link": "http://localhost:8080/?workspace=team-share",
                "payload": config_data
            })
            return

        self.send_error(404, "Endpoint not found")

    def _send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def log_message(self, format, *args):
        # Suppress noisy SSE event logs
        msg = format % args if args else format
        if "/api/events" in msg:
            return
        super().log_message(format, *args)

def run_dashboard_server(port=DEFAULT_PORT):
    server_address = ('', port)
    from http.server import ThreadingHTTPServer
    class ReuseableThreadingHTTPServer(ThreadingHTTPServer):
        allow_reuse_address = True

    httpd = ReuseableThreadingHTTPServer(server_address, DashboardHTTPRequestHandler)
    print(f"CmdBar Web Dashboard running at http://localhost:{port}")
    httpd.serve_forever()
