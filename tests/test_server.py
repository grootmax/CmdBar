import os
import sys
import time
import json
import urllib.request
import urllib.error
import urllib.parse
import tempfile
import socket
import struct
import base64
import hashlib
import pytest

from companion.server import (
    CmdBarServer,
    WebSocketFrame,
    get_systemd_unit_content,
    install_systemd_service,
    uninstall_systemd_service,
    status_systemd_service,
)
from companion.companion_app import get_config_path, init_config, save_config, load_config


@pytest.fixture
def temp_config_env():
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        tmp_path = tmp.name
    os.environ["CMDBAR_CONFIG_PATH"] = tmp_path
    init_config()
    yield tmp_path
    if os.path.exists(tmp_path):
        os.remove(tmp_path)
    if os.path.exists(tmp_path + ".tmp"):
        os.remove(tmp_path + ".tmp")
    os.environ.pop("CMDBAR_CONFIG_PATH", None)


def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def running_server(temp_config_env):
    port = find_free_port()
    server = CmdBarServer(host="127.0.0.1", port=port, config_path=temp_config_env)
    server.start(block=False)
    time.sleep(0.3)
    yield ("127.0.0.1", port, temp_config_env)
    server.stop()


def make_request(host, port, path, method="GET", body=None, headers=None):
    url = f"http://{host}:{port}{path}"
    req = urllib.request.Request(url, method=method)
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    if body is not None:
        if isinstance(body, dict) or isinstance(body, list):
            data_bytes = json.dumps(body).encode("utf-8")
            req.add_header("Content-Type", "application/json")
        elif isinstance(body, str):
            data_bytes = body.encode("utf-8")
        else:
            data_bytes = body
        req.data = data_bytes

    try:
        with urllib.request.urlopen(req) as resp:
            status = resp.status
            resp_body = resp.read().decode("utf-8")
            try:
                json_data = json.loads(resp_body)
            except Exception:
                json_data = resp_body
            return status, json_data
    except urllib.error.HTTPError as e:
        resp_body = e.read().decode("utf-8")
        try:
            json_data = json.loads(resp_body)
        except Exception:
            json_data = resp_body
        return e.code, json_data


def test_health_and_monitoring_endpoints(running_server):
    host, port, _ = running_server

    status, data = make_request(host, port, "/health")
    assert status == 200
    assert data.get("status") == "ok"
    assert "uptime_seconds" in data

    status, data = make_request(host, port, "/api/v1/health")
    assert status == 200
    assert data.get("status") == "ok"

    status, metrics = make_request(host, port, "/api/v1/monitoring")
    assert status == 200
    assert metrics.get("status") == "ok"
    assert "server" in metrics
    assert "metrics" in metrics
    assert "system" in metrics
    assert "config" in metrics


def test_config_rest_api(running_server):
    host, port, config_path = running_server

    # GET config
    status, config = make_request(host, port, "/api/v1/config")
    assert status == 200
    assert "categories" in config

    # PUT config
    new_config = {
        "categories": [
            {
                "name": "Server Test Category",
                "commands": [
                    {
                        "name": "Server Echo",
                        "template": "echo {msg}",
                        "parameters": {
                            "msg": {
                                "placeholder": "Message"
                            }
                        }
                    }
                ]
            }
        ]
    }
    status, resp = make_request(host, port, "/api/v1/config", method="PUT", body=new_config)
    assert status == 200
    assert resp.get("success") is True

    # Verify updated config via GET
    status, updated_config = make_request(host, port, "/api/v1/config")
    assert status == 200
    assert updated_config["categories"][0]["name"] == "Server Test Category"


def test_shortcuts_crud_rest_api(running_server):
    host, port, _ = running_server

    # Add Shortcut
    new_shortcut = {
        "category": "Deployment",
        "name": "Deploy Staging",
        "command": "echo Deploying to {env}",
        "parameters": {
            "env": {
                "regex": "^[a-zA-Z0-9_-]+$"
            }
        }
    }
    status, resp = make_request(host, port, "/api/v1/shortcuts", method="POST", body=new_shortcut)
    assert status == 201
    assert resp.get("success") is True
    assert resp.get("shortcut", {}).get("name") == "Deploy Staging"

    # GET All Shortcuts
    status, shortcuts = make_request(host, port, "/api/v1/shortcuts")
    assert status == 200
    assert any(s.get("name") == "Deploy Staging" for s in shortcuts)

    # GET Shortcut By Name
    status, shortcut = make_request(host, port, "/api/v1/shortcuts/Deploy%20Staging")
    assert status == 200
    assert shortcut.get("name") == "Deploy Staging"

    # UPDATE Shortcut
    update_data = {
        "template": "echo Updated deployment to {env}"
    }
    status, resp = make_request(host, port, "/api/v1/shortcuts/Deploy%20Staging", method="PUT", body=update_data)
    assert status == 200
    assert resp.get("success") is True

    # DELETE Shortcut
    status, resp = make_request(host, port, "/api/v1/shortcuts/Deploy%20Staging", method="DELETE")
    assert status == 200
    assert resp.get("success") is True

    # GET Deleted Shortcut -> 404
    status, _ = make_request(host, port, "/api/v1/shortcuts/Deploy%20Staging")
    assert status == 404


def test_execute_rest_api(running_server):
    host, port, _ = running_server

    # Add a parameterized shortcut
    new_shortcut = {
        "category": "Testing",
        "name": "Echo Param",
        "command": "echo Hello {target}",
        "parameters": {
            "target": {
                "regex": "^[a-zA-Z0-9_-]+$",
                "error_message": "Invalid target name"
            }
        }
    }
    status, _ = make_request(host, port, "/api/v1/shortcuts", method="POST", body=new_shortcut)
    assert status == 201

    # Execute with valid parameter
    exec_payload = {
        "name": "Echo Param",
        "parameters": {
            "target": "World"
        }
    }
    status, exec_res = make_request(host, port, "/api/v1/execute", method="POST", body=exec_payload)
    assert status == 200
    assert exec_res.get("success") is True
    assert exec_res.get("exit_code") == 0
    assert "Hello World" in exec_res.get("stdout")

    # Execute shortcut endpoint
    status, exec_res = make_request(host, port, "/api/v1/shortcuts/Echo%20Param/execute", method="POST", body={"parameters": {"target": "CmdBar"}})
    assert status == 200
    assert exec_res.get("success") is True
    assert "Hello CmdBar" in exec_res.get("stdout")

    # Execute with invalid parameter pattern -> 400
    invalid_payload = {
        "name": "Echo Param",
        "parameters": {
            "target": "World; rm -rf /"
        }
    }
    status, err_res = make_request(host, port, "/api/v1/execute", method="POST", body=invalid_payload)
    assert status == 400
    assert "Invalid target name" in err_res.get("error")


def test_ai_translate_rest_api(running_server, monkeypatch):
    host, port, _ = running_server

    # Test success with mocked AI translator
    monkeypatch.setattr("companion.server.translate_natural_language_to_command", lambda prompt: "ls -la")

    payload = {"prompt": "list all files in directory"}
    status, res = make_request(host, port, "/api/v1/ai/translate", method="POST", body=payload)
    assert status == 200
    assert res.get("prompt") == "list all files in directory"
    assert res.get("command") == "ls -la"

    # Test error handling when AI translation fails
    def raise_err(prompt):
        raise RuntimeError("API key invalid")

    monkeypatch.setattr("companion.server.translate_natural_language_to_command", raise_err)
    status, err_res = make_request(host, port, "/api/v1/ai/translate", method="POST", body=payload)
    assert status == 500
    assert "API key invalid" in err_res.get("error")


def test_websocket_interface(running_server):
    host, port, _ = running_server

    # Establish raw socket connection for WebSocket handshake
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.connect((host, port))

    ws_key = base64.b64encode(os.urandom(16)).decode('utf-8')
    handshake_req = (
        f"GET /ws HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        f"Upgrade: websocket\r\n"
        f"Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {ws_key}\r\n"
        f"Sec-WebSocket-Version: 13\r\n\r\n"
    )
    s.sendall(handshake_req.encode('utf-8'))

    # Read handshake response
    rfile = s.makefile('rb')
    handshake_resp = rfile.readline().decode('utf-8')
    assert "101 Switching Protocols" in handshake_resp

    # Consume remaining headers
    while True:
        line = rfile.readline().decode('utf-8')
        if line == "\r\n" or not line:
            break

    # 1. Send Ping -> expect Pong
    ping_payload = json.dumps({"action": "ping"})
    # Masked text frame from client
    mask = b"\x01\x02\x03\x04"
    p_bytes = ping_payload.encode('utf-8')
    masked_payload = bytearray([b ^ mask[i % 4] for i, b in enumerate(p_bytes)])

    frame = bytearray()
    frame.append(0x81)  # FIN + Text
    frame.append(0x80 | len(p_bytes))  # Masked + length
    frame.extend(mask)
    frame.extend(masked_payload)

    s.sendall(bytes(frame))

    # Read server response frame
    ws_frame = WebSocketFrame.decode_from_rfile(rfile)
    assert ws_frame is not None
    msg_data = json.loads(ws_frame.payload.decode('utf-8'))
    assert msg_data.get("event") == "pong"

    # 2. Send Execute via WebSocket
    exec_msg = json.dumps({
        "action": "execute",
        "command": "echo WS Exec {var}",
        "parameters": {"var": "Testing"}
    })
    p_bytes = exec_msg.encode('utf-8')
    masked_payload = bytearray([b ^ mask[i % 4] for i, b in enumerate(p_bytes)])

    frame = bytearray()
    frame.append(0x81)
    frame.append(0x80 | len(p_bytes))
    frame.extend(mask)
    frame.extend(masked_payload)

    s.sendall(bytes(frame))

    # Read started event
    start_frame = WebSocketFrame.decode_from_rfile(rfile)
    assert start_frame is not None
    start_evt = json.loads(start_frame.payload.decode('utf-8'))
    assert start_evt.get("event") == "started"

    # Read completed event
    comp_frame = WebSocketFrame.decode_from_rfile(rfile)
    assert comp_frame is not None
    comp_evt = json.loads(comp_frame.payload.decode('utf-8'))
    assert comp_evt.get("event") == "completed"
    assert comp_evt.get("success") is True
    assert "WS Exec Testing" in comp_evt.get("stdout")

    # 3. Send get_config over WS
    gc_msg = json.dumps({"action": "get_config"})
    p_bytes = gc_msg.encode('utf-8')
    masked_payload = bytearray([b ^ mask[i % 4] for i, b in enumerate(p_bytes)])
    frame = bytearray([0x81, 0x80 | len(p_bytes)]) + mask + masked_payload
    s.sendall(bytes(frame))

    gc_frame = WebSocketFrame.decode_from_rfile(rfile)
    assert gc_frame is not None
    gc_evt = json.loads(gc_frame.payload.decode('utf-8'))
    assert gc_evt.get("event") == "config"

    # 4. Send subscribe over WS
    sub_msg = json.dumps({"action": "subscribe"})
    p_bytes = sub_msg.encode('utf-8')
    masked_payload = bytearray([b ^ mask[i % 4] for i, b in enumerate(p_bytes)])
    frame = bytearray([0x81, 0x80 | len(p_bytes)]) + mask + masked_payload
    s.sendall(bytes(frame))

    sub_frame = WebSocketFrame.decode_from_rfile(rfile)
    assert sub_frame is not None
    sub_evt = json.loads(sub_frame.payload.decode('utf-8'))
    assert sub_evt.get("event") == "subscribed"

    # 5. Send raw Ping opcode (0x9) frame
    ping_frame = bytearray([0x89, 0x80, 0x01, 0x02, 0x03, 0x04]) # empty masked ping frame
    s.sendall(bytes(ping_frame))

    pong_frame = WebSocketFrame.decode_from_rfile(rfile)
    assert pong_frame is not None
    assert pong_frame.opcode == WebSocketFrame.OP_PONG

    s.close()


def test_server_options_and_error_cases(running_server):
    host, port, _ = running_server

    # OPTIONS preflight
    status, res = make_request(host, port, "/api/v1/shortcuts", method="OPTIONS")
    assert status == 204

    # GET invalid endpoint -> 404
    status, err = make_request(host, port, "/api/v1/unknown")
    assert status == 404

    # POST invalid JSON payload -> 400
    status, err = make_request(host, port, "/api/v1/config", method="POST", body="invalid json{")
    assert status == 400

    # POST execute missing name and command -> 400
    status, err = make_request(host, port, "/api/v1/execute", method="POST", body={})
    assert status == 400

    # PUT unknown shortcut -> 404
    status, err = make_request(host, port, "/api/v1/shortcuts/NonExistent", method="PUT", body={"template": "echo 1"})
    assert status == 404

    # DELETE unknown shortcut -> 404
    status, err = make_request(host, port, "/api/v1/shortcuts/NonExistent", method="DELETE")
    assert status == 404


def test_cli_main_entrypoint(monkeypatch, temp_config_env):
    from companion.server import main

    # Test --version
    monkeypatch.setattr("sys.argv", ["server.py", "--version"])
    with pytest.raises(SystemExit):
        main()

    # Test --status-service
    monkeypatch.setattr("sys.argv", ["server.py", "--status-service"])
    main()

    # Test --install-service
    monkeypatch.setattr("sys.argv", ["server.py", "--install-service", "--config", temp_config_env])
    main()

    # Test --uninstall-service
    monkeypatch.setattr("sys.argv", ["server.py", "--uninstall-service"])
    main()


def test_systemd_service_helpers(temp_config_env):
    unit_content = get_systemd_unit_content(host="127.0.0.1", port=9090, config_path=temp_config_env)
    assert "[Unit]" in unit_content
    assert "[Service]" in unit_content
    assert "ExecStart=" in unit_content
    assert "127.0.0.1" in unit_content
    assert "9090" in unit_content

    # Install service
    success = install_systemd_service(host="127.0.0.1", port=9090, config_path=temp_config_env)
    assert success is True

    # Status service
    installed = status_systemd_service()
    assert installed is True

    # Uninstall service
    uninstalled = uninstall_systemd_service()
    assert uninstalled is True
