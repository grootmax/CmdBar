#!/usr/bin/env python3
"""
CmdBar Headless Server Mode.
Provides REST API, WebSocket real-time communication, config management, and monitoring endpoint.
"""

import sys
import os
import json
import re
import shlex
import time
import asyncio
import hashlib
import base64
import struct
import argparse
import logging
from typing import Dict, Any, Optional, Set, Tuple

# Add project root to sys.path if needed
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.config_schema import (
    load_config,
    save_config,
    validate_parameter_value,
    resolve_command_preview,
    get_config_path
)

logger = logging.getLogger("cmdbar_server")


class ServerMetrics:
    """Tracks server operational metrics for monitoring."""
    def __init__(self):
        self.start_time = time.time()
        self.http_requests_total = 0
        self.http_requests_by_status: Dict[int, int] = {}
        self.http_requests_by_endpoint: Dict[str, int] = {}
        self.ws_connections_total = 0
        self.ws_connections_active = 0
        self.commands_executed_total = 0
        self.commands_succeeded_total = 0
        self.commands_failed_total = 0
        self.total_execution_time_ms = 0.0

    def record_http_request(self, method: str, path: str, status_code: int):
        self.http_requests_total += 1
        self.http_requests_by_status[status_code] = self.http_requests_by_status.get(status_code, 0) + 1
        endpoint_key = f"{method} {path}"
        self.http_requests_by_endpoint[endpoint_key] = self.http_requests_by_endpoint.get(endpoint_key, 0) + 1

    def record_ws_connect(self):
        self.ws_connections_total += 1
        self.ws_connections_active += 1

    def record_ws_disconnect(self):
        self.ws_connections_active = max(0, self.ws_connections_active - 1)

    def record_command_execution(self, success: bool, duration_ms: float):
        self.commands_executed_total += 1
        if success:
            self.commands_succeeded_total += 1
        else:
            self.commands_failed_total += 1
        self.total_execution_time_ms += duration_ms

    def get_system_stats(self) -> Dict[str, Any]:
        """Collects process RSS memory and basic system info."""
        pid = os.getpid()
        memory_mb = 0.0
        try:
            # Try reading /proc/self/statm on Linux
            if os.path.exists("/proc/self/statm"):
                with open("/proc/self/statm", "r") as f:
                    fields = f.read().split()
                    rss_pages = int(fields[1])
                    page_size = os.sysconf("SC_PAGE_SIZE")
                    memory_mb = round((rss_pages * page_size) / (1024 * 1024), 2)
        except Exception:
            pass

        return {
            "pid": pid,
            "memory_mb": memory_mb,
            "python_version": sys.version.split()[0],
        }

    def to_dict(self) -> Dict[str, Any]:
        uptime = round(time.time() - self.start_time, 2)
        avg_cmd_duration = (
            round(self.total_execution_time_ms / self.commands_executed_total, 2)
            if self.commands_executed_total > 0 else 0.0
        )
        return {
            "uptime_seconds": uptime,
            "http_requests_total": self.http_requests_total,
            "http_requests_by_status": {str(k): v for k, v in self.http_requests_by_status.items()},
            "http_requests_by_endpoint": self.http_requests_by_endpoint,
            "websocket_connections_total": self.ws_connections_total,
            "websocket_connections_active": self.ws_connections_active,
            "commands_executed_total": self.commands_executed_total,
            "commands_succeeded_total": self.commands_succeeded_total,
            "commands_failed_total": self.commands_failed_total,
            "avg_command_duration_ms": avg_cmd_duration,
            "system": self.get_system_stats(),
        }

    def to_prometheus_text(self) -> str:
        d = self.to_dict()
        lines = [
            "# HELP cmdbar_uptime_seconds Server uptime in seconds",
            "# TYPE cmdbar_uptime_seconds counter",
            f"cmdbar_uptime_seconds {d['uptime_seconds']}",
            "# HELP cmdbar_http_requests_total Total HTTP requests handled",
            "# TYPE cmdbar_http_requests_total counter",
            f"cmdbar_http_requests_total {d['http_requests_total']}",
            "# HELP cmdbar_websocket_connections_active Active WebSocket client count",
            "# TYPE cmdbar_websocket_connections_active gauge",
            f"cmdbar_websocket_connections_active {d['websocket_connections_active']}",
            "# HELP cmdbar_commands_executed_total Total commands executed",
            "# TYPE cmdbar_commands_executed_total counter",
            f"cmdbar_commands_executed_total {d['commands_executed_total']}",
            "# HELP cmdbar_commands_succeeded_total Successful command executions",
            "# TYPE cmdbar_commands_succeeded_total counter",
            f"cmdbar_commands_succeeded_total {d['commands_succeeded_total']}",
            "# HELP cmdbar_commands_failed_total Failed command executions",
            "# TYPE cmdbar_commands_failed_total counter",
            f"cmdbar_commands_failed_total {d['commands_failed_total']}",
            "# HELP cmdbar_process_memory_mb Process memory RSS in megabytes",
            "# TYPE cmdbar_process_memory_mb gauge",
            f"cmdbar_process_memory_mb {d['system']['memory_mb']}",
        ]
        return "\n".join(lines) + "\n"


class CmdBarWebSocketClient:
    """Represents a connected WebSocket client."""
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self.reader = reader
        self.writer = writer
        self.subscriptions: Set[str] = set()

    async def send_text(self, text: str):
        payload = text.encode("utf-8")
        payload_len = len(payload)

        header = bytearray()
        header.append(0x81)  # FIN + Text frame (0x1)

        if payload_len < 126:
            header.append(payload_len)
        elif payload_len <= 65535:
            header.append(126)
            header.extend(struct.pack(">H", payload_len))
        else:
            header.append(127)
            header.extend(struct.pack(">Q", payload_len))

        try:
            self.writer.write(header + payload)
            await self.writer.drain()
        except Exception as e:
            logger.debug("Failed to send WS message: %s", e)

    async def send_json(self, data: Dict[str, Any]):
        await self.send_text(json.dumps(data))


class CmdBarServer:
    def __init__(self, host: str = "127.0.0.1", port: int = 8080, config_path: Optional[str] = None, auth_token: Optional[str] = None):
        self.host = host
        self.port = port
        self.config_path = config_path or get_config_path()
        self.auth_token = auth_token or os.environ.get("CMDBAR_SERVER_TOKEN")
        self.metrics = ServerMetrics()
        self.active_ws_clients: Set[CmdBarWebSocketClient] = set()
        self.config_lock = asyncio.Lock()
        self.config_data = load_config(self.config_path)
        self.server: Optional[asyncio.Server] = None

    def reload_config_from_disk(self):
        self.config_data = load_config(self.config_path)

    async def broadcast_event(self, event_type: str, payload: Dict[str, Any], topic: Optional[str] = None):
        message = {"type": event_type, "timestamp": time.time(), "data": payload}
        json_str = json.dumps(message)
        dead_clients = set()

        for client in list(self.active_ws_clients):
            if topic and topic not in client.subscriptions:
                continue
            try:
                await client.send_text(json_str)
            except Exception:
                dead_clients.add(client)

        for client in dead_clients:
            self.active_ws_clients.discard(client)
            self.metrics.record_ws_disconnect()

    def verify_auth(self, headers: Dict[str, str], query_params: Dict[str, str]) -> bool:
        if not self.auth_token:
            return True

        # Check Authorization header
        auth_hdr = headers.get("authorization", "")
        if auth_hdr.startswith("Bearer "):
            token = auth_hdr[7:].strip()
            if token == self.auth_token:
                return True

        # Check query parameter ?token=
        if query_params.get("token") == self.auth_token:
            return True

        return False

    async def handle_connection(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        try:
            # Read HTTP request header block
            request_bytes = await reader.readuntil(b"\r\n\r\n")
        except (asyncio.IncompleteReadError, ConnectionResetError):
            writer.close()
            await writer.wait_closed()
            return

        request_str = request_bytes.decode("utf-8", errors="replace")
        lines = request_str.split("\r\n")
        if not lines or not lines[0]:
            writer.close()
            await writer.wait_closed()
            return

        req_line_parts = lines[0].split()
        if len(req_line_parts) < 2:
            writer.close()
            await writer.wait_closed()
            return

        method = req_line_parts[0].upper()
        full_path = req_line_parts[1]

        # Parse headers
        headers: Dict[str, str] = {}
        for line in lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()

        # Parse query params
        path = full_path
        query_params: Dict[str, str] = {}
        if "?" in full_path:
            path, query_str = full_path.split("?", 1)
            for param in query_str.split("&"):
                if "=" in param:
                    pk, pv = param.split("=", 1)
                    query_params[pk] = pv
                elif param:
                    query_params[param] = ""

        # Check if WebSocket Upgrade Request
        if headers.get("upgrade", "").lower() == "websocket":
            if not self.verify_auth(headers, query_params):
                await self.send_http_response(writer, method, path, 401, {"error": "Unauthorized"})
                writer.close()
                await writer.wait_closed()
                return

            await self.handle_websocket(reader, writer, headers)
            return

        # Check auth for REST endpoints
        if not self.verify_auth(headers, query_params):
            await self.send_http_response(writer, method, path, 401, {"error": "Unauthorized"})
            writer.close()
            await writer.wait_closed()
            return

        # Read body if Content-Length specified
        body_bytes = b""
        content_length = int(headers.get("content-length", "0"))
        if content_length > 0:
            try:
                body_bytes = await reader.readexactly(content_length)
            except asyncio.IncompleteReadError:
                body_bytes = b""

        await self.handle_rest_request(writer, method, path, headers, query_params, body_bytes)

    async def send_http_response(
        self,
        writer: asyncio.StreamWriter,
        method: str,
        path: str,
        status_code: int,
        body: Any,
        content_type: str = "application/json"
    ):
        self.metrics.record_http_request(method, path, status_code)

        status_messages = {
            200: "OK",
            201: "Created",
            400: "Bad Request",
            401: "Unauthorized",
            404: "Not Found",
            405: "Method Not Allowed",
            500: "Internal Server Error"
        }
        msg = status_messages.get(status_code, "OK")

        if content_type == "application/json":
            payload = json.dumps(body).encode("utf-8")
        elif isinstance(body, str):
            payload = body.encode("utf-8")
        elif isinstance(body, bytes):
            payload = body
        else:
            payload = str(body).encode("utf-8")

        response_headers = [
            f"HTTP/1.1 {status_code} {msg}",
            f"Content-Type: {content_type}",
            f"Content-Length: {len(payload)}",
            "Access-Control-Allow-Origin: *",
            "Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers: Content-Type, Authorization",
            "Connection: close",
            "\r\n"
        ]

        try:
            writer.write("\r\n".join(response_headers).encode("utf-8") + payload)
            await writer.drain()
        except Exception as e:
            logger.debug("Failed writing HTTP response: %s", e)
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass

    async def handle_rest_request(
        self,
        writer: asyncio.StreamWriter,
        method: str,
        path: str,
        headers: Dict[str, str],
        query_params: Dict[str, str],
        body_bytes: bytes
    ):
        if method == "OPTIONS":
            await self.send_http_response(writer, method, path, 200, {"status": "ok"})
            return

        json_body: Dict[str, Any] = {}
        if body_bytes:
            try:
                json_body = json.loads(body_bytes.decode("utf-8"))
            except Exception:
                pass

        # Routes
        if path in ("/health", "/api/health") and method == "GET":
            await self.send_http_response(writer, method, path, 200, {
                "status": "ok",
                "mode": "headless",
                "uptime_seconds": round(time.time() - self.metrics.start_time, 2),
                "timestamp": time.time()
            })
            return

        if path in ("/api/version", "/version") and method == "GET":
            await self.send_http_response(writer, method, path, 200, {
                "name": "CmdBar Headless Server",
                "version": "1.0.0",
                "mode": "headless"
            })
            return

        if path in ("/metrics", "/api/monitoring") and method == "GET":
            fmt = query_params.get("format", "")
            accept = headers.get("accept", "")
            if fmt == "prometheus" or "text/plain" in accept:
                prom_text = self.metrics.to_prometheus_text()
                await self.send_http_response(writer, method, path, 200, prom_text, content_type="text/plain; version=0.0.4")
            else:
                await self.send_http_response(writer, method, path, 200, self.metrics.to_dict())
            return

        if path == "/api/config" and method == "GET":
            async with self.config_lock:
                await self.send_http_response(writer, method, path, 200, self.config_data)
            return

        if path == "/api/config" and method in ("PUT", "POST"):
            if not json_body or not isinstance(json_body, dict):
                await self.send_http_response(writer, method, path, 400, {"error": "Invalid or missing JSON payload"})
                return

            async with self.config_lock:
                self.config_data = json_body
                save_config(self.config_data, self.config_path)

            await self.broadcast_event("config_updated", {"config": self.config_data})
            await self.send_http_response(writer, method, path, 200, {
                "status": "success",
                "message": "Configuration saved successfully"
            })
            return

        if path == "/api/categories" and method == "GET":
            async with self.config_lock:
                categories = self.config_data.get("categories", [])
                await self.send_http_response(writer, method, path, 200, {"categories": categories})
            return

        if path == "/api/categories" and method == "POST":
            name = json_body.get("name", "").strip()
            if not name:
                await self.send_http_response(writer, method, path, 400, {"error": "Category name is required"})
                return

            async with self.config_lock:
                categories = self.config_data.setdefault("categories", [])
                for cat in categories:
                    if cat.get("name") == name:
                        await self.send_http_response(writer, method, path, 400, {"error": f"Category '{name}' already exists"})
                        return
                new_cat = {"name": name, "commands": []}
                categories.append(new_cat)
                save_config(self.config_data, self.config_path)

            await self.broadcast_event("config_updated", {"config": self.config_data})
            await self.send_http_response(writer, method, path, 201, {
                "status": "success",
                "category": new_cat
            })
            return

        if path.startswith("/api/categories/") and method == "DELETE":
            cat_name = path[len("/api/categories/"):].strip()
            # URL decode cat_name if needed
            from urllib.parse import unquote
            cat_name = unquote(cat_name)

            async with self.config_lock:
                categories = self.config_data.get("categories", [])
                initial_len = len(categories)
                self.config_data["categories"] = [c for c in categories if c.get("name") != cat_name]
                if len(self.config_data["categories"]) == initial_len:
                    await self.send_http_response(writer, method, path, 404, {"error": f"Category '{cat_name}' not found"})
                    return
                save_config(self.config_data, self.config_path)

            await self.broadcast_event("config_updated", {"config": self.config_data})
            await self.send_http_response(writer, method, path, 200, {"status": "success", "message": f"Category '{cat_name}' deleted"})
            return

        if path == "/api/commands" and method == "GET":
            async with self.config_lock:
                all_cmds = []
                for cat in self.config_data.get("categories", []):
                    cat_name = cat.get("name", "Default")
                    for cmd in cat.get("commands", []):
                        cmd_copy = dict(cmd)
                        cmd_copy["category"] = cat_name
                        all_cmds.append(cmd_copy)
                await self.send_http_response(writer, method, path, 200, {"commands": all_cmds})
            return

        if path == "/api/commands" and method == "POST":
            cat_name = json_body.get("category", "").strip() or "Default"
            cmd_name = json_body.get("name", "").strip()
            cmd_template = json_body.get("command") or json_body.get("template") or ""
            cmd_mode = json_body.get("mode", "shell-quoted")
            cmd_params = json_body.get("parameters", {})

            if not cmd_name or not cmd_template:
                await self.send_http_response(writer, method, path, 400, {"error": "Command name and command template/script are required"})
                return

            new_cmd = {
                "name": cmd_name,
                "command": cmd_template,
                "mode": cmd_mode,
                "parameters": cmd_params
            }

            async with self.config_lock:
                categories = self.config_data.setdefault("categories", [])
                target_cat = None
                for cat in categories:
                    if cat.get("name") == cat_name:
                        target_cat = cat
                        break
                if not target_cat:
                    target_cat = {"name": cat_name, "commands": []}
                    categories.append(target_cat)

                target_cat.setdefault("commands", []).append(new_cmd)
                save_config(self.config_data, self.config_path)

            await self.broadcast_event("config_updated", {"config": self.config_data})
            await self.send_http_response(writer, method, path, 201, {
                "status": "success",
                "command": new_cmd
            })
            return

        if path.startswith("/api/commands/") and method in ("PUT", "DELETE"):
            cmd_target = path[len("/api/commands/"):].strip()
            from urllib.parse import unquote
            cmd_target = unquote(cmd_target)

            async with self.config_lock:
                found = False
                for cat in self.config_data.get("categories", []):
                    cmds = cat.get("commands", [])
                    for i, cmd in enumerate(cmds):
                        if cmd.get("name") == cmd_target:
                            found = True
                            if method == "DELETE":
                                cmds.pop(i)
                            elif method == "PUT":
                                if "name" in json_body:
                                    cmd["name"] = json_body["name"]
                                if "command" in json_body or "template" in json_body:
                                    cmd["command"] = json_body.get("command") or json_body.get("template")
                                if "mode" in json_body:
                                    cmd["mode"] = json_body["mode"]
                                if "parameters" in json_body:
                                    cmd["parameters"] = json_body["parameters"]
                            break
                    if found:
                        break

                if not found:
                    await self.send_http_response(writer, method, path, 404, {"error": f"Command '{cmd_target}' not found"})
                    return

                save_config(self.config_data, self.config_path)

            await self.broadcast_event("config_updated", {"config": self.config_data})
            await self.send_http_response(writer, method, path, 200, {"status": "success", "message": f"Command '{cmd_target}' updated/deleted"})
            return

        if path in ("/api/execute", "/api/run") and method == "POST":
            cmd_name = json_body.get("command_name") or json_body.get("name")
            template = json_body.get("template") or json_body.get("command")
            mode = json_body.get("mode", "shell-quoted")
            user_params = json_body.get("parameters", {})

            target_cmd = None
            if cmd_name:
                async with self.config_lock:
                    for cat in self.config_data.get("categories", []):
                        for c in cat.get("commands", []):
                            if c.get("name") == cmd_name:
                                target_cmd = c
                                break
                        if target_cmd:
                            break

            if not target_cmd and not template:
                await self.send_http_response(writer, method, path, 400, {
                    "error": f"Command '{cmd_name}' not found and no template provided."
                })
                return

            if target_cmd:
                template = target_cmd.get("command") or target_cmd.get("template") or ""
                mode = target_cmd.get("mode", mode)
                param_schema = target_cmd.get("parameters", {})
            else:
                param_schema = user_params

            result = await self.execute_command(template, mode, user_params, param_schema)
            status_code = 200 if result.get("success") else 400
            await self.send_http_response(writer, method, path, status_code, result)
            return

        await self.send_http_response(writer, method, path, 404, {"error": "Route not found"})

    async def execute_command(
        self,
        template: str,
        mode: str,
        user_params: Dict[str, Any],
        param_schema: Dict[str, Any]
    ) -> Dict[str, Any]:
        start_t = time.time()

        # Validate parameters against schema
        errors = {}
        schema_items = []
        if isinstance(param_schema, dict):
            for p_name, p_cfg in param_schema.items():
                item = dict(p_cfg) if isinstance(p_cfg, dict) else {}
                item["name"] = p_name
                schema_items.append(item)

        for p_item in schema_items:
            name = p_item.get("name")
            val = user_params.get(name, "")
            is_valid, err_msg = validate_parameter_value(val, p_item)
            if not is_valid:
                errors[name] = err_msg

        if errors:
            duration = round((time.time() - start_t) * 1000, 2)
            self.metrics.record_command_execution(False, duration)
            return {
                "success": False,
                "error": "Parameter validation failed",
                "parameter_errors": errors,
                "duration_ms": duration
            }

        # Resolve command substitution
        pattern = r"\{\{([^}]+)\}\}|<([^>]+)>|\{([^}]+)\}"
        if mode == "shell-quoted":
            def replacer(match):
                ph = match.group(1) or match.group(2) or match.group(3)
                if ph in user_params:
                    return shlex.quote(str(user_params[ph]))
                return match.group(0)

            command_to_run = re.sub(pattern, replacer, template)
            exec_args = command_to_run
            is_shell = True
        else:
            try:
                parts = shlex.split(template)
            except Exception:
                parts = template.split()

            resolved_parts = []
            for part in parts:
                def replacer_part(match):
                    ph = match.group(1) or match.group(2) or match.group(3)
                    if ph in user_params:
                        return str(user_params[ph])
                    return match.group(0)

                resolved_parts.append(re.sub(pattern, replacer_part, part))

            exec_args = resolved_parts
            is_shell = False
            command_to_run = " ".join(shlex.quote(p) for p in resolved_parts)

        # Run process asynchronously
        try:
            if is_shell:
                proc = await asyncio.create_subprocess_shell(
                    exec_args,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
            else:
                proc = await asyncio.create_subprocess_exec(
                    *exec_args,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )

            stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=30.0)
            duration = round((time.time() - start_t) * 1000, 2)
            success = (proc.returncode == 0)

            self.metrics.record_command_execution(success, duration)
            return {
                "success": success,
                "command": command_to_run,
                "exit_code": proc.returncode,
                "stdout": stdout_b.decode("utf-8", errors="replace"),
                "stderr": stderr_b.decode("utf-8", errors="replace"),
                "duration_ms": duration
            }
        except asyncio.TimeoutError:
            duration = round((time.time() - start_t) * 1000, 2)
            self.metrics.record_command_execution(False, duration)
            return {
                "success": False,
                "command": command_to_run,
                "error": "Command execution timed out after 30 seconds",
                "duration_ms": duration
            }
        except Exception as e:
            duration = round((time.time() - start_t) * 1000, 2)
            self.metrics.record_command_execution(False, duration)
            return {
                "success": False,
                "command": command_to_run,
                "error": str(e),
                "duration_ms": duration
            }

    async def handle_websocket(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter, headers: Dict[str, str]):
        ws_key = headers.get("sec-websocket-key", "")
        if not ws_key:
            writer.close()
            await writer.wait_closed()
            return

        accept_val = base64.b64encode(
            hashlib.sha1((ws_key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("utf-8")).digest()
        ).decode("utf-8")

        response_headers = [
            "HTTP/1.1 101 Switching Protocols",
            "Upgrade: websocket",
            "Connection: Upgrade",
            f"Sec-WebSocket-Accept: {accept_val}",
            "\r\n"
        ]

        writer.write("\r\n".join(response_headers).encode("utf-8"))
        await writer.drain()

        client = CmdBarWebSocketClient(reader, writer)
        self.active_ws_clients.add(client)
        self.metrics.record_ws_connect()

        # Welcome message
        await client.send_json({
            "type": "connected",
            "server": "CmdBar Headless Server",
            "version": "1.0.0",
            "timestamp": time.time()
        })

        try:
            while True:
                header_bytes = await reader.readexactly(2)
                b1, b2 = header_bytes[0], header_bytes[1]

                fin = bool(b1 & 0x80)
                opcode = b1 & 0x0F
                masked = bool(b2 & 0x80)
                payload_len = b2 & 0x7F

                if opcode == 0x8:  # Connection Close
                    break

                if payload_len == 126:
                    len_bytes = await reader.readexactly(2)
                    payload_len = struct.unpack(">H", len_bytes)[0]
                elif payload_len == 127:
                    len_bytes = await reader.readexactly(8)
                    payload_len = struct.unpack(">Q", len_bytes)[0]

                mask_key = b""
                if masked:
                    mask_key = await reader.readexactly(4)

                payload_bytes = await reader.readexactly(payload_len)
                if masked and mask_key:
                    unmasked = bytearray(payload_bytes)
                    for i in range(len(unmasked)):
                        unmasked[i] ^= mask_key[i % 4]
                    payload_bytes = bytes(unmasked)

                if opcode == 0x9:  # Ping -> Pong
                    writer.write(bytes([0x8A, 0]))
                    await writer.drain()
                    continue

                if opcode == 0x1:  # Text frame
                    msg_str = payload_bytes.decode("utf-8", errors="replace")
                    await self.process_websocket_message(client, msg_str)

        except (asyncio.IncompleteReadError, ConnectionResetError):
            pass
        finally:
            self.active_ws_clients.discard(client)
            self.metrics.record_ws_disconnect()
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass

    async def process_websocket_message(self, client: CmdBarWebSocketClient, message_str: str):
        try:
            msg = json.loads(message_str)
        except Exception:
            await client.send_json({"type": "error", "error": "Invalid JSON message"})
            return

        msg_type = msg.get("type")

        if msg_type == "ping":
            await client.send_json({"type": "pong", "timestamp": time.time()})
            return

        if msg_type == "subscribe":
            topic = msg.get("topic", "events")
            client.subscriptions.add(topic)
            await client.send_json({"type": "subscribed", "topic": topic})
            return

        if msg_type == "unsubscribe":
            topic = msg.get("topic", "events")
            client.subscriptions.discard(topic)
            await client.send_json({"type": "unsubscribed", "topic": topic})
            return

        if msg_type == "execute":
            req_id = msg.get("id")
            cmd_name = msg.get("command_name") or msg.get("name")
            template = msg.get("template") or msg.get("command")
            mode = msg.get("mode", "shell-quoted")
            user_params = msg.get("parameters", {})

            target_cmd = None
            if cmd_name:
                async with self.config_lock:
                    for cat in self.config_data.get("categories", []):
                        for c in cat.get("commands", []):
                            if c.get("name") == cmd_name:
                                target_cmd = c
                                break
                        if target_cmd:
                            break

            if target_cmd:
                template = target_cmd.get("command") or target_cmd.get("template") or ""
                mode = target_cmd.get("mode", mode)
                param_schema = target_cmd.get("parameters", {})
            else:
                param_schema = user_params

            if not template:
                await client.send_json({"type": "execution_failed", "id": req_id, "error": "No valid command or template provided"})
                return

            await client.send_json({"type": "execution_started", "id": req_id})
            result = await self.execute_command(template, mode, user_params, param_schema)
            await client.send_json({
                "type": "execution_finished",
                "id": req_id,
                "result": result
            })
            return

        await client.send_json({"type": "error", "error": f"Unknown message type '{msg_type}'"})

    async def start(self):
        self.server = await asyncio.start_server(
            self.handle_connection,
            self.host,
            self.port
        )
        if self.server.sockets:
            self.port = self.server.sockets[0].getsockname()[1]
        logger.info("CmdBar Headless Server started on %s:%d", self.host, self.port)

    async def stop(self):
        if self.server:
            self.server.close()
            await self.server.wait_closed()
        for client in list(self.active_ws_clients):
            client.writer.close()


def run_server(host: str = "127.0.0.1", port: int = 8080, config_path: Optional[str] = None, auth_token: Optional[str] = None):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    server = CmdBarServer(host=host, port=port, config_path=config_path, auth_token=auth_token)

    loop = asyncio.get_event_loop()
    try:
        loop.run_until_complete(server.start())
        print(f"CmdBar Headless Server listening on http://{host}:{port}")
        loop.run_forever()
    except KeyboardInterrupt:
        print("\nShutting down CmdBar Headless Server...")
    finally:
        loop.run_until_complete(server.stop())


def main():
    parser = argparse.ArgumentParser(description="CmdBar Headless Server Mode")
    parser.add_argument("--host", default="127.0.0.1", help="Host address to bind to (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8080, help="Port to listen on (default: 8080)")
    parser.add_argument("--config", default=None, help="Path to config file")
    parser.add_argument("--auth-token", default=None, help="Authentication token for REST/WS requests")

    args = parser.parse_args()
    run_server(host=args.host, port=args.port, config_path=args.config, auth_token=args.auth_token)


if __name__ == "__main__":
    main()
