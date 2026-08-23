#!/usr/bin/env python3
"""
Unit tests for CmdBar Python Window Manager module.
"""

import pytest
from companion.window_manager import (
    get_windows_list,
    close_window,
    move_window,
    resize_window,
    tile_window,
    switch_workspace,
    generate_window_preview,
    execute_window_command,
)


def test_get_windows_list():
    windows = get_windows_list()
    assert isinstance(windows, list)
    assert len(windows) > 0
    first = windows[0]
    assert "id" in first
    assert "title" in first
    assert "rect" in first


def test_close_window():
    res = close_window()
    assert res["success"] is True
    assert "cliCommand" in res
    assert "xdotool" in res["cliCommand"] or "wmctrl" in res["cliCommand"]


def test_move_window():
    res_dir = move_window("left")
    assert res_dir["success"] is True
    assert "left" in res_dir["message"]

    res_coords = move_window("200,100")
    assert res_coords["success"] is True
    assert "200" in res_coords["cliCommand"]


def test_resize_window():
    res_grow = resize_window("grow")
    assert res_grow["success"] is True

    res_size = resize_window("800,600")
    assert res_size["success"] is True
    assert "800" in res_size["cliCommand"]


def test_tile_window():
    res_left = tile_window("left")
    assert res_left["success"] is True

    res_max = tile_window("maximize")
    assert res_max["success"] is True
    assert "maximized" in res_max["cliCommand"] or "fullscreen" in res_max["cliCommand"]


def test_switch_workspace():
    res_next = switch_workspace("next")
    assert res_next["success"] is True

    res_num = switch_workspace("2")
    assert res_num["success"] is True

    res_move = switch_workspace("move:2")
    assert res_move["success"] is True


def test_generate_window_preview():
    preview = generate_window_preview()
    assert isinstance(preview, str)
    assert "Desktop Window Layout" in preview
    assert "Window Details:" in preview


def test_execute_window_command():
    res_tile = execute_window_command("cmdbar:window:tile left")
    assert res_tile["isWindowCmd"] is True
    assert res_tile["result"]["success"] is True

    res_prev = execute_window_command("cmdbar:window:preview")
    assert res_prev["isWindowCmd"] is True
    assert "preview" in res_prev["result"]

    res_non = execute_window_command("make build")
    assert res_non["isWindowCmd"] is False
