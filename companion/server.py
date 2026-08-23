#!/usr/bin/env python3
"""
CmdBar Headless Server Mode.
Provides a REST API, RFC 6455 WebSocket interface, configuration management,
monitoring endpoint, and systemd service management for CmdBar.

:visibility: public
"""

import sys
import os
import time
import json
import re
import socket
import struct
import hashlib
import base64
import threading
import logging
import subprocess
import argparse
import http.server
import socketserver
import urllib.parse

from companion.companion_app import (
    load_config,
    save_config,
    get_config_path,
    run_command_in_shell,
    substitute_and_quote_command,
    validate_input,
)
from companion.ai_translator import translate_natural_language_to_command

# Server metrics and state tracking
SERVER_START_TIME = time.time()
REQUEST_COUNT = 0
EXECUTION_COUNT = 0
SUCCESSFUL_EXECUTION_COUNT = 0
FAILED_EXECUTION_COUNT = 0
TOTAL_EXECUTION_DURATION = 0.0
METRICS_LOCK = threading.Lock()

ACTIVE_WEBSOCKETS = set()
WEBSOCKET_LOCK = threading.Lock()


class WebSocketFrame:
    """
    Represents a decoded WebSocket frame according to RFC 6455.

    :visibility: public
    """
    OP_CONTINUATION = 0x0
    OP_TEXT = 0x1
    OP_BINARY = 0x2
    OP_CLOSE = 0x8
    OP_PING = 0x9
    OP_PONG = 0xA

    def __init__(self, fin: bool, opcode: int, payload: bytes):
        """
        Initializes a WebSocketFrame instance.
        :visibility: public
        """
        self.fin = fin
        self.opcode = opcode
        self.payload = payload

    @staticmethod
    def encode(payload_str_or_bytes, opcode: int = OP_TEXT) -> bytes:
        """
        Encodes a payload into an unmasked RFC 6455 frame suitable for server-to-client transmission.

        :visibility: public
        """
        if isinstance(payload_str_or_bytes, str):
            payload_bytes = payload_str_or_bytes.encode('utf-8')
        else:
            payload_bytes = payload_str_or_bytes

        header = bytearray()
        header.append(0x80 | (opcode & 0x0F))

        length = len(payload_bytes)
        if length <= 125:
            header.append(length)
        elif length <= 65535:
            header.append(126)
            header.extend(struct.pack('>H', length))
        else:
            header.append(127)
            header.extend(struct.pack('>Q', length))

        return bytes(header) + payload_bytes

    @staticmethod
    def decode_from_rfile(rfile):
        """
        Reads and decodes a masked RFC 6455 frame sent from a client over a socket stream file.

        :visibility: public
        """
        b1_b2 = rfile.read(2)
        if not b1_b2 or len(b1_b2) < 2:
            return None

        b1, b2 = b1_b2[0], b1_b2[1]
        fin = bool(b1 & 0x80)
        opcode = b1 & 0x0F
        masked = bool(b2 & 0x80)
        payload_len = b2 & 0x7F

        if payload_len == 126:
            ext_len_bytes = rfile.read(2)
            if len(ext_len_bytes) < 2:
                return None
            payload_len = struct.unpack('>H', ext_len_bytes)[0]
        elif payload_len == 127:
            ext_len_bytes = rfile.read(8)
            if len(ext_len_bytes) < 8:
                return None
            payload_len = struct.unpack('>Q', ext_len_bytes)[0]

        mask = None
        if masked:
            mask = rfile.read(4)
            if len(mask) < 4:
                return None

        payload = bytearray()
        remaining = payload_len
        while remaining > 0:
            chunk = rfile.read(min(remaining, 65536))
            if not chunk:
                break
            payload.extend(chunk)
            remaining -= len(chunk)

        if masked and mask:
            payload = bytearray([b ^ mask[i % 4] for i, b in enumerate(payload)])

        return WebSocketFrame(fin, opcode, bytes(payload))


def broadcast_ws_event(event_data: dict):
    """
    Broadcasts a JSON event dictionary to all currently active WebSocket connections.

    :visibility: public
    """
    msg_str = json.dumps(event_data)
    frame_bytes = WebSocketFrame.encode(msg_str)

    with WEBSOCKET_LOCK:
        dead_clients = []
        for client in ACTIVE_WEBSOCKETS:
            try:
                client.wfile.write(frame_bytes)
                client.wfile.flush()
            except Exception:
                dead_clients.append(client)
        for dead in dead_clients:
            ACTIVE_WEBSOCKETS.discard(dead)


class CmdBarHTTPRequestHandler(http.server.BaseHTTPRequestHandler):
    """
    HTTP Request Handler for CmdBar Server.
    Handles REST API endpoints, WebSocket upgrades, and static metrics.

    :visibility: public
    """
    server_version = "CmdBarServer/1.0.0"

    def log_message(self, format, *args):
        """
        Custom logging output for HTTP requests.
        :visibility: public
        """
        logging.info("%s - - [%s] %s" % (self.address_string(), self.log_date_time_string(), format % args))

    def _increment_request_count(self):
        """
        Increments internal metric counter for total requests.
        :visibility: private
        """
        global REQUEST_COUNT
        with METRICS_LOCK:
            REQUEST_COUNT += 1

    def _send_json_response(self, data: dict, status: int = 200):
        """
        Helper method to format and send JSON responses with CORS headers.
        :visibility: private
        """
        body = json.dumps(data, indent=2).encode('utf-8')
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _send_error_response(self, message: str, status: int = 400):
        """
        Helper method to format and send error JSON responses.
        :visibility: private
        """
        self._send_json_response({"error": message, "status": status}, status=status)

    def _read_json_body(self) -> dict:
        """
        Reads and parses JSON payload from incoming HTTP request body.
        :visibility: private
        """
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length > 0:
                raw_body = self.rfile.read(content_length).decode('utf-8')
                return json.loads(raw_body)
            return {}
        except Exception as e:
            logging.warning(f"Failed to parse JSON body: {e}")
            return None

    def do_OPTIONS(self):
        """
        Handles CORS preflight OPTIONS requests.
        :visibility: public
        """
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        """
        Routes incoming GET requests to REST endpoints or WebSocket upgrade.
        :visibility: public
        """
        self._increment_request_count()
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        # Check for WebSocket Upgrade request
        if path in ["/ws", "/api/v1/ws"] or self.headers.get("Upgrade", "").lower() == "websocket":
            self._handle_websocket_upgrade()
            return

        if path in ["/", "/health", "/api/v1/health"]:
            self._handle_health()
        elif path in ["/metrics", "/api/v1/monitoring"]:
            self._handle_monitoring()
        elif path == "/api/v1/config":
            self._handle_get_config()
        elif path == "/api/v1/shortcuts":
            self._handle_get_shortcuts()
        elif path.startswith("/api/v1/shortcuts/"):
            shortcut_name = urllib.parse.unquote(path[len("/api/v1/shortcuts/"):])
            self._handle_get_shortcut_by_name(shortcut_name)
        else:
            self._send_error_response("Endpoint not found", 404)

    def do_POST(self):
        """
        Routes incoming POST requests to REST endpoints.
        :visibility: public
        """
        self._increment_request_count()
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        body = self._read_json_body()

        if body is None:
            self._send_error_response("Invalid JSON payload", 400)
            return

        if path == "/api/v1/config":
            self._handle_update_config(body)
        elif path == "/api/v1/shortcuts":
            self._handle_add_shortcut(body)
        elif path == "/api/v1/execute":
            self._handle_execute(body)
        elif path.startswith("/api/v1/shortcuts/") and path.endswith("/execute"):
            shortcut_name = urllib.parse.unquote(path[len("/api/v1/shortcuts/"): -len("/execute")])
            body["name"] = shortcut_name
            self._handle_execute(body)
        elif path == "/api/v1/ai/translate":
            self._handle_ai_translate(body)
        else:
            self._send_error_response("Endpoint not found", 404)

    def do_PUT(self):
        """
        Routes incoming PUT requests to REST endpoints.
        :visibility: public
        """
        self._increment_request_count()
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        body = self._read_json_body()

        if body is None:
            self._send_error_response("Invalid JSON payload", 400)
            return

        if path == "/api/v1/config":
            self._handle_update_config(body)
        elif path.startswith("/api/v1/shortcuts/"):
            shortcut_name = urllib.parse.unquote(path[len("/api/v1/shortcuts/"):])
            self._handle_update_shortcut(shortcut_name, body)
        else:
            self._send_error_response("Endpoint not found", 404)

    def do_DELETE(self):
        """
        Routes incoming DELETE requests to REST endpoints.
        :visibility: public
        """
        self._increment_request_count()
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        if path.startswith("/api/v1/shortcuts/"):
            shortcut_name = urllib.parse.unquote(path[len("/api/v1/shortcuts/"):])
            self._handle_delete_shortcut(shortcut_name)
        else:
            self._send_error_response("Endpoint not found", 404)

    # --- REST Handlers ---

    def _handle_health(self):
        """
        Returns basic server status and health check information.
        :visibility: private
        """
        uptime = round(time.time() - SERVER_START_TIME, 2)
        self._send_json_response({
            "status": "ok",
            "service": "CmdBar-Server",
            "version": "1.0.0",
            "uptime_seconds": uptime
        })

    def _handle_monitoring(self):
        """
        Returns comprehensive server monitoring and execution metrics.
        :visibility: private
        """
        uptime = round(time.time() - SERVER_START_TIME, 2)
        with METRICS_LOCK:
            req_cnt = REQUEST_COUNT
            exec_cnt = EXECUTION_COUNT
            succ_cnt = SUCCESSFUL_EXECUTION_COUNT
            fail_cnt = FAILED_EXECUTION_COUNT
            avg_duration = round((TOTAL_EXECUTION_DURATION / exec_cnt) * 1000, 2) if exec_cnt > 0 else 0.0

        with WEBSOCKET_LOCK:
            ws_cnt = len(ACTIVE_WEBSOCKETS)

        config_data = load_config()
        categories = config_data.get("categories", [])
        shortcuts_count = sum(len(c.get("commands", [])) for c in categories)

        rss_mb = 0.0
        try:
            import resource
            rss_mb = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 2)
        except Exception:
            pass

        self._send_json_response({
            "status": "ok",
            "uptime_seconds": uptime,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "server": {
                "host": self.server.server_address[0],
                "port": self.server.server_address[1],
                "active_websockets": ws_cnt
            },
            "metrics": {
                "total_requests": req_cnt,
                "total_executions": exec_cnt,
                "successful_executions": succ_cnt,
                "failed_executions": fail_cnt,
                "avg_execution_time_ms": avg_duration
            },
            "system": {
                "os": os.name,
                "platform": sys.platform,
                "python_version": sys.version.split()[0],
                "cpu_count": os.cpu_count() or 1,
                "memory_rss_mb": rss_mb
            },
            "config": {
                "categories_count": len(categories),
                "shortcuts_count": shortcuts_count,
                "config_path": get_config_path()
            }
        })

    def _handle_get_config(self):
        """
        Returns active configuration JSON.
        :visibility: private
        """
        config = load_config()
        self._send_json_response(config)

    def _handle_update_config(self, body: dict):
        """
        Updates full configuration atomically and notifies WebSocket clients.
        :visibility: private
        """
        if not isinstance(body, dict) or "categories" not in body:
            self._send_error_response("Invalid configuration format. Must contain 'categories' array.", 400)
            return

        success = save_config(body)
        if success:
            broadcast_ws_event({"event": "config_updated", "data": body})
            self._send_json_response({"success": True, "message": "Configuration updated successfully"})
        else:
            self._send_error_response("Failed to save configuration", 500)

    def _handle_get_shortcuts(self):
        """
        Returns flat list of all registered shortcuts across categories.
        :visibility: private
        """
        config = load_config()
        shortcuts = []
        for cat in config.get("categories", []):
            cat_name = cat.get("name", "Default")
            for cmd in cat.get("commands", []):
                shortcut_item = dict(cmd)
                shortcut_item["category"] = cat_name
                shortcuts.append(shortcut_item)
        self._send_json_response(shortcuts)

    def _handle_get_shortcut_by_name(self, name: str):
        """
        Returns details of a specific shortcut by name.
        :visibility: private
        """
        config = load_config()
        for cat in config.get("categories", []):
            cat_name = cat.get("name", "Default")
            for cmd in cat.get("commands", []):
                if cmd.get("name") == name:
                    res = dict(cmd)
                    res["category"] = cat_name
                    self._send_json_response(res)
                    return
        self._send_error_response(f"Shortcut '{name}' not found", 404)

    def _handle_add_shortcut(self, body: dict):
        """
        Adds a new shortcut to a category.
        :visibility: private
        """
        category_name = body.get("category", "General").strip()
        name = body.get("name", "").strip()
        template = body.get("template", body.get("command", "")).strip()
        parameters = body.get("parameters", {})

        if not name or not template:
            self._send_error_response("Both 'name' and 'command'/'template' are required.", 400)
            return

        config = load_config()
        categories = config.setdefault("categories", [])

        target_cat = None
        for cat in categories:
            if cat.get("name") == category_name:
                target_cat = cat
                break

        if not target_cat:
            target_cat = {"name": category_name, "commands": []}
            categories.append(target_cat)

        cmds = target_cat.setdefault("commands", [])

        # Check if already exists in this category
        existing = None
        for c in cmds:
            if c.get("name") == name:
                existing = c
                break

        new_cmd_obj = {
            "name": name,
            "template": template,
            "command": template,
            "parameters": parameters
        }

        if existing:
            existing.update(new_cmd_obj)
        else:
            cmds.append(new_cmd_obj)

        if save_config(config):
            broadcast_ws_event({"event": "config_updated", "data": config})
            self._send_json_response({"success": True, "shortcut": new_cmd_obj}, status=201)
        else:
            self._send_error_response("Failed to save shortcut", 500)

    def _handle_update_shortcut(self, name: str, body: dict):
        """
        Updates an existing shortcut by name.
        :visibility: private
        """
        config = load_config()
        found = False
        for cat in config.get("categories", []):
            for cmd in cat.get("commands", []):
                if cmd.get("name") == name:
                    if "new_name" in body:
                        cmd["name"] = body["new_name"].strip()
                    if "template" in body or "command" in body:
                        cmd_val = body.get("template", body.get("command")).strip()
                        cmd["template"] = cmd_val
                        cmd["command"] = cmd_val
                    if "parameters" in body:
                        cmd["parameters"] = body["parameters"]
                    found = True
                    break
            if found:
                break

        if not found:
            self._send_error_response(f"Shortcut '{name}' not found", 404)
            return

        if save_config(config):
            broadcast_ws_event({"event": "config_updated", "data": config})
            self._send_json_response({"success": True, "message": f"Shortcut '{name}' updated successfully"})
        else:
            self._send_error_response("Failed to save updated shortcut", 500)

    def _handle_delete_shortcut(self, name: str):
        """
        Deletes a shortcut by name.
        :visibility: private
        """
        config = load_config()
        removed = False
        for cat in config.get("categories", []):
            cmds = cat.get("commands", [])
            init_len = len(cmds)
            cat["commands"] = [c for c in cmds if c.get("name") != name]
            if len(cat["commands"]) < init_len:
                removed = True

        if not removed:
            self._send_error_response(f"Shortcut '{name}' not found", 404)
            return

        if save_config(config):
            broadcast_ws_event({"event": "config_updated", "data": config})
            self._send_json_response({"success": True, "message": f"Shortcut '{name}' deleted successfully"})
        else:
            self._send_error_response("Failed to save configuration after deletion", 500)

    def _handle_execute(self, body: dict):
        """
        Executes a shortcut or direct command with parameter substitution.
        :visibility: private
        """
        name = body.get("name", "").strip()
        command = body.get("command", "").strip()
        params = body.get("parameters", {})

        if not name and not command:
            self._send_error_response("Either 'name' or 'command' parameter is required for execution.", 400)
            return

        config = load_config()
        found_cmd_obj = None

        if name:
            for cat in config.get("categories", []):
                for c in cat.get("commands", []):
                    if c.get("name") == name or c.get("template") == name or c.get("command") == name:
                        found_cmd_obj = c
                        break
                if found_cmd_obj:
                    break

        template = found_cmd_obj.get("template", found_cmd_obj.get("command", command)) if found_cmd_obj else (command or name)
        param_rules = found_cmd_obj.get("parameters", {}) if found_cmd_obj else {}

        # Parameter validation against regex
        for p_name, p_val in params.items():
            if p_name in param_rules and "regex" in param_rules[p_name]:
                pat = param_rules[p_name]["regex"]
                if not validate_input(str(p_val), pat):
                    err_msg = param_rules[p_name].get("error_message", f"Parameter '{p_name}' value fails validation pattern '{pat}'")
                    self._send_error_response(err_msg, 400)
                    return

        # Perform command parameter substitution
        final_cmd = substitute_and_quote_command(template, params)

        start_time = time.time()
        exit_code, stdout, stderr = run_command_in_shell(final_cmd)
        duration = round(time.time() - start_time, 4)

        # Update server metrics
        global EXECUTION_COUNT, SUCCESSFUL_EXECUTION_COUNT, FAILED_EXECUTION_COUNT, TOTAL_EXECUTION_DURATION
        with METRICS_LOCK:
            EXECUTION_COUNT += 1
            TOTAL_EXECUTION_DURATION += duration
            if exit_code == 0:
                SUCCESSFUL_EXECUTION_COUNT += 1
            else:
                FAILED_EXECUTION_COUNT += 1

        self._send_json_response({
            "success": exit_code == 0,
            "exit_code": exit_code,
            "stdout": stdout,
            "stderr": stderr,
            "duration_ms": round(duration * 1000, 2),
            "command": final_cmd
        })

    def _handle_ai_translate(self, body: dict):
        """
        Translates a natural language prompt into an executable command.
        :visibility: private
        """
        prompt = body.get("prompt", "").strip()
        if not prompt:
            self._send_error_response("Parameter 'prompt' is required.", 400)
            return

        try:
            translated = translate_natural_language_to_command(prompt)
            self._send_json_response({
                "prompt": prompt,
                "command": translated
            })
        except Exception as e:
            logging.warning(f"AI translation failed: {e}")
            self._send_error_response(f"AI Translation failed: {str(e)}", 500)

    # --- WebSocket Upgrade & Message Loop ---

    def _handle_websocket_upgrade(self):
        """
        Upgrades HTTP connection to WebSocket protocol (RFC 6455).
        :visibility: private
        """
        ws_key = self.headers.get("Sec-WebSocket-Key", "").strip()
        if not ws_key:
            self._send_error_response("Missing Sec-WebSocket-Key header", 400)
            return

        guid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        accept_key = base64.b64encode(hashlib.sha1((ws_key + guid).encode('utf-8')).digest()).decode('utf-8')

        self.send_response(101, "Switching Protocols")
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept_key)
        self.end_headers()

        with WEBSOCKET_LOCK:
            ACTIVE_WEBSOCKETS.add(self)

        logging.info(f"WebSocket connection established with {self.address_string()}")

        try:
            while True:
                frame = WebSocketFrame.decode_from_rfile(self.rfile)
                if frame is None or frame.opcode == WebSocketFrame.OP_CLOSE:
                    break

                if frame.opcode == WebSocketFrame.OP_PING:
                    # Send Pong frame back
                    pong_frame = WebSocketFrame.encode(frame.payload, opcode=WebSocketFrame.OP_PONG)
                    self.wfile.write(pong_frame)
                    self.wfile.flush()
                elif frame.opcode == WebSocketFrame.OP_TEXT:
                    try:
                        msg_data = json.loads(frame.payload.decode('utf-8'))
                        self._process_ws_message(msg_data)
                    except Exception as err:
                        logging.warning(f"Error handling WS message: {err}")
                        err_frame = WebSocketFrame.encode(json.dumps({"event": "error", "message": str(err)}))
                        self.wfile.write(err_frame)
                        self.wfile.flush()
        except Exception as e:
            logging.info(f"WebSocket client disconnected: {e}")
        finally:
            with WEBSOCKET_LOCK:
                ACTIVE_WEBSOCKETS.discard(self)
            logging.info(f"WebSocket connection closed for {self.address_string()}")

    def _process_ws_message(self, msg: dict):
        """
        Processes incoming JSON message over WebSocket connection.
        :visibility: private
        """
        action = msg.get("action", "").lower()

        if action == "ping":
            res_frame = WebSocketFrame.encode(json.dumps({"event": "pong"}))
            self.wfile.write(res_frame)
            self.wfile.flush()

        elif action == "get_config":
            config = load_config()
            res_frame = WebSocketFrame.encode(json.dumps({"event": "config", "data": config}))
            self.wfile.write(res_frame)
            self.wfile.flush()

        elif action == "update_config":
            new_config = msg.get("config", msg.get("data", {}))
            if save_config(new_config):
                broadcast_ws_event({"event": "config_updated", "data": new_config})
                res_frame = WebSocketFrame.encode(json.dumps({"event": "config_updated", "success": True}))
                self.wfile.write(res_frame)
                self.wfile.flush()

        elif action == "execute":
            name = msg.get("name", "").strip()
            cmd = msg.get("command", "").strip()
            params = msg.get("parameters", {})

            config = load_config()
            found_cmd_obj = None
            if name:
                for cat in config.get("categories", []):
                    for c in cat.get("commands", []):
                        if c.get("name") == name or c.get("template") == name or c.get("command") == name:
                            found_cmd_obj = c
                            break
                    if found_cmd_obj:
                        break

            template = found_cmd_obj.get("template", found_cmd_obj.get("command", cmd)) if found_cmd_obj else (cmd or name)
            final_cmd = substitute_and_quote_command(template, params)

            # Send started event
            start_evt = WebSocketFrame.encode(json.dumps({
                "event": "started",
                "name": name,
                "command": final_cmd
            }))
            self.wfile.write(start_evt)
            self.wfile.flush()

            start_time = time.time()
            code, stdout, stderr = run_command_in_shell(final_cmd)
            duration = round(time.time() - start_time, 4)

            # Send completed event
            comp_evt = WebSocketFrame.encode(json.dumps({
                "event": "completed",
                "name": name,
                "command": final_cmd,
                "exit_code": code,
                "stdout": stdout,
                "stderr": stderr,
                "duration_ms": round(duration * 1000, 2),
                "success": code == 0
            }))
            self.wfile.write(comp_evt)
            self.wfile.flush()

        elif action == "subscribe":
            res_frame = WebSocketFrame.encode(json.dumps({"event": "subscribed", "status": "ok"}))
            self.wfile.write(res_frame)
            self.wfile.flush()


class CmdBarServer:
    """
    CmdBar Headless Server instance managing the HTTP & WebSocket server.

    :visibility: public
    """
    def __init__(self, host: str = "127.0.0.1", port: int = 8080, config_path: str = None):
        """
        Initializes CmdBarServer.
        :visibility: public
        """
        self.host = host
        self.port = int(port)
        if config_path:
            os.environ["CMDBAR_CONFIG_PATH"] = config_path
        self.server = None
        self._thread = None

    def start(self, block: bool = False):
        """
        Starts the HTTP & WebSocket server.
        :visibility: public
        """
        class ReusableThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
            daemon_threads = True
            allow_reuse_address = True

        self.server = ReusableThreadingServer((self.host, self.port), CmdBarHTTPRequestHandler)
        logging.info(f"CmdBar Server running on http://{self.host}:{self.port}")

        if block:
            try:
                self.server.serve_forever()
            except KeyboardInterrupt:
                logging.info("Stopping CmdBar Server...")
                self.stop()
        else:
            self._thread = threading.Thread(target=self.server.serve_forever, daemon=True)
            self._thread.start()

    def stop(self):
        """
        Stops the server cleanly.
        :visibility: public
        """
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            self.server = None


def get_systemd_unit_content(host: str = "127.0.0.1", port: int = 8080, config_path: str = None) -> str:
    """
    Generates systemd unit service file content for CmdBar server.

    :visibility: public
    """
    python_exec = sys.executable
    exec_cmd = f"{python_exec} -m companion.server --host {host} --port {port}"
    if config_path:
        exec_cmd += f" --config {config_path}"

    return f"""[Unit]
Description=CmdBar CLI-Only Headless Server Mode
After=network.target

[Service]
Type=simple
ExecStart={exec_cmd}
Restart=always
RestartSec=5s
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=default.target
"""


def install_systemd_service(host: str = "127.0.0.1", port: int = 8080, config_path: str = None) -> bool:
    """
    Installs systemd user service for CmdBar server.

    :visibility: public
    """
    unit_dir = os.path.expanduser("~/.config/systemd/user")
    os.makedirs(unit_dir, exist_ok=True)
    unit_path = os.path.join(unit_dir, "cmdbar-server.service")

    content = get_systemd_unit_content(host, port, config_path)
    with open(unit_path, "w") as f:
        f.write(content)

    print(f"Systemd service file installed to: {unit_path}")

    try:
        subprocess.run(["systemctl", "--user", "daemon-reload"], check=False)
        subprocess.run(["systemctl", "--user", "enable", "cmdbar-server.service"], check=False)
        print("Systemd user service enabled. Start it with: systemctl --user start cmdbar-server")
    except Exception as e:
        print(f"Note: systemctl command not available or failed: {e}")

    return True


def uninstall_systemd_service() -> bool:
    """
    Uninstalls systemd user service for CmdBar server.

    :visibility: public
    """
    unit_path = os.path.expanduser("~/.config/systemd/user/cmdbar-server.service")
    try:
        subprocess.run(["systemctl", "--user", "stop", "cmdbar-server.service"], check=False)
        subprocess.run(["systemctl", "--user", "disable", "cmdbar-server.service"], check=False)
    except Exception:
        pass

    if os.path.exists(unit_path):
        os.remove(unit_path)
        print(f"Removed systemd service file: {unit_path}")

    try:
        subprocess.run(["systemctl", "--user", "daemon-reload"], check=False)
    except Exception:
        pass

    return True


def status_systemd_service() -> bool:
    """
    Checks status of systemd user service for CmdBar server.

    :visibility: public
    """
    unit_path = os.path.expanduser("~/.config/systemd/user/cmdbar-server.service")
    installed = os.path.exists(unit_path)
    print(f"Systemd Service Installed: {installed}")
    if installed:
        print(f"Unit Path: {unit_path}")
        try:
            res = subprocess.run(["systemctl", "--user", "status", "cmdbar-server.service"], capture_output=True, text=True)
            print("Systemctl Status:")
            print(res.stdout or res.stderr)
        except Exception as e:
            print(f"Could not query systemctl: {e}")
    return installed


def main():
    """
    CLI entry point for CmdBar Server.

    :visibility: public
    """
    parser = argparse.ArgumentParser(description="CmdBar CLI-Only Headless Server Mode")
    parser.add_argument("--host", default=os.environ.get("CMDBAR_SERVER_HOST", "127.0.0.1"), help="Host address to bind (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("CMDBAR_SERVER_PORT", 8080)), help="Port to listen on (default: 8080)")
    parser.add_argument("--config", default=os.environ.get("CMDBAR_CONFIG_PATH"), help="Path to config.json file")
    parser.add_argument("--install-service", action="store_true", help="Install systemd user service unit")
    parser.add_argument("--uninstall-service", action="store_true", help="Uninstall systemd user service unit")
    parser.add_argument("--status-service", action="store_true", help="Check status of systemd user service")
    parser.add_argument("--daemon", action="store_true", help="Run server in background daemon mode")
    parser.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"], help="Logging level")
    parser.add_argument("--version", action="version", version="CmdBar Server 1.0.0")

    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level.upper()),
        format="[%(asctime)s] %(levelname)s - %(message)s"
    )

    if args.install_service:
        install_systemd_service(host=args.host, port=args.port, config_path=args.config)
        return

    if args.uninstall_service:
        uninstall_systemd_service()
        return

    if args.status_service:
        status_systemd_service()
        return

    if args.config:
        os.environ["CMDBAR_CONFIG_PATH"] = args.config

    if args.daemon:
        if hasattr(os, "fork"):
            pid = os.fork()
            if pid > 0:
                print(f"CmdBar Server started in daemon mode (PID {pid}) on http://{args.host}:{args.port}")
                sys.exit(0)
            os.setsid()

    server = CmdBarServer(host=args.host, port=args.port, config_path=args.config)
    server.start(block=True)


if __name__ == "__main__":
    main()
