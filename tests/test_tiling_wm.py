import os
import json
import struct
import socket
import tempfile
import pytest
from unittest.mock import patch, MagicMock

from companion.tiling_wm import (
    detect_compositor,
    HyprlandIPC,
    SwayIPC,
    TilingWMManager,
    IPC_RUN_COMMAND,
    IPC_GET_WORKSPACES,
    IPC_GET_OUTPUTS,
    IPC_GET_TREE
)


def test_detect_compositor_hyprland():
    with patch.dict(os.environ, {"HYPRLAND_INSTANCE_SIGNATURE": "12345"}, clear=True):
        assert detect_compositor() == "hyprland"


def test_detect_compositor_sway():
    with patch.dict(os.environ, {"SWAYSOCK": "/tmp/sway.sock"}, clear=True):
        assert detect_compositor() == "sway"


def test_detect_compositor_i3():
    with patch.dict(os.environ, {"I3SOCK": "/tmp/i3.sock"}, clear=True):
        assert detect_compositor() == "i3"


def test_detect_compositor_xdg_desktop():
    with patch.dict(os.environ, {"XDG_CURRENT_DESKTOP": "Hyprland"}, clear=True):
        assert detect_compositor() == "hyprland"

    with patch.dict(os.environ, {"XDG_CURRENT_DESKTOP": "sway"}, clear=True):
        assert detect_compositor() == "sway"

    with patch.dict(os.environ, {"XDG_CURRENT_DESKTOP": "GNOME"}, clear=True):
        assert detect_compositor() == "gnome"

    with patch.dict(os.environ, {}, clear=True):
        assert detect_compositor() == "unknown"


def test_hyprland_ipc_parsing():
    hypr = HyprlandIPC()

    mock_activewindow = {
        "title": "Terminal",
        "class": "foot",
        "address": "0x55a123",
        "pid": 9876,
        "floating": True,
        "at": [100, 200],
        "size": [800, 600]
    }

    with patch.object(hypr, "get_json", return_value=mock_activewindow):
        win = hypr.get_active_window()
        assert win["title"] == "Terminal"
        assert win["class"] == "foot"
        assert win["address_or_id"] == "0x55a123"
        assert win["pid"] == 9876
        assert win["floating"] is True
        assert win["geometry"] == {"x": 100, "y": 200, "width": 800, "height": 600}

    mock_activeworkspace = {"id": 3, "name": "3_code"}
    with patch.object(hypr, "get_json", return_value=mock_activeworkspace):
        ws = hypr.get_active_workspace()
        assert ws["id"] == 3
        assert ws["name"] == "3_code"

    mock_workspaces = [
        {"id": 1, "name": "1", "windows": 2, "monitor": "DP-1"},
        {"id": 2, "name": "2", "windows": 1, "monitor": "HDMI-A-1"}
    ]
    with patch.object(hypr, "get_json", return_value=mock_workspaces):
        wss = hypr.get_workspaces()
        assert len(wss) == 2
        assert wss[0]["name"] == "1"

    mock_monitors = [
        {"id": 0, "name": "DP-1", "width": 2560, "height": 1440, "x": 0, "y": 0, "focused": True, "scale": 1.0}
    ]
    with patch.object(hypr, "get_json", return_value=mock_monitors):
        mons = hypr.get_monitors()
        assert len(mons) == 1
        assert mons[0]["name"] == "DP-1"
        assert mons[0]["width"] == 2560


def test_sway_ipc_parsing():
    sway = SwayIPC()

    mock_workspaces = [
        {"id": 10, "num": 1, "name": "1:main", "focused": True, "output": "eDP-1"}
    ]
    with patch.object(sway, "send_message", return_value=(IPC_GET_WORKSPACES, mock_workspaces)):
        wss = sway.get_workspaces()
        assert len(wss) == 1
        assert wss[0]["id"] == 1
        assert wss[0]["name"] == "1:main"
        assert wss[0]["focused"] is True

        active_ws = sway.get_active_workspace()
        assert active_ws["name"] == "1:main"

    mock_outputs = [
        {"id": 1, "name": "eDP-1", "rect": {"x": 0, "y": 0, "width": 1920, "height": 1080}, "focused": True, "scale": 1.0}
    ]
    with patch.object(sway, "send_message", return_value=(IPC_GET_OUTPUTS, mock_outputs)):
        outs = sway.get_outputs()
        assert len(outs) == 1
        assert outs[0]["width"] == 1920

    mock_tree = {
        "id": 1,
        "name": "root",
        "nodes": [
            {
                "id": 2,
                "name": "Firefox",
                "app_id": "firefox",
                "focused": True,
                "pid": 4321,
                "rect": {"x": 10, "y": 20, "width": 1000, "height": 800}
            }
        ]
    }
    with patch.object(sway, "send_message", return_value=(IPC_GET_TREE, mock_tree)):
        win = sway.get_active_window()
        assert win["title"] == "Firefox"
        assert win["class"] == "firefox"
        assert win["pid"] == 4321
        assert win["geometry"] == {"x": 10, "y": 20, "width": 1000, "height": 800}


def test_tiling_wm_manager_unified_info():
    wm = TilingWMManager(compositor="hyprland")

    mock_win = {"title": "Code", "class": "code", "address_or_id": "0x12", "pid": 111, "floating": False, "geometry": {"x": 0, "y": 0, "width": 1920, "height": 1080}}
    mock_ws = {"id": 1, "name": "1", "focused": True}
    mock_mon = [{"id": 0, "name": "DP-1", "width": 1920, "height": 1080, "x": 0, "y": 0, "focused": True, "scale": 1.0}]

    with patch.object(wm.hyprland, "get_active_window", return_value=mock_win), \
         patch.object(wm.hyprland, "get_active_workspace", return_value=mock_ws), \
         patch.object(wm.hyprland, "get_workspaces", return_value=[mock_ws]), \
         patch.object(wm.hyprland, "get_monitors", return_value=mock_mon):

        info = wm.get_wm_info()
        assert info["compositor"] == "hyprland"
        assert info["is_tiling"] is True
        assert info["active_window"]["title"] == "Code"
        assert info["active_workspace"]["id"] == 1


def test_tiling_wm_manager_rules_and_geometry():
    wm = TilingWMManager(compositor="sway")
    rules = wm.get_window_rules()
    assert "hyprland" in rules
    assert "sway" in rules
    assert "floating enable" in rules["sway"]

    mock_info = {
        "outputs": [
            {"name": "DP-1", "width": 2560, "height": 1440, "x": 0, "y": 0, "focused": True}
        ]
    }

    with patch.object(wm, "get_wm_info", return_value=mock_info):
        geom_center = wm.calculate_floating_geometry(800, 600, position="center")
        assert geom_center["x"] == (2560 - 800) // 2
        assert geom_center["y"] == (1440 - 600) // 2
        assert geom_center["width"] == 800
        assert geom_center["height"] == 600

        geom_top = wm.calculate_floating_geometry(800, 600, position="top-center")
        assert geom_top["x"] == (2560 - 800) // 2
        assert geom_top["y"] == 40


def test_sway_ipc_socket_binary_framing(tmp_path):
    sock_file = str(tmp_path / "mock_sway.sock")

    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(sock_file)
    server.listen(1)

    sway = SwayIPC(socket_path=sock_file)

    payload = [{"id": 1, "num": 1, "name": "1", "focused": True, "output": "HDMI-1"}]
    payload_bytes = json.dumps(payload).encode("utf-8")
    resp_type = IPC_GET_WORKSPACES
    resp_header = b"i3-ipc" + struct.pack("<II", len(payload_bytes), resp_type)

    def mock_server_loop():
        conn, _ = server.accept()
        hdr = conn.recv(14)
        conn.sendall(resp_header + payload_bytes)
        conn.close()

    import threading
    t = threading.Thread(target=mock_server_loop)
    t.start()

    r_type, r_data = sway.send_message(IPC_GET_WORKSPACES)
    t.join()
    server.close()

    assert r_type == IPC_GET_WORKSPACES
    assert isinstance(r_data, list)
    assert r_data[0]["name"] == "1"


def test_hyprland_ipc_socket_communication(tmp_path):
    sock_file = str(tmp_path / "mock_hypr.sock")

    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(sock_file)
    server.listen(1)

    hypr = HyprlandIPC(socket_path=sock_file)

    resp_data = json.dumps({"title": "Terminal", "class": "kitty", "address": "0x123", "pid": 555, "floating": False, "at": [0, 0], "size": [1920, 1080]})

    def mock_server_loop():
        conn, _ = server.accept()
        cmd = conn.recv(1024)
        conn.sendall(resp_data.encode("utf-8"))
        conn.close()

    import threading
    t = threading.Thread(target=mock_server_loop)
    t.start()

    win = hypr.get_active_window()
    t.join()
    server.close()

    assert win["title"] == "Terminal"
    assert win["class"] == "kitty"


def test_socket_timeout_handling(tmp_path):
    sock_file = str(tmp_path / "timeout_sway.sock")
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(sock_file)
    server.listen(1)

    sway = SwayIPC(socket_path=sock_file)

    def mock_server_hang():
        conn, _ = server.accept()
        import time
        time.sleep(3)
        conn.close()

    import threading
    t = threading.Thread(target=mock_server_hang)
    t.start()

    # Should gracefully timeout without crashing
    r_type, r_data = sway.send_message(IPC_GET_WORKSPACES)
    t.join()
    server.close()

    assert r_type == IPC_GET_WORKSPACES
    assert r_data is None


def test_tiling_wm_manager_actions():
    wm_hypr = TilingWMManager(compositor="hyprland")
    with patch.object(wm_hypr.hyprland, "dispatch", return_value=True) as mock_dispatch:
        assert wm_hypr.focus_workspace("2") is True
        mock_dispatch.assert_called_with("workspace", "2")

        assert wm_hypr.move_active_window_to_workspace("3") is True
        mock_dispatch.assert_called_with("movetoworkspace", "3")

        assert wm_hypr.toggle_floating() is True
        mock_dispatch.assert_called_with("togglefloating")

    wm_sway = TilingWMManager(compositor="sway")
    with patch.object(wm_sway.sway, "run_command", return_value=[{"success": True}]) as mock_sway_cmd:
        assert wm_sway.focus_workspace("2") is True
        mock_sway_cmd.assert_called_with("workspace 2")

        assert wm_sway.move_active_window_to_workspace("3") is True
        mock_sway_cmd.assert_called_with("move container to workspace 3")

        assert wm_sway.toggle_floating() is True
        mock_sway_cmd.assert_called_with("floating toggle")


def test_companion_cli_wm_flags():
    from companion.companion_app import main
    import sys

    with patch.object(sys, "argv", ["companion_app.py", "--wm-info"]), \
         patch("companion.tiling_wm.TilingWMManager.get_wm_info", return_value={"compositor": "hyprland"}), \
         pytest.raises(SystemExit) as exc_info:
        main()
    assert exc_info.value.code == 0

    with patch.object(sys, "argv", ["companion_app.py", "--wm-rules"]), \
         pytest.raises(SystemExit) as exc_info:
        main()
    assert exc_info.value.code == 0


def test_tiling_wm_manager_execute_command_with_context():
    wm = TilingWMManager(compositor="hyprland")
    mock_info = {
        "active_window": {"title": "MyFile.txt - Editor", "class": "texteditor"},
        "active_workspace": {"name": "workspace_3"}
    }

    with patch.object(wm, "get_wm_info", return_value=mock_info):
        code, stdout, stderr = wm.execute_command_with_context(
            "echo 'Focusing {active_window_class} on {active_workspace} under {compositor}'"
        )
        assert code == 0
        assert "Focusing texteditor on workspace_3 under hyprland" in stdout
