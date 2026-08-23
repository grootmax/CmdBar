#!/usr/bin/env python3
"""
CmdBar Tiling Window Manager & Wayland Native Support.

Provides JSON IPC protocol communication for Hyprland, Sway, and i3 compositors.
Includes tiling-aware active window / workspace querying, window rule generation,
floating layout calculations, and context-aware command execution.
"""

import os
import sys
import json
import socket
import struct
import subprocess
import re
import shlex

# i3 / Sway IPC Message Types
IPC_RUN_COMMAND = 0
IPC_GET_WORKSPACES = 1
IPC_SUBSCRIBE = 2
IPC_GET_OUTPUTS = 3
IPC_GET_TREE = 4
IPC_GET_MARKS = 5
IPC_GET_BAR_CONFIG = 6
IPC_GET_VERSION = 7
IPC_GET_BINDING_MODES = 8
IPC_GET_CONFIG = 9
IPC_SEND_TICK = 10
IPC_SYNC = 11
IPC_GET_BINDING_STATE = 12
IPC_GET_INPUTS = 13
IPC_GET_SEATS = 14


def detect_compositor() -> str:
    """
    Detects the active Wayland or X11 tiling window manager or desktop environment.
    Returns one of 'hyprland', 'sway', 'i3', 'gnome', or 'unknown'.
    :visibility: public
    """
    if os.environ.get("HYPRLAND_INSTANCE_SIGNATURE"):
        return "hyprland"
    if os.environ.get("SWAYSOCK"):
        return "sway"
    if os.environ.get("I3SOCK"):
        return "i3"

    desktop = (os.environ.get("XDG_CURRENT_DESKTOP") or "").lower()
    session = (os.environ.get("XDG_SESSION_DESKTOP") or "").lower()

    if "hyprland" in desktop or "hyprland" in session:
        return "hyprland"
    if "sway" in desktop or "sway" in session:
        return "sway"
    if "i3" in desktop or "i3" in session:
        return "i3"
    if "gnome" in desktop or "gnome" in session:
        return "gnome"

    return "unknown"


class HyprlandIPC:
    """
    Native UNIX socket and JSON IPC client for Hyprland compositor.
    :visibility: public
    """
    def __init__(self, socket_path: str = None):
        self.socket_path = socket_path or self._find_socket()

    def _find_socket(self) -> str:
        his = os.environ.get("HYPRLAND_INSTANCE_SIGNATURE")
        xdg_runtime = os.environ.get("XDG_RUNTIME_DIR", "/tmp")
        if his:
            sock = os.path.join(xdg_runtime, "hypr", his, ".socket.sock")
            if os.path.exists(sock):
                return sock
        return None

    def send_command(self, cmd: str) -> str:
        """
        Sends a command string over the Hyprland IPC socket or via hyprctl fallback.
        """
        if self.socket_path and os.path.exists(self.socket_path):
            try:
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
                    s.settimeout(2.0)
                    s.connect(self.socket_path)
                    s.sendall(cmd.encode("utf-8"))
                    response = b""
                    while True:
                        chunk = s.recv(4096)
                        if not chunk:
                            break
                        response += chunk
                    return response.decode("utf-8", errors="replace")
            except Exception:
                pass

        # Fallback to hyprctl CLI
        try:
            parts = shlex.split(cmd)
            cli_args = ["hyprctl"]
            if cmd.startswith("j/"):
                cli_args.extend(["-j", cmd[2:]])
            elif cmd.startswith("dispatch "):
                cli_args.extend(["dispatch"] + parts[1:])
            else:
                cli_args.extend(parts)

            res = subprocess.run(cli_args, capture_output=True, text=True, timeout=2)
            if res.returncode == 0:
                return res.stdout
        except Exception:
            pass

        return ""

    def get_json(self, cmd: str) -> any:
        """
        Requests JSON response from Hyprland using j/ prefix.
        """
        req_cmd = cmd if cmd.startswith("j/") else f"j/{cmd}"
        raw = self.send_command(req_cmd)
        if raw:
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                pass
        return None

    def get_active_window(self) -> dict:
        """
        Returns details of the currently focused window in Hyprland.
        """
        data = self.get_json("activewindow")
        if isinstance(data, dict):
            return {
                "title": data.get("title", ""),
                "class": data.get("class", ""),
                "address_or_id": data.get("address", ""),
                "pid": data.get("pid", 0),
                "floating": bool(data.get("floating", False)),
                "geometry": {
                    "x": data.get("at", [0, 0])[0] if isinstance(data.get("at"), list) and len(data.get("at")) > 0 else 0,
                    "y": data.get("at", [0, 0])[1] if isinstance(data.get("at"), list) and len(data.get("at")) > 1 else 0,
                    "width": data.get("size", [0, 0])[0] if isinstance(data.get("size"), list) and len(data.get("size")) > 0 else 0,
                    "height": data.get("size", [0, 0])[1] if isinstance(data.get("size"), list) and len(data.get("size")) > 1 else 0,
                }
            }
        return {"title": "", "class": "", "address_or_id": "", "pid": 0, "floating": False, "geometry": {"x": 0, "y": 0, "width": 0, "height": 0}}

    def get_active_workspace(self) -> dict:
        """
        Returns details of the active workspace in Hyprland.
        """
        data = self.get_json("activeworkspace")
        if isinstance(data, dict):
            return {
                "id": data.get("id", 1),
                "name": data.get("name", "1"),
                "focused": True
            }
        return {"id": 1, "name": "1", "focused": True}

    def get_workspaces(self) -> list:
        """
        Returns list of workspaces in Hyprland.
        """
        data = self.get_json("workspaces")
        if isinstance(data, list):
            res = []
            for ws in data:
                res.append({
                    "id": ws.get("id", 0),
                    "name": ws.get("name", str(ws.get("id", ""))),
                    "windows": ws.get("windows", 0),
                    "monitor": ws.get("monitor", "")
                })
            return res
        return []

    def get_monitors(self) -> list:
        """
        Returns list of monitors/outputs in Hyprland.
        """
        data = self.get_json("monitors")
        if isinstance(data, list):
            res = []
            for mon in data:
                res.append({
                    "id": mon.get("id", 0),
                    "name": mon.get("name", ""),
                    "width": mon.get("width", 1920),
                    "height": mon.get("height", 1080),
                    "x": mon.get("x", 0),
                    "y": mon.get("y", 0),
                    "focused": bool(mon.get("focused", False)),
                    "scale": mon.get("scale", 1.0)
                })
            return res
        return []

    def dispatch(self, dispatcher: str, args: str = "") -> bool:
        """
        Executes a Hyprland dispatcher command.
        """
        cmd = f"dispatch {dispatcher} {args}".strip()
        resp = self.send_command(cmd)
        return "ok" in resp.lower() or resp.strip() == "ok" or resp != ""


class SwayIPC:
    """
    Native UNIX socket and binary IPC client for Sway / i3 compositors.
    :visibility: public
    """
    MAGIC = b"i3-ipc"

    def __init__(self, socket_path: str = None):
        self.socket_path = socket_path or self._find_socket()

    def _find_socket(self) -> str:
        return os.environ.get("SWAYSOCK") or os.environ.get("I3SOCK")

    def send_message(self, msg_type: int, payload: str = "") -> tuple[int, any]:
        """
        Sends an IPC message using i3/Sway binary framing protocol over UNIX socket,
        or falls back to swaymsg / i3-msg CLI.
        """
        if self.socket_path and os.path.exists(self.socket_path):
            try:
                payload_bytes = payload.encode("utf-8")
                header = self.MAGIC + struct.pack("<II", len(payload_bytes), msg_type)

                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
                    s.settimeout(2.0)
                    s.connect(self.socket_path)
                    s.sendall(header + payload_bytes)

                    resp_header = b""
                    while len(resp_header) < 14:
                        chunk = s.recv(14 - len(resp_header))
                        if not chunk:
                            break
                        resp_header += chunk

                    if len(resp_header) == 14 and resp_header.startswith(self.MAGIC):
                        magic, payload_len, resp_type = struct.unpack("<6sII", resp_header)
                        resp_payload = b""
                        while len(resp_payload) < payload_len:
                            chunk = s.recv(payload_len - len(resp_payload))
                            if not chunk:
                                break
                            resp_payload += chunk

                        payload_str = resp_payload.decode("utf-8", errors="replace")
                        try:
                            return resp_type, json.loads(payload_str)
                        except json.JSONDecodeError:
                            return resp_type, payload_str
            except Exception:
                pass

        # Fallback to swaymsg / i3-msg CLI
        tool = "swaymsg" if os.environ.get("SWAYSOCK") or "sway" in (os.environ.get("XDG_CURRENT_DESKTOP") or "").lower() else "i3-msg"
        type_flag_map = {
            IPC_RUN_COMMAND: "command",
            IPC_GET_WORKSPACES: "get_workspaces",
            IPC_GET_OUTPUTS: "get_outputs",
            IPC_GET_TREE: "get_tree"
        }

        t_val = type_flag_map.get(msg_type)
        if t_val:
            cmd_args = [tool, "-t", t_val, "-r"]
            if payload and msg_type == IPC_RUN_COMMAND:
                cmd_args.append(payload)
            try:
                res = subprocess.run(cmd_args, capture_output=True, text=True, timeout=2)
                if res.returncode == 0 and res.stdout:
                    try:
                        return msg_type, json.loads(res.stdout)
                    except json.JSONDecodeError:
                        return msg_type, res.stdout
            except Exception:
                pass

        return msg_type, None

    def get_workspaces(self) -> list:
        """
        Returns workspace list from Sway/i3.
        """
        _, data = self.send_message(IPC_GET_WORKSPACES)
        if isinstance(data, list):
            res = []
            for ws in data:
                res.append({
                    "id": ws.get("num", ws.get("id", 0)),
                    "name": ws.get("name", ""),
                    "focused": bool(ws.get("focused", False)),
                    "output": ws.get("output", "")
                })
            return res
        return []

    def get_active_workspace(self) -> dict:
        """
        Returns active focused workspace in Sway/i3.
        """
        workspaces = self.get_workspaces()
        for ws in workspaces:
            if ws.get("focused"):
                return ws
        if workspaces:
            return workspaces[0]
        return {"id": 1, "name": "1", "focused": True}

    def get_outputs(self) -> list:
        """
        Returns outputs/monitors from Sway/i3.
        """
        _, data = self.send_message(IPC_GET_OUTPUTS)
        if isinstance(data, list):
            res = []
            for out in data:
                rect = out.get("rect", {})
                res.append({
                    "id": out.get("id", 0),
                    "name": out.get("name", ""),
                    "width": rect.get("width", 1920),
                    "height": rect.get("height", 1080),
                    "x": rect.get("x", 0),
                    "y": rect.get("y", 0),
                    "focused": bool(out.get("focused", False)),
                    "scale": out.get("scale", 1.0)
                })
            return res
        return []

    def get_tree(self) -> dict:
        """
        Returns window tree structure from Sway/i3.
        """
        _, data = self.send_message(IPC_GET_TREE)
        return data if isinstance(data, dict) else {}

    def get_active_window(self) -> dict:
        """
        Finds focused window in Sway/i3 tree structure.
        """
        tree = self.get_tree()
        if not tree:
            return {"title": "", "class": "", "address_or_id": "", "pid": 0, "floating": False, "geometry": {"x": 0, "y": 0, "width": 0, "height": 0}}

        focused_node = self._find_focused_node(tree)
        if focused_node:
            rect = focused_node.get("rect", {})
            app_id = focused_node.get("app_id") or focused_node.get("window_properties", {}).get("class", "")
            return {
                "title": focused_node.get("name", ""),
                "class": app_id,
                "address_or_id": str(focused_node.get("id", "")),
                "pid": focused_node.get("pid", 0),
                "floating": "floating" in str(focused_node.get("type", "")).lower() or "floating" in str(focused_node.get("layout", "")).lower(),
                "geometry": {
                    "x": rect.get("x", 0),
                    "y": rect.get("y", 0),
                    "width": rect.get("width", 0),
                    "height": rect.get("height", 0)
                }
            }
        return {"title": "", "class": "", "address_or_id": "", "pid": 0, "floating": False, "geometry": {"x": 0, "y": 0, "width": 0, "height": 0}}

    def _find_focused_node(self, node: dict) -> dict:
        if node.get("focused"):
            return node
        for child in node.get("nodes", []) + node.get("floating_nodes", []):
            found = self._find_focused_node(child)
            if found:
                return found
        return None

    def run_command(self, cmd: str) -> list:
        """
        Runs a Sway/i3 command (e.g. 'workspace 2').
        """
        _, data = self.send_message(IPC_RUN_COMMAND, cmd)
        return data if isinstance(data, list) else []


class TilingWMManager:
    """
    Unified manager for Hyprland, Sway, and i3 tiling window managers.
    Provides compositor status, JSON protocol inspection, floating rules, and command execution.
    :visibility: public
    """
    def __init__(self, compositor: str = None, socket_path: str = None):
        self.compositor = compositor or detect_compositor()
        self.socket_path = socket_path
        self.hyprland = HyprlandIPC(socket_path) if self.compositor == "hyprland" else None
        self.sway = SwayIPC(socket_path) if self.compositor in ("sway", "i3") else None

    def get_compositor(self) -> str:
        """
        Returns the detected active compositor name.
        """
        return self.compositor

    def is_tiling(self) -> bool:
        """
        Returns True if active environment is a tiling window manager.
        """
        return self.compositor in ("hyprland", "sway", "i3")

    def get_wm_info(self) -> dict:
        """
        Queries and returns complete JSON protocol WM status information.
        """
        if self.compositor == "hyprland":
            return {
                "compositor": "hyprland",
                "is_tiling": True,
                "active_window": self.hyprland.get_active_window(),
                "active_workspace": self.hyprland.get_active_workspace(),
                "workspaces": self.hyprland.get_workspaces(),
                "outputs": self.hyprland.get_monitors()
            }
        elif self.compositor in ("sway", "i3"):
            return {
                "compositor": self.compositor,
                "is_tiling": True,
                "active_window": self.sway.get_active_window(),
                "active_workspace": self.sway.get_active_workspace(),
                "workspaces": self.sway.get_workspaces(),
                "outputs": self.sway.get_outputs()
            }
        else:
            return {
                "compositor": self.compositor,
                "is_tiling": False,
                "active_window": {"title": "", "class": "", "address_or_id": "", "pid": 0, "floating": True, "geometry": {"x": 0, "y": 0, "width": 0, "height": 0}},
                "active_workspace": {"id": 1, "name": "1", "focused": True},
                "workspaces": [],
                "outputs": []
            }

    def get_window_rules(self) -> dict:
        """
        Returns configuration window rules for Hyprland and Sway/i3 to properly float and center CmdBar windows.
        """
        return {
            "hyprland": (
                "# CmdBar Hyprland Window Rules\n"
                "windowrulev2 = float, class:^(cmdbar|CmdBar)$\n"
                "windowrulev2 = center, class:^(cmdbar|CmdBar)$\n"
                "windowrulev2 = pin, class:^(cmdbar|CmdBar)$\n"
            ),
            "sway": (
                "# CmdBar Sway / i3 Window Rules\n"
                'for_window [app_id="cmdbar"] floating enable, move position center\n'
                'for_window [class="CmdBar"] floating enable, move position center\n'
            )
        }

    def calculate_floating_geometry(self, width: int = 800, height: int = 500, position: str = "center") -> dict:
        """
        Calculates window x, y position relative to active monitor bounds for floating popups.
        """
        info = self.get_wm_info()
        outputs = info.get("outputs", [])
        active_mon = None
        for mon in outputs:
            if mon.get("focused"):
                active_mon = mon
                break
        if not active_mon and outputs:
            active_mon = outputs[0]

        mon_x = active_mon.get("x", 0) if active_mon else 0
        mon_y = active_mon.get("y", 0) if active_mon else 0
        mon_w = active_mon.get("width", 1920) if active_mon else 1920
        mon_h = active_mon.get("height", 1080) if active_mon else 1080

        if position == "top-center":
            x = mon_x + (mon_w - width) // 2
            y = mon_y + 40
        elif position == "bottom-center":
            x = mon_x + (mon_w - width) // 2
            y = mon_y + mon_h - height - 40
        else:  # "center"
            x = mon_x + (mon_w - width) // 2
            y = mon_y + (mon_h - height) // 2

        return {"x": max(0, x), "y": max(0, y), "width": width, "height": height}

    def focus_workspace(self, workspace: str) -> bool:
        """
        Switches focus to specified workspace in active tiling manager.
        """
        if self.compositor == "hyprland":
            return self.hyprland.dispatch("workspace", str(workspace))
        elif self.compositor in ("sway", "i3"):
            res = self.sway.run_command(f"workspace {workspace}")
            return bool(res and isinstance(res, list) and res[0].get("success"))
        return False

    def move_active_window_to_workspace(self, workspace: str) -> bool:
        """
        Moves currently focused window to specified workspace.
        """
        if self.compositor == "hyprland":
            return self.hyprland.dispatch("movetoworkspace", str(workspace))
        elif self.compositor in ("sway", "i3"):
            res = self.sway.run_command(f"move container to workspace {workspace}")
            return bool(res and isinstance(res, list) and res[0].get("success"))
        return False

    def toggle_floating(self) -> bool:
        """
        Toggles floating state of active window.
        """
        if self.compositor == "hyprland":
            return self.hyprland.dispatch("togglefloating")
        elif self.compositor in ("sway", "i3"):
            res = self.sway.run_command("floating toggle")
            return bool(res and isinstance(res, list) and res[0].get("success"))
        return False

    def execute_command_with_context(self, template: str, params: dict = None) -> tuple[int, str, str]:
        """
        Executes a command template with tiling context variables injected.
        Supported placeholders include:
          - {active_window_title}
          - {active_window_class}
          - {active_workspace}
          - {compositor}
        """
        info = self.get_wm_info()
        ctx = {
            "active_window_title": info.get("active_window", {}).get("title", ""),
            "active_window_class": info.get("active_window", {}).get("class", ""),
            "active_workspace": str(info.get("active_workspace", {}).get("name", "1")),
            "compositor": self.compositor
        }
        if params:
            ctx.update(params)

        command_str = template
        for k, v in ctx.items():
            command_str = command_str.replace("{" + k + "}", str(v))

        try:
            proc = subprocess.run(command_str, shell=True, capture_output=True, text=True, timeout=10)
            return proc.returncode, proc.stdout, proc.stderr
        except Exception as e:
            return -1, "", str(e)
