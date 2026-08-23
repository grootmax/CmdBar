#!/usr/bin/env python3
"""
CmdBar Wayland Native & Tiling Window Manager (Hyprland / Sway / i3) Integration Module.
Provides:
1. Compositor & Tiling Window Manager Detection (Hyprland, Sway, i3, Wayland, X11).
2. Tiling State & Window Context Awareness (active window, class, workspace, floating status).
3. Context-Aware Parameter Substitution for Commands.
4. Native Wayland Clipboard & Input Injection Helpers.
5. JSON IPC Protocol Server & Client over Unix Domain Sockets.
6. Interactive Wayland/Tiling Launchers (wofi, rofi, fuzzel, dmenu).
"""

import os
import sys
import json
import socket
import select
import subprocess
import threading
import time
import re
import shlex
from typing import Dict, List, Any, Optional, Tuple

from companion.companion_app import (
    load_config,
    save_config,
    validate_input,
    find_placeholders,
    substitute_and_quote_command,
    run_command_in_shell,
    tokenize_and_substitute
)
from companion.ai_translator import is_ai_command, translate_natural_language_to_command


class CompositorType:
    HYPRLAND = "hyprland"
    SWAY = "sway"
    I3 = "i3"
    WAYLAND = "wayland"
    X11 = "x11"
    UNKNOWN = "unknown"


def detect_compositor() -> str:
    """
    Detects the active compositor or window manager environment.
    Returns one of CompositorType constants.
    """
    if os.environ.get("HYPRLAND_INSTANCE_SIGNATURE") or "hyprland" in os.environ.get("XDG_CURRENT_DESKTOP", "").lower():
        return CompositorType.HYPRLAND
    if os.environ.get("SWAYSOCK") or "sway" in os.environ.get("XDG_CURRENT_DESKTOP", "").lower():
        return CompositorType.SWAY
    if os.environ.get("I3SOCK") or "i3" in os.environ.get("XDG_CURRENT_DESKTOP", "").lower():
        return CompositorType.I3
    if os.environ.get("WAYLAND_DISPLAY") or os.environ.get("XDG_SESSION_TYPE", "").lower() == "wayland":
        return CompositorType.WAYLAND
    if os.environ.get("DISPLAY") or os.environ.get("XDG_SESSION_TYPE", "").lower() == "x11":
        return CompositorType.X11
    return CompositorType.UNKNOWN


class TilingWindowManager:
    """
    Unified manager for interacting with Hyprland, Sway, and i3 IPCs.
    """
    def __init__(self, compositor: Optional[str] = None):
        self.compositor = compositor or detect_compositor()

    def get_active_window(self) -> Dict[str, Any]:
        """
        Retrieves active/focused window metadata.
        """
        if self.compositor == CompositorType.HYPRLAND:
            return self._get_hyprland_active_window()
        elif self.compositor == CompositorType.SWAY:
            return self._get_sway_i3_active_window(is_sway=True)
        elif self.compositor == CompositorType.I3:
            return self._get_sway_i3_active_window(is_sway=False)
        else:
            return {
                "title": "",
                "class": "",
                "address": "",
                "floating": False,
                "workspace": "1",
                "pid": 0,
                "x": 0,
                "y": 0,
                "width": 0,
                "height": 0,
                "compositor": self.compositor
            }

    def _get_hyprland_active_window(self) -> Dict[str, Any]:
        try:
            res = subprocess.run(["hyprctl", "-j", "activewindow"], capture_output=True, text=True, timeout=1)
            if res.returncode == 0 and res.stdout.strip():
                data = json.loads(res.stdout)
                ws = data.get("workspace", {})
                ws_name = ws.get("name") if isinstance(ws, dict) else str(ws)
                at = data.get("at", [0, 0])
                size = data.get("size", [0, 0])
                return {
                    "title": data.get("title", ""),
                    "class": data.get("class", ""),
                    "address": data.get("address", ""),
                    "floating": bool(data.get("floating", False)),
                    "workspace": ws_name or "1",
                    "pid": data.get("pid", 0),
                    "x": at[0] if len(at) > 0 else 0,
                    "y": at[1] if len(at) > 1 else 0,
                    "width": size[0] if len(size) > 0 else 0,
                    "height": size[1] if len(size) > 1 else 0,
                    "compositor": CompositorType.HYPRLAND
                }
        except Exception:
            pass
        return {
            "title": "", "class": "", "address": "", "floating": False,
            "workspace": "1", "pid": 0, "x": 0, "y": 0, "width": 0, "height": 0,
            "compositor": CompositorType.HYPRLAND
        }

    def _get_sway_i3_active_window(self, is_sway: bool = True) -> Dict[str, Any]:
        cmd = ["swaymsg", "-t", "get_tree"] if is_sway else ["i3-msg", "-t", "get_tree"]
        comp_type = CompositorType.SWAY if is_sway else CompositorType.I3
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=1)
            if res.returncode == 0 and res.stdout.strip():
                tree = json.loads(res.stdout)
                focused = self._find_focused_node(tree)
                if focused:
                    rect = focused.get("rect", {})
                    app_id = focused.get("app_id") or focused.get("window_properties", {}).get("class", "")
                    floating = focused.get("floating", "") in ["auto_on", "user_on"] or focused.get("type") == "floating_con"
                    return {
                        "title": focused.get("name", ""),
                        "class": app_id,
                        "address": str(focused.get("id", "")),
                        "floating": bool(floating),
                        "workspace": focused.get("workspace_name", "1"),
                        "pid": focused.get("pid", 0),
                        "x": rect.get("x", 0),
                        "y": rect.get("y", 0),
                        "width": rect.get("width", 0),
                        "height": rect.get("height", 0),
                        "compositor": comp_type
                    }
        except Exception:
            pass
        return {
            "title": "", "class": "", "address": "", "floating": False,
            "workspace": "1", "pid": 0, "x": 0, "y": 0, "width": 0, "height": 0,
            "compositor": comp_type
        }

    def _find_focused_node(self, node: Dict[str, Any], current_workspace: str = "1") -> Optional[Dict[str, Any]]:
        if not isinstance(node, dict):
            return None
        if node.get("type") == "workspace":
            current_workspace = node.get("name", current_workspace)
        if node.get("focused") is True:
            res = dict(node)
            res["workspace_name"] = current_workspace
            return res
        for child_key in ["nodes", "floating_nodes"]:
            for child in node.get(child_key, []):
                found = self._find_focused_node(child, current_workspace)
                if found:
                    return found
        return None

    def get_workspaces(self) -> List[Dict[str, Any]]:
        """
        Gets list of workspaces from Hyprland, Sway, or i3.
        """
        if self.compositor == CompositorType.HYPRLAND:
            try:
                res = subprocess.run(["hyprctl", "-j", "workspaces"], capture_output=True, text=True, timeout=1)
                if res.returncode == 0 and res.stdout.strip():
                    return json.loads(res.stdout)
            except Exception:
                pass
        elif self.compositor in (CompositorType.SWAY, CompositorType.I3):
            cmd = ["swaymsg" if self.compositor == CompositorType.SWAY else "i3-msg", "-t", "get_workspaces"]
            try:
                res = subprocess.run(cmd, capture_output=True, text=True, timeout=1)
                if res.returncode == 0 and res.stdout.strip():
                    return json.loads(res.stdout)
            except Exception:
                pass
        return []

    def get_context_params(self) -> Dict[str, str]:
        """
        Returns dynamic context parameters based on active window & tiling state.
        """
        win = self.get_active_window()
        return {
            "active_window": win.get("title", ""),
            "active_title": win.get("title", ""),
            "active_class": win.get("class", ""),
            "active_app_id": win.get("class", ""),
            "workspace": win.get("workspace", "1"),
            "active_workspace": win.get("workspace", "1"),
            "compositor": self.compositor,
            "floating": "true" if win.get("floating") else "false"
        }

    def apply_floating_rule(self, app_id: str = "CmdBar", title: str = "CmdBar") -> bool:
        """
        Applies floating rules for CmdBar dialogs in tiling compositors.
        """
        try:
            if self.compositor == CompositorType.HYPRLAND:
                subprocess.run(["hyprctl", "keyword", "windowrule", f"float, ^({title}|{app_id})$"], check=False)
                subprocess.run(["hyprctl", "keyword", "windowrule", f"center, ^({title}|{app_id})$"], check=False)
                return True
            elif self.compositor == CompositorType.SWAY:
                subprocess.run(["swaymsg", f'for_window [app_id="{app_id}"] floating enable, move position center'], check=False)
                return True
            elif self.compositor == CompositorType.I3:
                subprocess.run(["i3-msg", f'for_window [class="{app_id}"] floating enable, move position center'], check=False)
                return True
        except Exception:
            pass
        return False


def get_default_socket_path() -> str:
    """
    Returns default socket path for CmdBar IPC server.
    """
    if os.environ.get("CMDBAR_IPC_SOCKET"):
        return os.environ["CMDBAR_IPC_SOCKET"]
    runtime_dir = os.environ.get("XDG_RUNTIME_DIR")
    if runtime_dir and os.path.isdir(runtime_dir):
        return os.path.join(runtime_dir, "cmdbar.sock")
    return os.path.expanduser("~/.config/cmdbar/cmdbar.sock")


def format_output_python(raw_output: str) -> Dict[str, Any]:
    """
    Python implementation of output detection and formatting.
    Detects JSON, CSV, TSV, Code, and plain text.
    """
    if not raw_output or not isinstance(raw_output, str):
        return {"format": "text", "text": "", "raw": raw_output}

    text = raw_output.strip()

    # Detect JSON
    if (text.startswith("{") and text.endswith("}")) or (text.startswith("[") and text.endswith("]")):
        try:
            parsed = json.loads(text)
            pretty = json.dumps(parsed, indent=2)
            return {"format": "json", "text": pretty, "raw": raw_output, "data": parsed}
        except Exception:
            pass

    lines = text.splitlines()

    # Detect CSV / TSV
    if len(lines) >= 2:
        if all("," in line for line in lines[:5]):
            formatted_table = _render_ascii_table([l.split(",") for l in lines])
            return {"format": "csv", "text": formatted_table, "raw": raw_output}
        if all("\t" in line for line in lines[:5]):
            formatted_table = _render_ascii_table([l.split("\t") for l in lines])
            return {"format": "tsv", "text": formatted_table, "raw": raw_output}

    # Detect Code
    code_keywords = ["function", "def ", "class ", "import ", "const ", "let ", "var ", "return ", "if (", "SELECT ", "INSERT "]
    if any(kw in text for kw in code_keywords):
        return {"format": "code", "text": f"```\n{text}\n```", "raw": raw_output}

    return {"format": "text", "text": text, "raw": raw_output}


def _render_ascii_table(rows: List[List[str]]) -> str:
    if not rows:
        return ""
    col_widths = []
    cleaned_rows = []
    for row in rows:
        c_row = [col.strip() for col in row]
        cleaned_rows.append(c_row)
        for i, col in enumerate(c_row):
            if i >= len(col_widths):
                col_widths.append(len(col))
            else:
                col_widths[i] = max(col_widths[i], len(col))

    sep = "+" + "+".join("-" * (w + 2) for w in col_widths) + "+"
    result = [sep]

    for idx, row in enumerate(cleaned_rows):
        formatted_cols = []
        for i, w in enumerate(col_widths):
            val = row[i] if i < len(row) else ""
            formatted_cols.append(f" {val.ljust(w)} ")
        result.append("|" + "|".join(formatted_cols) + "|")
        if idx == 0:
            result.append(sep)

    result.append(sep)
    return "\n".join(result)


class WaylandIPCServer:
    """
    JSON IPC Server listening on a Unix Domain Socket.
    """
    def __init__(self, socket_path: Optional[str] = None):
        self.socket_path = socket_path or get_default_socket_path()
        self.running = False
        self.server_socket: Optional[socket.socket] = None
        self.thread: Optional[threading.Thread] = None
        self.tiling_mgr = TilingWindowManager()

    def start(self, background: bool = True):
        self._cleanup_socket()
        os.makedirs(os.path.dirname(self.socket_path), exist_ok=True)

        self.server_socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server_socket.bind(self.socket_path)
        os.chmod(self.socket_path, 0o600)
        self.server_socket.listen(10)
        self.running = True

        if background:
            self.thread = threading.Thread(target=self._listen_loop, daemon=True)
            self.thread.start()
        else:
            self._listen_loop()

    def stop(self):
        self.running = False
        if self.server_socket:
            try:
                self.server_socket.close()
            except Exception:
                pass
        self._cleanup_socket()

    def _cleanup_socket(self):
        if os.path.exists(self.socket_path):
            try:
                os.remove(self.socket_path)
            except Exception:
                pass

    def _listen_loop(self):
        while self.running:
            try:
                if self.server_socket is None:
                    break
                self.server_socket.settimeout(0.5)
                try:
                    conn, _ = self.server_socket.accept()
                except socket.timeout:
                    continue
                except Exception:
                    if not self.running:
                        break
                    continue

                client_thread = threading.Thread(target=self._handle_client, args=(conn,), daemon=True)
                client_thread.start()
            except Exception:
                if not self.running:
                    break

    def _handle_client(self, conn: socket.socket):
        start_time = time.time()
        try:
            conn.settimeout(5.0)
            data = conn.recv(65536)
            if not data:
                conn.close()
                return

            req_str = data.decode("utf-8")
            try:
                req = json.loads(req_str)
            except Exception as e:
                resp = {
                    "status": "error",
                    "error": f"Invalid JSON payload: {str(e)}",
                    "execution_time_ms": round((time.time() - start_time) * 1000, 2)
                }
                conn.sendall(json.dumps(resp).encode("utf-8"))
                conn.close()
                return

            resp = self.process_request(req)
            resp["execution_time_ms"] = round((time.time() - start_time) * 1000, 2)
            resp["timestamp"] = int(time.time())
            conn.sendall(json.dumps(resp).encode("utf-8"))
        except Exception as e:
            try:
                err_resp = {"status": "error", "error": str(e)}
                conn.sendall(json.dumps(err_resp).encode("utf-8"))
            except Exception:
                pass
        finally:
            try:
                conn.close()
            except Exception:
                pass

    def process_request(self, req: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(req, dict):
            return {"status": "error", "error": "Request must be a JSON object"}

        action = req.get("action")
        if not action:
            return {"status": "error", "error": "Missing 'action' field"}

        if action == "ping":
            return {
                "status": "ok",
                "message": "pong",
                "compositor": self.tiling_mgr.compositor,
                "version": "1.0.0"
            }

        elif action == "get_config":
            config = load_config()
            return {"status": "ok", "config": config}

        elif action == "list_categories":
            config = load_config()
            cats = []
            for cat in config.get("categories", []):
                cats.append({
                    "name": cat.get("name"),
                    "count": len(cat.get("commands", []))
                })
            return {"status": "ok", "categories": cats}

        elif action == "list_commands":
            config = load_config()
            target_cat = req.get("category")
            commands = []
            for cat in config.get("categories", []):
                if target_cat and cat.get("name") != target_cat:
                    continue
                for cmd in cat.get("commands", []):
                    item = dict(cmd)
                    item["category"] = cat.get("name")
                    commands.append(item)
            return {"status": "ok", "commands": commands}

        elif action == "search":
            query = req.get("query", "").strip()
            config = load_config()
            results = self._search_commands(config, query)
            return {"status": "ok", "query": query, "results": results}

        elif action == "get_command":
            cmd_id = req.get("command_id") or req.get("name")
            if not cmd_id:
                return {"status": "error", "error": "Missing 'command_id' or 'name'"}
            config = load_config()
            for cat in config.get("categories", []):
                for cmd in cat.get("commands", []):
                    if cmd.get("name") == cmd_id or cmd.get("template") == cmd_id:
                        item = dict(cmd)
                        item["category"] = cat.get("name")
                        return {"status": "ok", "command": item}
            return {"status": "error", "error": f"Command '{cmd_id}' not found"}

        elif action == "execute":
            return self._execute_command_request(req)

        elif action == "ai_translate":
            prompt = req.get("prompt", "")
            if not prompt:
                return {"status": "error", "error": "Missing 'prompt' field"}
            translated, provider = translate_natural_language_to_command(prompt)
            return {"status": "ok", "prompt": prompt, "command": translated, "provider": provider}

        elif action == "get_tiling_context":
            ctx = self.tiling_mgr.get_context_params()
            win = self.tiling_mgr.get_active_window()
            workspaces = self.tiling_mgr.get_workspaces()
            return {
                "status": "ok",
                "context": ctx,
                "active_window": win,
                "workspaces": workspaces
            }

        elif action == "set_floating":
            app_id = req.get("app_id", "CmdBar")
            title = req.get("title", "CmdBar")
            success = self.tiling_mgr.apply_floating_rule(app_id, title)
            return {"status": "ok", "applied": success}

        elif action == "copy_to_clipboard":
            text = req.get("text", "")
            success = copy_to_clipboard(text)
            return {"status": "ok" if success else "error", "copied": success}

        elif action == "paste_from_clipboard":
            pasted = paste_from_clipboard()
            return {"status": "ok", "text": pasted}

        else:
            return {"status": "error", "error": f"Unknown action '{action}'"}

    def _search_commands(self, config: Dict[str, Any], query: str) -> List[Dict[str, Any]]:
        results = []
        q_lower = query.lower()
        for cat in config.get("categories", []):
            for cmd in cat.get("commands", []):
                name = cmd.get("name", "")
                template = cmd.get("template", cmd.get("command", ""))
                usage = cmd.get("usage_count", 0)

                match_score = 0
                if not query:
                    match_score = 100
                elif q_lower in name.lower():
                    match_score = 90
                elif q_lower in template.lower():
                    match_score = 70
                else:
                    score = self._fuzzy_score(q_lower, name.lower())
                    if score > 0:
                        match_score = score

                if match_score > 0:
                    item = dict(cmd)
                    item["category"] = cat.get("name")
                    item["score"] = match_score + (usage * 2)
                    results.append(item)

        results.sort(key=lambda x: x.get("score", 0), reverse=True)
        return results

    def _fuzzy_score(self, query: str, text: str) -> int:
        if not query or not text:
            return 0
        q_idx = 0
        q_len = len(query)
        score = 0
        for i, char in enumerate(text):
            if q_idx < q_len and char == query[q_idx]:
                score += 10
                q_idx += 1
        return score if q_idx == q_len else 0

    def _execute_command_request(self, req: Dict[str, Any]) -> Dict[str, Any]:
        cmd_input = req.get("command") or req.get("template") or req.get("name")
        if not cmd_input:
            return {"status": "error", "error": "Missing 'command', 'template', or 'name'"}

        config = load_config()
        found_cmd = None
        for cat in config.get("categories", []):
            for c in cat.get("commands", []):
                if c.get("name") == cmd_input or c.get("template") == cmd_input:
                    found_cmd = c
                    break

        template = found_cmd.get("template", cmd_input) if found_cmd else cmd_input
        param_schema = found_cmd.get("parameters", {}) if found_cmd else {}

        provided_params = req.get("params", {})
        if not isinstance(provided_params, dict):
            provided_params = {}

        tiling_ctx = self.tiling_mgr.get_context_params()
        combined_params = dict(tiling_ctx)
        combined_params.update(provided_params)

        placeholders = find_placeholders(template)
        missing_placeholders = []
        for ph in placeholders:
            if ph in tiling_ctx and ph not in provided_params:
                continue
            if ph not in provided_params:
                missing_placeholders.append(ph)

        if missing_placeholders:
            return {
                "status": "error",
                "error": f"Missing required parameter(s): {', '.join(missing_placeholders)}",
                "missing_parameters": missing_placeholders,
                "placeholders": placeholders
            }

        for p_name, val in provided_params.items():
            regex = None
            if isinstance(param_schema, dict) and p_name in param_schema:
                regex = param_schema[p_name].get("regex")
            if regex and not validate_input(val, pattern=regex):
                return {
                    "status": "error",
                    "error": f"Invalid parameter value '{val}' for '{p_name}' (failed regex validation)"
                }

        resolved_cmd = substitute_and_quote_command(template, combined_params)

        if req.get("dry_run"):
            return {
                "status": "ok",
                "dry_run": True,
                "command": resolved_cmd,
                "params": combined_params
            }

        code, stdout, stderr = run_command_in_shell(resolved_cmd)
        fmt_data = format_output_python(stdout if code == 0 else stderr or stdout)

        if found_cmd:
            found_cmd["usage_count"] = found_cmd.get("usage_count", 0) + 1
            save_config(config)

        return {
            "status": "ok" if code == 0 else "error",
            "command": resolved_cmd,
            "returncode": code,
            "stdout": stdout,
            "stderr": stderr,
            "formatted": fmt_data
        }


def send_ipc_request(req: Dict[str, Any], socket_path: Optional[str] = None, timeout: float = 3.0) -> Dict[str, Any]:
    """
    Sends a JSON IPC request to the CmdBar IPC server socket and returns the JSON response.
    """
    sock_path = socket_path or get_default_socket_path()
    if not os.path.exists(sock_path):
        return {"status": "error", "error": f"Socket path {sock_path} does not exist. Is CmdBar IPC server running?"}

    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect(sock_path)
        payload = json.dumps(req).encode("utf-8")
        s.sendall(payload)

        raw_data = bytearray()
        while True:
            try:
                chunk = s.recv(4096)
                if not chunk:
                    break
                raw_data.extend(chunk)
            except socket.timeout:
                break

        if not raw_data:
            return {"status": "error", "error": "Empty response from server"}

        return json.loads(raw_data.decode("utf-8"))
    except Exception as e:
        return {"status": "error", "error": f"IPC communication error: {str(e)}"}
    finally:
        s.close()


def copy_to_clipboard(text: str) -> bool:
    """
    Copies text to system clipboard using wl-copy on Wayland or xclip on X11.
    """
    if not text:
        return False
    comp = detect_compositor()
    if comp in (CompositorType.HYPRLAND, CompositorType.SWAY, CompositorType.WAYLAND):
        cmd = ["wl-copy"]
    else:
        cmd = ["xclip", "-selection", "clipboard"]

    try:
        res = subprocess.run(cmd, input=text, text=True, capture_output=True, timeout=2)
        return res.returncode == 0
    except Exception:
        return False


def paste_from_clipboard() -> str:
    """
    Pastes text from system clipboard using wl-paste on Wayland or xclip on X11.
    """
    comp = detect_compositor()
    if comp in (CompositorType.HYPRLAND, CompositorType.SWAY, CompositorType.WAYLAND):
        cmd = ["wl-paste", "--no-newline"]
    else:
        cmd = ["xclip", "-selection", "clipboard", "-o"]

    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=2)
        return res.stdout if res.returncode == 0 else ""
    except Exception:
        return ""


def run_launcher_mode(launcher: Optional[str] = None):
    """
    Interactive launcher mode using wofi, rofi, fuzzel, or dmenu on Wayland/Sway/Hyprland.
    """
    config = load_config()
    commands = []
    lines = []

    for cat in config.get("categories", []):
        cat_name = cat.get("name", "Default")
        for cmd in cat.get("commands", []):
            name = cmd.get("name", "")
            tmpl = cmd.get("template", "")
            lines.append(f"[{cat_name}] {name}  ({tmpl})")
            commands.append((cat_name, cmd))

    if not lines:
        print("No commands found in configuration.")
        return

    if not launcher:
        if subprocess.run(["which", "wofi"], capture_output=True).returncode == 0:
            launcher = "wofi"
        elif subprocess.run(["which", "rofi"], capture_output=True).returncode == 0:
            launcher = "rofi"
        elif subprocess.run(["which", "fuzzel"], capture_output=True).returncode == 0:
            launcher = "fuzzel"
        else:
            launcher = "dmenu"

    prompt_str = "\n".join(lines)
    selected_line = ""

    if launcher == "wofi":
        res = subprocess.run(["wofi", "--dmenu", "--prompt", "CmdBar"], input=prompt_str, text=True, capture_output=True)
        selected_line = res.stdout.strip()
    elif launcher == "rofi":
        res = subprocess.run(["rofi", "-dmenu", "-p", "CmdBar"], input=prompt_str, text=True, capture_output=True)
        selected_line = res.stdout.strip()
    elif launcher == "fuzzel":
        res = subprocess.run(["fuzzel", "--dmenu", "--prompt", "CmdBar: "], input=prompt_str, text=True, capture_output=True)
        selected_line = res.stdout.strip()
    else:
        res = subprocess.run(["dmenu", "-p", "CmdBar"], input=prompt_str, text=True, capture_output=True)
        selected_line = res.stdout.strip()

    if not selected_line:
        return

    selected_cmd = None
    for idx, l in enumerate(lines):
        if l == selected_line:
            selected_cmd = commands[idx][1]
            break

    if not selected_cmd:
        return

    template = selected_cmd.get("template", "")
    placeholders = find_placeholders(template)
    tiling_mgr = TilingWindowManager()
    tiling_ctx = tiling_mgr.get_context_params()

    params_data = {}
    for ph in placeholders:
        if ph in tiling_ctx:
            params_data[ph] = tiling_ctx[ph]
            continue

        ph_cfg = selected_cmd.get("parameters", {}).get(ph, {})
        ph_prompt = ph_cfg.get("placeholder", f"Enter {ph}")
        regex = ph_cfg.get("regex")

        val = ""
        if subprocess.run(["which", "zenity"], capture_output=True).returncode == 0:
            z_res = subprocess.run(["zenity", "--entry", "--title=CmdBar", f"--text={ph_prompt}"], text=True, capture_output=True)
            val = z_res.stdout.strip()
        else:
            val_res = subprocess.run([launcher, "--dmenu", f"--prompt={ph_prompt}"], input="", text=True, capture_output=True)
            val = val_res.stdout.strip()

        if not validate_input(val, pattern=regex):
            print(f"Error: Invalid input '{val}' for parameter '{ph}'", file=sys.stderr)
            return

        params_data[ph] = val

    exec_cmd = substitute_and_quote_command(template, params_data)
    code, stdout, stderr = run_command_in_shell(exec_cmd)
    out_text = stdout if code == 0 else stderr or stdout
    print(f"Executed: {exec_cmd}\nResult (exit code {code}):\n{out_text}")
