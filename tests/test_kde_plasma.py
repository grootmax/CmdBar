"""
Unit tests for KDE Plasma integration modules in CmdBar Companion.
Tests KWallet, KWin, System Tray, Plasma Theme Adapter, and CmdBarKdeService.
"""

import pytest
from companion.kde_plasma.kwallet import KWalletManager
from companion.kde_plasma.kwin import KWinManager
from companion.kde_plasma.system_tray import SystemTrayManager
from companion.kde_plasma.theme import PlasmaThemeAdapter
from companion.kde_plasma.service import CmdBarKdeService


class TestKWalletManager:
    def test_open_and_close_wallet(self):
        wm = KWalletManager()
        assert wm.open_wallet() is True
        assert wm.is_open is True
        assert wm.close_wallet() is True
        assert wm.is_open is False

    def test_write_and_read_secret(self):
        wm = KWalletManager()
        wm.open_wallet()
        assert wm.write_secret("OPENAI_API_KEY", "sk-test123456") is True
        assert wm.has_secret("OPENAI_API_KEY") is True
        assert wm.read_secret("OPENAI_API_KEY") == "sk-test123456"

    def test_delete_secret(self):
        wm = KWalletManager()
        wm.open_wallet()
        wm.write_secret("TEMP_SECRET", "val999")
        assert wm.has_secret("TEMP_SECRET") is True
        assert wm.delete_secret("TEMP_SECRET") is True
        assert wm.has_secret("TEMP_SECRET") is False
        assert wm.read_secret("TEMP_SECRET") is None

    def test_invalid_keys(self):
        wm = KWalletManager()
        wm.open_wallet()
        assert wm.write_secret("", "val") is False
        assert wm.write_secret(None, "val") is False
        assert wm.read_secret("") is None
        assert wm.read_secret(None) is None


class TestKWinManager:
    def test_register_and_trigger_shortcut(self):
        km = KWinManager()
        triggered = []

        def on_shortcut(sc):
            triggered.append(sc)

        assert km.register_shortcut("Meta+Space", on_shortcut) is True
        assert km.active_shortcut == "Meta+Space"
        km.trigger_shortcut()
        assert triggered == ["Meta+Space"]

    def test_active_window_context(self):
        km = KWinManager()
        ctx = km.get_active_window_context()
        assert "windowClass" in ctx
        assert "windowTitle" in ctx

        new_ctx = km.set_active_window_context({
            "windowClass": "kate",
            "windowTitle": "main.py - Kate",
            "pid": 5678,
            "desktop": 2,
        })
        assert new_ctx["windowClass"] == "kate"
        assert new_ctx["desktop"] == 2

    def test_calculate_popup_position(self):
        km = KWinManager()
        pos = km.calculate_popup_position(
            panel_bounds={"x": 0, "y": 0, "width": 1920, "height": 36},
            popup_size={"width": 400, "height": 500}
        )
        assert "x" in pos and "y" in pos
        assert pos["y"] == 40
        assert pos["x"] > 0


class TestSystemTrayManager:
    def test_update_status_and_tooltip(self):
        stm = SystemTrayManager()
        res = stm.update_status("NeedsAttention", 3)
        assert res["status"] == "NeedsAttention"
        assert res["badge_count"] == 3

        tt = stm.set_tooltip("CmdBar Active Menu")
        assert tt == "CmdBar Active Menu"
        assert stm.tooltip == "CmdBar Active Menu"

    def test_menu_items_and_triggers(self):
        stm = SystemTrayManager()
        items = stm.get_menu_items()
        assert len(items) >= 4

        clicked = []
        stm.on_menu_item("exec", lambda item_id: clicked.append(item_id))
        assert stm.trigger_menu_item("exec") is True
        assert clicked == ["exec"]

    def test_notifications_and_visibility(self):
        stm = SystemTrayManager()
        notif_id = stm.send_notification("Test Title", "Test Body")
        assert notif_id > 0
        assert stm.set_visible(False) is False
        assert stm.is_visible is False


class TestPlasmaThemeAdapter:
    def test_dark_and_light_palette(self):
        pta = PlasmaThemeAdapter(is_dark=True)
        pal_dark = pta.get_palette()
        assert pal_dark["windowBackground"] == "#2a2e32"

        pal_light = pta.set_dark(False)
        assert pal_light["windowBackground"] == "#eff0f1"
        assert pta.is_dark is False

    def test_set_scheme(self):
        pta = PlasmaThemeAdapter()
        pal = pta.set_scheme("BreezeLight")
        assert pta.is_dark is False

        pal2 = pta.set_scheme("BreezeDark")
        assert pta.is_dark is True

    def test_css_variables_and_formatting_colors(self):
        pta = PlasmaThemeAdapter(is_dark=True)
        css = pta.to_css_variables()
        assert "--plasma-window-bg" in css
        colors = pta.get_formatting_colors()
        assert "key" in colors and "string" in colors


class TestCmdBarKdeService:
    def test_service_lifecycle_and_commands(self, tmp_path):
        service = CmdBarKdeService()
        assert service.add_command("KDE Test Cmd", "echo 'Hello Plasma'", "Testing") is True

        cmds_json = service.get_commands()
        assert "KDE Test Cmd" in cmds_json

        exec_res = service.execute_command("KDE Test Cmd")
        assert exec_res["success"] is True
        assert "Hello Plasma" in exec_res["stdout"]

        assert service.save_secret("PLASMA_TOKEN", "token123") is True
        assert service.get_secret("PLASMA_TOKEN") == "token123"

        assert service.remove_command("KDE Test Cmd") is True
