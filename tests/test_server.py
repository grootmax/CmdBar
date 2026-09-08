import os
import json
import time
import pytest
import asyncio
import urllib.request
import urllib.error
import base64
import struct
import hashlib
from companion.server import CmdBarServer, ServerMetrics, main as server_main
from app.config_schema import save_config


def sync_http_request(url, method="GET", body=None, headers=None):
    if headers is None:
        headers = {}
    req = urllib.request.Request(url, method=method, headers=headers)
    if body is not None:
        if isinstance(body, dict):
            req.add_header("Content-Type", "application/json")
            data_bytes = json.dumps(body).encode("utf-8")
        elif isinstance(body, str):
            data_bytes = body.encode("utf-8")
        else:
            data_bytes = body
        req.data = data_bytes

    try:
        with urllib.request.urlopen(req) as resp:
            content = resp.read().decode("utf-8")
            status = resp.status
            return status, content
    except urllib.error.HTTPError as e:
        content = e.read().decode("utf-8")
        return e.code, content


async def http_request(url, method="GET", body=None, headers=None):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, sync_http_request, url, method, body, headers)


def test_health_and_version_endpoints(tmp_path):
    async def run():
        config_file = str(tmp_path / "config.json")
        save_config({"categories": []}, config_file)

        server = CmdBarServer(host="127.0.0.1", port=0, config_path=config_file)
        await server.start()

        try:
            base_url = f"http://127.0.0.1:{server.port}"

            status, body = await http_request(f"{base_url}/health")
            assert status == 200
            data = json.loads(body)
            assert data["status"] == "ok"
            assert data["mode"] == "headless"
            assert "uptime_seconds" in data

            status, body = await http_request(f"{base_url}/api/version")
            assert status == 200
            data = json.loads(body)
            assert data["name"] == "CmdBar Headless Server"
            assert data["version"] == "1.0.0"

            # OPTIONS request
            status, _ = await http_request(f"{base_url}/api/version", method="OPTIONS")
            assert status == 200

            # 404 Route
            status, _ = await http_request(f"{base_url}/invalid_route")
            assert status == 404
        finally:
            await server.stop()

    asyncio.run(run())


def test_metrics_monitoring_endpoint(tmp_path):
    async def run():
        config_file = str(tmp_path / "config.json")
        save_config({"categories": []}, config_file)

        server = CmdBarServer(host="127.0.0.1", port=0, config_path=config_file)
        await server.start()

        try:
            base_url = f"http://127.0.0.1:{server.port}"

            # JSON format
            status, body = await http_request(f"{base_url}/metrics")
            assert status == 200
            data = json.loads(body)
            assert "uptime_seconds" in data
            assert "http_requests_total" in data
            assert "websocket_connections_active" in data
            assert "system" in data

            # Prometheus format
            status, body = await http_request(f"{base_url}/metrics?format=prometheus")
            assert status == 200
            assert "# HELP cmdbar_uptime_seconds" in body
            assert "cmdbar_http_requests_total" in body
        finally:
            await server.stop()

    asyncio.run(run())


def test_config_management_api(tmp_path):
    async def run():
        config_file = str(tmp_path / "config.json")
        initial_config = {
            "categories": [
                {
                    "name": "Utilities",
                    "commands": []
                }
            ]
        }
        save_config(initial_config, config_file)

        server = CmdBarServer(host="127.0.0.1", port=0, config_path=config_file)
        await server.start()

        try:
            base_url = f"http://127.0.0.1:{server.port}"

            # GET config
            status, body = await http_request(f"{base_url}/api/config")
            assert status == 200
            cfg = json.loads(body)
            assert len(cfg["categories"]) == 1
            assert cfg["categories"][0]["name"] == "Utilities"

            # PUT config
            new_cfg = {
                "categories": [
                    {
                        "name": "Dev Tools",
                        "commands": [
                            {
                                "name": "Git Status",
                                "command": "git status",
                                "mode": "shell-quoted",
                                "parameters": {}
                            }
                        ]
                    }
                ]
            }
            status, body = await http_request(f"{base_url}/api/config", method="PUT", body=new_cfg)
            assert status == 200

            status, body = await http_request(f"{base_url}/api/config")
            assert status == 200
            cfg = json.loads(body)
            assert cfg["categories"][0]["name"] == "Dev Tools"

            # Test reload from disk
            server.reload_config_from_disk()
            assert server.config_data["categories"][0]["name"] == "Dev Tools"
        finally:
            await server.stop()

    asyncio.run(run())


def test_categories_and_commands_api_errors_and_edge_cases(tmp_path):
    async def run():
        config_file = str(tmp_path / "config.json")
        save_config({"categories": []}, config_file)

        server = CmdBarServer(host="127.0.0.1", port=0, config_path=config_file)
        await server.start()

        try:
            base_url = f"http://127.0.0.1:{server.port}"

            # POST empty category name
            status, body = await http_request(f"{base_url}/api/categories", method="POST", body={"name": ""})
            assert status == 400

            # POST category
            status, body = await http_request(f"{base_url}/api/categories", method="POST", body={"name": "Database"})
            assert status == 201

            # Duplicate category
            status, body = await http_request(f"{base_url}/api/categories", method="POST", body={"name": "Database"})
            assert status == 400

            # POST command missing name
            status, body = await http_request(f"{base_url}/api/commands", method="POST", body={"category": "Database", "name": "", "command": "echo test"})
            assert status == 400

            # POST valid command
            new_cmd = {
                "category": "Database",
                "name": "DB Ping",
                "command": "echo db_ok",
                "mode": "shell-quoted",
                "parameters": {}
            }
            status, body = await http_request(f"{base_url}/api/commands", method="POST", body=new_cmd)
            assert status == 201

            # PUT command update
            put_req = {"name": "DB Ping Updated", "command": "echo db_updated"}
            status, body = await http_request(f"{base_url}/api/commands/DB%20Ping", method="PUT", body=put_req)
            assert status == 200

            # PUT non-existent command
            status, body = await http_request(f"{base_url}/api/commands/NonExistent", method="PUT", body=put_req)
            assert status == 404

            # DELETE non-existent category
            status, body = await http_request(f"{base_url}/api/categories/NonExistent", method="DELETE")
            assert status == 404

            # DELETE category
            status, body = await http_request(f"{base_url}/api/categories/Database", method="DELETE")
            assert status == 200
        finally:
            await server.stop()

    asyncio.run(run())


def test_command_execution_modes_and_errors(tmp_path):
    async def run():
        config_file = str(tmp_path / "config.json")
        initial_config = {
            "categories": [
                {
                    "name": "Utilities",
                    "commands": [
                        {
                            "name": "Echo Shell",
                            "command": "echo Hello {msg}",
                            "mode": "shell-quoted",
                            "parameters": {
                                "msg": {
                                    "regex": "^[a-zA-Z0-9_]+$",
                                    "error_message": "Alphanumeric only"
                                }
                            }
                        },
                        {
                            "name": "Echo Direct",
                            "command": "/usr/bin/echo Direct {msg}",
                            "mode": "direct-array",
                            "parameters": {}
                        }
                    ]
                }
            ]
        }
        save_config(initial_config, config_file)

        server = CmdBarServer(host="127.0.0.1", port=0, config_path=config_file)
        await server.start()

        try:
            base_url = f"http://127.0.0.1:{server.port}"

            # Shell mode execution by command_name
            exec_req_name = {
                "command_name": "Echo Shell",
                "parameters": {"msg": "NameExec"}
            }
            status, body = await http_request(f"{base_url}/api/execute", method="POST", body=exec_req_name)
            assert status == 200
            res = json.loads(body)
            assert res["success"] is True
            assert "Hello" in res["stdout"]

            # Direct array mode execution
            exec_req = {
                "command_name": "Echo Direct",
                "parameters": {"msg": "ArrayVal"}
            }
            status, body = await http_request(f"{base_url}/api/execute", method="POST", body=exec_req)
            assert status == 200
            res = json.loads(body)
            assert res["success"] is True
            assert "Direct ArrayVal" in res["stdout"]

            # Direct ad-hoc template execution
            adhoc_req = {
                "template": "echo AdHoc {val}",
                "mode": "shell-quoted",
                "parameters": {"val": "Test123"}
            }
            status, body = await http_request(f"{base_url}/api/execute", method="POST", body=adhoc_req)
            assert status == 200
            res = json.loads(body)
            assert res["success"] is True
            assert "AdHoc Test123" in res["stdout"]

            # Missing template and non-existent command name
            bad_req = {
                "command_name": "NonExistentCmd"
            }
            status, body = await http_request(f"{base_url}/api/execute", method="POST", body=bad_req)
            assert status == 400
        finally:
            await server.stop()

    asyncio.run(run())


def test_auth_token_protection(tmp_path):
    async def run():
        config_file = str(tmp_path / "config.json")
        save_config({"categories": []}, config_file)

        server = CmdBarServer(host="127.0.0.1", port=0, config_path=config_file, auth_token="secret123")
        await server.start()

        try:
            base_url = f"http://127.0.0.1:{server.port}"

            # Unauthorized
            status, body = await http_request(f"{base_url}/api/config")
            assert status == 401

            # Authorized via header
            status, body = await http_request(f"{base_url}/api/config", headers={"Authorization": "Bearer secret123"})
            assert status == 200

            # Authorized via query parameter
            status, body = await http_request(f"{base_url}/api/config?token=secret123")
            assert status == 200
        finally:
            await server.stop()

    asyncio.run(run())


def test_websocket_messaging_and_subscriptions(tmp_path):
    async def run():
        config_file = str(tmp_path / "config.json")
        initial_config = {
            "categories": [
                {
                    "name": "Utilities",
                    "commands": [
                        {
                            "name": "Echo WS",
                            "command": "echo WS_CMD {val}",
                            "mode": "shell-quoted",
                            "parameters": {}
                        }
                    ]
                }
            ]
        }
        save_config(initial_config, config_file)

        server = CmdBarServer(host="127.0.0.1", port=0, config_path=config_file)
        await server.start()

        try:
            reader, writer = await asyncio.open_connection("127.0.0.1", server.port)

            sec_key = "dGhlIHNhbXBsZSBub25jZQ=="
            req = (
                f"GET /ws HTTP/1.1\r\n"
                f"Host: 127.0.0.1:{server.port}\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {sec_key}\r\n"
                "Sec-WebSocket-Version: 13\r\n\r\n"
            )
            writer.write(req.encode("utf-8"))
            await writer.drain()

            # Read handshake response
            resp = await reader.readuntil(b"\r\n\r\n")
            resp_str = resp.decode("utf-8")
            assert "101 Switching Protocols" in resp_str

            def send_ws_json(obj):
                msg_bytes = json.dumps(obj).encode("utf-8")
                mask = b"\x01\x02\x03\x04"
                masked_payload = bytearray(len(msg_bytes))
                for i in range(len(msg_bytes)):
                    masked_payload[i] = msg_bytes[i] ^ mask[i % 4]

                frame = bytearray()
                frame.append(0x81)  # FIN + text
                frame.append(len(msg_bytes) | 0x80)
                frame.extend(mask)
                frame.extend(masked_payload)
                writer.write(frame)

            async def read_ws_json():
                hdr = await reader.readexactly(2)
                p_len = hdr[1] & 0x7F
                if p_len == 126:
                    len_bytes = await reader.readexactly(2)
                    p_len = struct.unpack(">H", len_bytes)[0]
                elif p_len == 127:
                    len_bytes = await reader.readexactly(8)
                    p_len = struct.unpack(">Q", len_bytes)[0]

                p_bytes = await reader.readexactly(p_len)
                return json.loads(p_bytes.decode("utf-8"))

            # Read welcome message frame
            welcome_json = await read_ws_json()
            assert welcome_json["type"] == "connected"

            # Ping test
            send_ws_json({"type": "ping"})
            await writer.drain()
            pong_res = await read_ws_json()
            assert pong_res["type"] == "pong"

            # Unknown message type test
            send_ws_json({"type": "unknown_action"})
            await writer.drain()
            err_res = await read_ws_json()
            assert err_res["type"] == "error"

            # Subscribe topic
            send_ws_json({"type": "subscribe", "topic": "events"})
            await writer.drain()
            sub_res = await read_ws_json()
            assert sub_res["type"] == "subscribed"

            # Execute command over WS by name
            send_ws_json({
                "type": "execute",
                "id": "ws-req-1",
                "command_name": "Echo WS",
                "parameters": {"val": "123"}
            })
            await writer.drain()

            res_start = await read_ws_json()
            assert res_start["type"] == "execution_started"

            res_finish = await read_ws_json()
            assert res_finish["type"] == "execution_finished"
            assert res_finish["result"]["success"] is True

            # Unsubscribe topic
            send_ws_json({"type": "unsubscribe", "topic": "events"})
            await writer.drain()
            unsub_res = await read_ws_json()
            assert unsub_res["type"] == "unsubscribed"

            # Trigger broadcast event from server
            await server.broadcast_event("test_event", {"hello": "world"}, topic="events")

            writer.close()
            await writer.wait_closed()
        finally:
            await server.stop()

    asyncio.run(run())


def test_server_metrics_unit():
    metrics = ServerMetrics()
    metrics.record_http_request("GET", "/health", 200)
    metrics.record_ws_connect()
    metrics.record_command_execution(True, 12.5)
    metrics.record_command_execution(False, 5.0)
    metrics.record_ws_disconnect()

    d = metrics.to_dict()
    assert d["http_requests_total"] == 1
    assert d["websocket_connections_total"] == 1
    assert d["websocket_connections_active"] == 0
    assert d["commands_executed_total"] == 2
    assert d["commands_succeeded_total"] == 1
    assert d["commands_failed_total"] == 1

    prom = metrics.to_prometheus_text()
    assert "cmdbar_uptime_seconds" in prom


def test_main_cli_arg_parser():
    import sys
    test_args = ["cmdbar-server", "--host", "127.0.0.1", "--port", "0"]
    orig_argv = sys.argv
    try:
        sys.argv = test_args
        # Mock run_server inside main to avoid blocking loop
        import companion.server
        called = False
        def mock_run_server(host, port, config_path, auth_token):
            nonlocal called
            called = True
            assert host == "127.0.0.1"
            assert port == 0

        orig_run_server = companion.server.run_server
        companion.server.run_server = mock_run_server
        try:
            server_main()
            assert called is True
        finally:
            companion.server.run_server = orig_run_server
    finally:
        sys.argv = orig_argv


def test_systemd_service_file():
    service_path = "/app/CmdBar/systemd/cmdbar-server.service"
    assert os.path.exists(service_path)
    with open(service_path, "r") as f:
        content = f.read()

    assert "[Unit]" in content
    assert "Description=" in content
    assert "[Service]" in content
    assert "ExecStart=" in content
    assert "Restart=always" in content
    assert "[Install]" in content
