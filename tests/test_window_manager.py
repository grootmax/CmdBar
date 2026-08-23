#!/usr/bin/env python3
import pytest
from companion.window_manager import (
    detect_wm_environment,
    calculate_tile_bounds,
    generate_wm_command,
    parse_wm_command,
    execute_wm_command,
    render_window_preview_card,
)

def test_detect_wm_environment():
    assert detect_wm_environment({"HYPRLAND_INSTANCE_SIGNATURE": "123"}) == "hyprland"
    assert detect_wm_environment({"SWAYSOCK": "/path/sock"}) == "sway"
    assert detect_wm_environment({"I3SOCK": "/path/sock"}) == "i3"
    assert detect_wm_environment({"XDG_CURRENT_DESKTOP": "ubuntu:GNOME"}) == "gnome"
    assert detect_wm_environment({"XDG_SESSION_TYPE": "x11"}) == "x11"
    assert detect_wm_environment({}) == "generic"


def test_calculate_tile_bounds():
    mon = {"x": 0, "y": 0, "width": 1920, "height": 1080}
    left = calculate_tile_bounds("tile-left", mon)
    assert left == {"x": 0, "y": 0, "width": 960, "height": 1080}

    right = calculate_tile_bounds("tile-right", mon)
    assert right == {"x": 960, "y": 0, "width": 960, "height": 1080}

    top = calculate_tile_bounds("tile-top", mon)
    assert top == {"x": 0, "y": 0, "width": 1920, "height": 540}

    bottom = calculate_tile_bounds("tile-bottom", mon)
    assert bottom == {"x": 0, "y": 540, "width": 1920, "height": 540}

    padded = calculate_tile_bounds("tile-left", mon, padding=10)
    assert padded == {"x": 10, "y": 10, "width": 950, "height": 1060}


def test_generate_wm_command():
    assert generate_wm_command("close", wm_type="i3") == "i3-msg kill"
    assert generate_wm_command("tile-left", wm_type="sway") == "swaymsg 'split h; move left'"
    assert generate_wm_command("maximize", wm_type="hyprland") == "hyprctl dispatch fullscreen 1"
    assert generate_wm_command("switch-workspace", target=2, wm_type="i3") == "i3-msg 'workspace number 2'"
    assert generate_wm_command("close", wm_type="x11") == "wmctrl -c :ACTIVE: || xdotool getactivewindow windowclose"


def test_parse_wm_command():
    p1 = parse_wm_command("wm:tile-left")
    assert p1["is_wm"] is True
    assert p1["action"] == "tile-left"
    assert p1["target"] is None

    p2 = parse_wm_command("wm:move-workspace 3")
    assert p2["is_wm"] is True
    assert p2["action"] == "move-workspace"
    assert p2["target"] == 3

    p3 = parse_wm_command("echo hello")
    assert p3["is_wm"] is False


def test_render_window_preview_card():
    win = {
        "id": "win-10",
        "title": "Terminal",
        "wm_class": "gnome-terminal",
        "rect": {"x": 0, "y": 0, "width": 960, "height": 1080},
        "active": True,
        "workspaceIndex": 0
    }
    card = render_window_preview_card(win)
    assert card["id"] == "win-10"
    assert card["active"] is True
    assert "<svg" in card["svgPreview"]
    assert "cmdbar-window-card active" in card["previewHtml"]
    assert "Workspace 1" in card["previewHtml"]


def test_execute_wm_command():
    # Execute a mock command (or echo)
    res = execute_wm_command("close", wm_type="i3")
    assert isinstance(res, bool)
