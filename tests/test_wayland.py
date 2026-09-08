import os
import sys
import json
import time
import socket
import tempfile
import subprocess
from unittest.mock import patch, MagicMock
import pytest

from companion.wayland import (
    CompositorType,
    detect_compositor,
    TilingWindowManager,
    format_output_python,
    WaylandIPCServer,
    send_ipc_request,
    copy_to_clipboard,
    paste_from_clipboard,
    get_default_socket_path
)


# =====================================================================
# 1. COMPOSITOR DETECTION TESTS
# =====================================================================

def test_detect_compositor_hyprland():
    with patch.dict(os.environ, {"HYPRLAND_INSTANCE_SIGNATURE": "12345", "XDG_CURRENT_DESKTOP": "Hyprland"}, clear=True):
        assert detect_compositor() == CompositorType.HYPRLAND

def test_detect_compositor_sway():
    with patch.dict(os.environ, {"SWAYSOCK": "/run/user/1000/sway.sock", "XDG_CURRENT_DESKTOP": "sway"}, clear=True):
        assert detect_compositor() == CompositorType.SWAY

def test_detect_compositor_i3():
    with patch.dict(os.environ, {"I3SOCK": "/run/user/1000/i3.sock", "XDG_CURRENT_DESKTOP": "i3"}, clear=True):
        assert detect_compositor() == CompositorType.I3

def test_detect_compositor_wayland_generic():
    with patch.dict(os.environ, {"WAYLAND_DISPLAY": "wayland-0", "XDG_SESSION_TYPE": "wayland"}, clear=True):
        assert detect_compositor() == CompositorType.WAYLAND

def test_detect_compositor_x11_generic():
    with patch.dict(os.environ, {"DISPLAY": ":0", "XDG_SESSION_TYPE": "x11"}, clear=True):
        assert detect_compositor() == CompositorType.X11

def test_detect_compositor_unknown():
    with patch.dict(os.environ, {}, clear=True):
        assert detect_compositor() == CompositorType.UNKNOWN


# =====================================================================
# 2. TILING WINDOW MANAGER TESTS
# =====================================================================

def test_hyprland_active_window_parsing():
    hypr_json = json.dumps({
        "address": "0x12345678",
        "mapped": True,
        "hidden": False,
        "at": [100, 200],
        "size": [800, 600],
        "workspace": {"id": 2, "name": "2:code"},
        "floating": True,
        "pid": 4321,
        "title": "Neovim - main.py",
        "class": "foot"
    })
    
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0, stdout=hypr_json)
        mgr = TilingWindowManager(compositor=CompositorType.HYPRLAND)
        win = mgr.get_active_window()
        
        assert win["title"] == "Neovim - main.py"
        assert win["class"] == "foot"
        assert win["workspace"] == "2:code"
        assert win["floating"] is True
        assert win["x"] == 100
        assert win["y"] == 200
        assert win["width"] == 800
        assert win["height"] == 600

def test_sway_active_window_parsing():
    sway_tree = {
        "id": 1,
        "name": "root",
        "nodes": [
            {
                "id": 2,
                "name": "1:dev",
                "type": "workspace",
                "nodes": [
                    {
                        "id": 10,
                        "name": "Terminal",
                        "app_id": "alacritty",
                        "focused": True,
                        "type": "con",
                        "rect": {"x": 0, "y": 0, "width": 1920, "height": 1080},
                        "pid": 1234
                    }
                ]
            }
        ]
    }
    
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0, stdout=json.dumps(sway_tree))
        mgr = TilingWindowManager(compositor=CompositorType.SWAY)
        win = mgr.get_active_window()
        
        assert win["title"] == "Terminal"
        assert win["class"] == "alacritty"
        assert win["workspace"] == "1:dev"
        assert win["floating"] is False

def test_tiling_context_params():
    mgr = TilingWindowManager(compositor=CompositorType.HYPRLAND)
    mock_win = {
        "title": "Project VSCode",
        "class": "code",
        "address": "0xabc",
        "floating": True,
        "workspace": "3",
        "pid": 999,
        "x": 0, "y": 0, "width": 100, "height": 100,
        "compositor": CompositorType.HYPRLAND
    }
    with patch.object(mgr, "get_active_window", return_value=mock_win):
        ctx = mgr.get_context_params()
        assert ctx["active_window"] == "Project VSCode"
        assert ctx["active_class"] == "code"
        assert ctx["workspace"] == "3"
        assert ctx["compositor"] == CompositorType.HYPRLAND
        assert ctx["floating"] == "true"

def test_apply_floating_rule():
    with patch("subprocess.run") as mock_run:
        mgr = TilingWindowManager(compositor=CompositorType.HYPRLAND)
        assert mgr.apply_floating_rule("CmdBar", "CmdBar") is True
        assert mock_run.call_count >= 1

        mock_run.reset_mock()
        mgr_sway = TilingWindowManager(compositor=CompositorType.SWAY)
        assert mgr_sway.apply_floating_rule("CmdBar", "CmdBar") is True
        assert mock_run.call_count >= 1


# =====================================================================
# 3. OUTPUT FORMATTING TESTS
# =====================================================================

def test_format_output_python_json():
    raw = '{"name": "cmdbar", "status": "active"}'
    fmt = format_output_python(raw)
    assert fmt["format"] == "json"
    assert "  \"name\": \"cmdbar\"" in fmt["text"]

def test_format_output_python_csv():
    raw = "Header1,Header2\nValue1,Value2\nVal3,Val4"
    fmt = format_output_python(raw)
    assert fmt["format"] == "csv"
    assert "+---------+---------+" in fmt["text"]

def test_format_output_python_code():
    raw = "def hello_world():\n    return 'Hello'"
    fmt = format_output_python(raw)
    assert fmt["format"] == "code"
    assert fmt["text"].startswith("```")


# =====================================================================
# 4. JSON IPC SERVER & PROTOCOL TESTS
# =====================================================================

@pytest.fixture
def temp_ipc_server():
    with tempfile.TemporaryDirectory() as tmpdir:
        sock_path = os.path.join(tmpdir, "test_cmdbar.sock")
        config_path = os.path.join(tmpdir, "config.json")
        os.environ["CMDBAR_IPC_SOCKET"] = sock_path
        os.environ["CMDBAR_CONFIG_PATH"] = config_path

        # Create a known test configuration
        test_config = {
            "categories": [
                {
                    "name": "Git Operations",
                    "commands": [
                        {
                            "name": "Git Status",
                            "template": "git status",
                            "usage_count": 5
                        },
                        {
                            "name": "Git Checkout",
                            "template": "git checkout {branch}",
                            "parameters": {
                                "branch": {
                                    "regex": "^[a-zA-Z0-9_\\-/\\.]+$",
                                    "placeholder": "Enter branch name"
                                }
                            }
                        }
                    ]
                }
            ]
        }
        with open(config_path, "w") as f:
            json.dump(test_config, f)

        server = WaylandIPCServer(socket_path=sock_path)
        server.start(background=True)
        time.sleep(0.1) # allow thread to bind socket
        yield server, sock_path
        server.stop()
        os.environ.pop("CMDBAR_IPC_SOCKET", None)
        os.environ.pop("CMDBAR_CONFIG_PATH", None)

def test_ipc_ping(temp_ipc_server):
    server, sock_path = temp_ipc_server
    req = {"action": "ping"}
    resp = send_ipc_request(req, socket_path=sock_path)
    assert resp["status"] == "ok"
    assert resp["message"] == "pong"
    assert "compositor" in resp

def test_ipc_get_config(temp_ipc_server):
    server, sock_path = temp_ipc_server
    req = {"action": "get_config"}
    resp = send_ipc_request(req, socket_path=sock_path)
    assert resp["status"] == "ok"
    assert "categories" in resp["config"]

def test_ipc_list_commands_and_categories(temp_ipc_server):
    server, sock_path = temp_ipc_server
    
    req_cat = {"action": "list_categories"}
    resp_cat = send_ipc_request(req_cat, socket_path=sock_path)
    assert resp_cat["status"] == "ok"
    assert len(resp_cat["categories"]) > 0

    req_cmds = {"action": "list_commands"}
    resp_cmds = send_ipc_request(req_cmds, socket_path=sock_path)
    assert resp_cmds["status"] == "ok"
    assert len(resp_cmds["commands"]) > 0

def test_ipc_search(temp_ipc_server):
    server, sock_path = temp_ipc_server
    req = {"action": "search", "query": "git"}
    resp = send_ipc_request(req, socket_path=sock_path)
    assert resp["status"] == "ok"
    assert len(resp["results"]) > 0

def test_ipc_execute_dry_run(temp_ipc_server):
    server, sock_path = temp_ipc_server
    req = {
        "action": "execute",
        "command": "echo {msg}",
        "params": {"msg": "Hello Wayland"},
        "dry_run": True
    }
    resp = send_ipc_request(req, socket_path=sock_path)
    assert resp["status"] == "ok"
    assert resp["dry_run"] is True
    assert resp["command"] == "echo 'Hello Wayland'"

def test_ipc_execute_with_tiling_context(temp_ipc_server):
    server, sock_path = temp_ipc_server
    
    mock_ctx = {
        "active_window": "MyTerminal",
        "active_title": "MyTerminal",
        "active_class": "foot",
        "workspace": "work",
        "compositor": "hyprland",
        "floating": "false"
    }
    
    with patch.object(server.tiling_mgr, "get_context_params", return_value=mock_ctx):
        req = {
            "action": "execute",
            "command": "echo Window: {active_window} Workspace: {workspace}",
            "dry_run": True
        }
        resp = send_ipc_request(req, socket_path=sock_path)
        assert resp["status"] == "ok"
        assert "MyTerminal" in resp["command"]
        assert "work" in resp["command"]

def test_ipc_execute_validation_failure(temp_ipc_server):
    server, sock_path = temp_ipc_server
    req = {
        "action": "execute",
        "command": "git checkout {branch}",
        "params": {} # Missing branch parameter
    }
    resp = send_ipc_request(req, socket_path=sock_path)
    assert resp["status"] == "error"
    assert "Missing required parameter" in resp["error"]

def test_ipc_ai_translate(temp_ipc_server):
    server, sock_path = temp_ipc_server
    req = {
        "action": "ai_translate",
        "prompt": "list all files in current directory"
    }
    with patch("companion.wayland.translate_natural_language_to_command", return_value=("ls -la", "mock_ai")):
        resp = send_ipc_request(req, socket_path=sock_path)
        assert resp["status"] == "ok"
        assert resp["command"] == "ls -la"

def test_ipc_invalid_request(temp_ipc_server):
    server, sock_path = temp_ipc_server
    req = {"action": "non_existent_action"}
    resp = send_ipc_request(req, socket_path=sock_path)
    assert resp["status"] == "error"
    assert "Unknown action" in resp["error"]


# =====================================================================
# 5. PERFORMANCE BENCHMARK & SECURITY TESTS
# =====================================================================

def test_ipc_performance_benchmark(temp_ipc_server):
    server, sock_path = temp_ipc_server
    
    req = {"action": "ping"}
    start = time.time()
    num_requests = 50
    for _ in range(num_requests):
        resp = send_ipc_request(req, socket_path=sock_path)
        assert resp["status"] == "ok"
    duration = time.time() - start
    avg_latency_ms = (duration / num_requests) * 1000
    
    # Verify performance requirement (average latency under 10ms per IPC request)
    assert avg_latency_ms < 10.0, f"Average IPC latency was {avg_latency_ms:.2f}ms, expected < 10ms"

def test_socket_security_permissions(temp_ipc_server):
    server, sock_path = temp_ipc_server
    st = os.stat(sock_path)
    # Permissions must be 0600 (owner read/write only)
    assert (st.st_mode & 0o777) == 0o600
