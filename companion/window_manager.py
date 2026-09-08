#!/usr/bin/env python3
"""
Python Window Management companion module for CmdBar.
Provides window control (close, tile, move, resize, switch workspace),
preview card generation, and multi-WM CLI compatibility.
"""

import os
import sys
import subprocess
import json

def detect_wm_environment(env=None):
    """
    Detects the current window manager environment.
    """
    e = env if env is not None else os.environ

    if "HYPRLAND_INSTANCE_SIGNATURE" in e:
        return "hyprland"
    if "SWAYSOCK" in e:
        return "sway"
    if "I3SOCK" in e:
        return "i3"

    desktop = e.get("XDG_CURRENT_DESKTOP", "").lower()
    if "gnome" in desktop or "ubuntu" in desktop:
        return "gnome"

    session_type = e.get("XDG_SESSION_TYPE", "").lower()
    if session_type == "x11" or "DISPLAY" in e:
        return "x11"

    return "generic"


def calculate_tile_bounds(direction, monitor_rect=None, padding=0):
    """
    Calculates tile rectangle bounds for window placement.
    """
    mon = monitor_rect or {"x": 0, "y": 0, "width": 1920, "height": 1080}
    pad = max(0, padding)
    avail_x = mon["x"] + pad
    avail_y = mon["y"] + pad
    avail_w = max(100, mon["width"] - pad * 2)
    avail_h = max(100, mon["height"] - pad * 2)
    half_w = avail_w // 2
    half_h = avail_h // 2

    d = (direction or "maximize").lower().strip()

    if d in ("left", "tile-left"):
        return {"x": avail_x, "y": avail_y, "width": half_w, "height": avail_h}
    elif d in ("right", "tile-right"):
        return {"x": avail_x + half_w, "y": avail_y, "width": avail_w - half_w, "height": avail_h}
    elif d in ("top", "tile-top"):
        return {"x": avail_x, "y": avail_y, "width": avail_w, "height": half_h}
    elif d in ("bottom", "tile-bottom"):
        return {"x": avail_x, "y": avail_y + half_h, "width": avail_w, "height": avail_h - half_h}
    elif d in ("top-left", "tile-top-left"):
        return {"x": avail_x, "y": avail_y, "width": half_w, "height": half_h}
    elif d in ("top-right", "tile-top-right"):
        return {"x": avail_x + half_w, "y": avail_y, "width": avail_w - half_w, "height": half_h}
    elif d in ("bottom-left", "tile-bottom-left"):
        return {"x": avail_x, "y": avail_y + half_h, "width": half_w, "height": avail_h - half_h}
    elif d in ("bottom-right", "tile-bottom-right"):
        return {"x": avail_x + half_w, "y": avail_y + half_h, "width": avail_w - half_w, "height": avail_h - half_h}
    elif d == "center":
        cw = int(avail_w * 0.7)
        ch = int(avail_h * 0.7)
        return {
            "x": avail_x + (avail_w - cw) // 2,
            "y": avail_y + (avail_h - ch) // 2,
            "width": cw,
            "height": ch
        }
    else:  # maximize / restore / default
        return {"x": avail_x, "y": avail_y, "width": avail_w, "height": avail_h}


def generate_wm_command(action, target=None, wm_type=None):
    """
    Generates CLI shell command string for the given action and window manager.
    """
    wm = wm_type or detect_wm_environment()
    act = (action or "").lower().strip()
    tgt = target if target is not None else 1

    if wm == "i3":
        if act == "close":
            return "i3-msg kill"
        elif act in ("tile-left", "left"):
            return "i3-msg 'split h; move left'"
        elif act in ("tile-right", "right"):
            return "i3-msg 'split h; move right'"
        elif act in ("tile-top", "top"):
            return "i3-msg 'split v; move up'"
        elif act in ("tile-bottom", "bottom"):
            return "i3-msg 'split v; move down'"
        elif act == "maximize":
            return "i3-msg 'fullscreen toggle'"
        elif act in ("restore", "unmaximize"):
            return "i3-msg 'fullscreen disable'"
        elif act == "switch-workspace":
            return f"i3-msg 'workspace number {tgt}'"
        elif act == "move-workspace":
            return f"i3-msg 'move container to workspace number {tgt}'"
        elif act == "resize-grow":
            return "i3-msg 'resize grow width 10 px or 10 ppt'"
        elif act == "resize-shrink":
            return "i3-msg 'resize shrink width 10 px or 10 ppt'"
        else:
            return f"i3-msg '{act}'"

    elif wm == "sway":
        if act == "close":
            return "swaymsg kill"
        elif act in ("tile-left", "left"):
            return "swaymsg 'split h; move left'"
        elif act in ("tile-right", "right"):
            return "swaymsg 'split h; move right'"
        elif act in ("tile-top", "top"):
            return "swaymsg 'split v; move up'"
        elif act in ("tile-bottom", "bottom"):
            return "swaymsg 'split v; move down'"
        elif act == "maximize":
            return "swaymsg 'fullscreen toggle'"
        elif act in ("restore", "unmaximize"):
            return "swaymsg 'fullscreen disable'"
        elif act == "switch-workspace":
            return f"swaymsg 'workspace number {tgt}'"
        elif act == "move-workspace":
            return f"swaymsg 'move container to workspace number {tgt}'"
        elif act == "resize-grow":
            return "swaymsg 'resize grow width 10 px'"
        elif act == "resize-shrink":
            return "swaymsg 'resize shrink width 10 px'"
        else:
            return f"swaymsg '{act}'"

    elif wm == "hyprland":
        if act == "close":
            return "hyprctl dispatch killactive"
        elif act in ("tile-left", "left"):
            return "hyprctl dispatch movewindow l"
        elif act in ("tile-right", "right"):
            return "hyprctl dispatch movewindow r"
        elif act in ("tile-top", "top"):
            return "hyprctl dispatch movewindow u"
        elif act in ("tile-bottom", "bottom"):
            return "hyprctl dispatch movewindow d"
        elif act == "maximize":
            return "hyprctl dispatch fullscreen 1"
        elif act in ("restore", "unmaximize"):
            return "hyprctl dispatch fullscreen 0"
        elif act == "switch-workspace":
            return f"hyprctl dispatch workspace {tgt}"
        elif act == "move-workspace":
            return f"hyprctl dispatch movetoworkspace {tgt}"
        elif act == "resize-grow":
            return "hyprctl dispatch resizeactive 50 50"
        elif act == "resize-shrink":
            return "hyprctl dispatch resizeactive -50 -50"
        else:
            return f"hyprctl dispatch {act}"

    else:  # gnome / x11 / generic
        if act == "close":
            return "wmctrl -c :ACTIVE: || xdotool getactivewindow windowclose"
        elif act in ("tile-left", "left"):
            return "wmctrl -r :ACTIVE: -b remove,maximized_vert,maximized_horz && wmctrl -r :ACTIVE: -e 0,0,0,960,1080"
        elif act in ("tile-right", "right"):
            return "wmctrl -r :ACTIVE: -b remove,maximized_vert,maximized_horz && wmctrl -r :ACTIVE: -e 0,960,0,960,1080"
        elif act in ("tile-top", "top"):
            return "wmctrl -r :ACTIVE: -b remove,maximized_vert,maximized_horz && wmctrl -r :ACTIVE: -e 0,0,0,1920,540"
        elif act in ("tile-bottom", "bottom"):
            return "wmctrl -r :ACTIVE: -b remove,maximized_vert,maximized_horz && wmctrl -r :ACTIVE: -e 0,0,540,1920,540"
        elif act == "maximize":
            return "wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz"
        elif act in ("restore", "unmaximize"):
            return "wmctrl -r :ACTIVE: -b remove,maximized_vert,maximized_horz"
        elif act == "switch-workspace":
            idx = max(0, int(tgt) - 1) if str(tgt).isdigit() else 0
            return f"wmctrl -s {idx}"
        elif act == "move-workspace":
            idx = max(0, int(tgt) - 1) if str(tgt).isdigit() else 0
            return f"wmctrl -r :ACTIVE: -t {idx}"
        elif act == "resize-grow":
            return "xdotool getactivewindow windowsize --usehints 110% 110%"
        elif act == "resize-shrink":
            return "xdotool getactivewindow windowsize --usehints 90% 90%"
        else:
            return f"wmctrl -r :ACTIVE: {act}"


def parse_wm_command(cmd_str):
    """
    Parses a window management command string.
    """
    if not cmd_str or not isinstance(cmd_str, str):
        return {"is_wm": False, "action": "", "target": None}

    clean = cmd_str.strip()
    if not (clean.startswith("wm:") or clean.startswith("window:")):
        return {"is_wm": False, "action": "", "target": None}

    body = clean[3:] if clean.startswith("wm:") else clean[7:]
    parts = body.strip().split()
    action = parts[0] if parts else ""
    target = parts[1] if len(parts) > 1 else None

    if target is not None and target.isdigit():
        target = int(target)

    return {
        "is_wm": True,
        "action": action,
        "target": target
    }


def execute_wm_command(action, target=None, wm_type=None):
    """
    Executes a window management CLI command.
    """
    cmd = generate_wm_command(action, target, wm_type)
    try:
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=5)
        return res.returncode == 0
    except Exception:
        return False


def render_window_preview_card(window_info):
    """
    Generates preview card metadata and SVG/HTML markup string for a window item.
    """
    win = window_info or {}
    id_val = win.get("id", "win-0")
    title = win.get("title", "Untitled Window")
    wm_class = win.get("wm_class", win.get("wmClass", "Application"))
    rect = win.get("rect", {"x": 0, "y": 0, "width": 800, "height": 600})
    active = bool(win.get("active", False))
    workspace = win.get("workspaceIndex", 0)

    stroke_color = "#89b4fa" if active else "#45475a"
    svg_preview = (
        f'<svg width="120" height="80" viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg">'
        f'<rect width="120" height="80" rx="4" fill="#1e1e2e" stroke="#45475a" stroke-width="1"/>'
        f'<rect x="0" y="0" width="120" height="16" rx="4" fill="#313244"/>'
        f'<circle cx="10" cy="8" r="3" fill="#f38ba8"/>'
        f'<circle cx="20" cy="8" r="3" fill="#f9e2af"/>'
        f'<circle cx="30" cy="8" r="3" fill="#a6e3a1"/>'
        f'<text x="40" y="11" font-size="8" fill="#cdd6f4" font-family="sans-serif">{wm_class[:15]}</text>'
        f'<rect x="10" y="24" width="100" height="48" rx="2" fill="#181825" stroke="{stroke_color}" stroke-width="1"/>'
        f'</svg>'
    )

    active_cls = "active" if active else ""
    preview_html = (
        f'<div class="cmdbar-window-card {active_cls}" data-window-id="{id_val}">'
        f'<div class="cmdbar-window-header"><span class="cmdbar-window-class">{wm_class}</span> - <span class="cmdbar-window-title">{title}</span></div>'
        f'<div class="cmdbar-window-body">{svg_preview}</div>'
        f'<div class="cmdbar-window-meta">Workspace {workspace + 1} | {rect.get("width", 800)}x{rect.get("height", 600)}</div>'
        f'</div>'
    )

    return {
        "id": id_val,
        "title": title,
        "wm_class": wm_class,
        "rect": rect,
        "active": active,
        "workspaceIndex": workspace,
        "svgPreview": svg_preview,
        "previewHtml": preview_html
    }
