import os
import pytest
from companion.kde_integration import (
    KWinIntegration,
    SystemTrayApplet,
    KDEThemeDetector,
    KDEPlasmaManager
)

def test_kwin_integration():
    os.environ["CMDBAR_MOCK_KWIN"] = "1"
    kwin = KWinIntegration()
    assert kwin.is_kwin_running() is True

    rules = kwin.get_window_rules("CmdBar")
    assert rules["title"] == "CmdBar"
    assert rules["keep_above"] is True
    assert rules["shortcut"] == "Meta+Space"

    geom = kwin.get_screen_geometry()
    assert "width" in geom and "height" in geom
    assert kwin.apply_window_rules("CmdBar") is True
    assert kwin.toggle_cmdbar_window() is True

def test_system_tray_applet():
    tray = SystemTrayApplet(title="CmdBar Test", icon="utilities-terminal")
    spec = tray.get_status_notifier_item_spec()
    assert spec["Title"] == "CmdBar Test"
    assert spec["Category"] == "ApplicationStatus"
    assert len(spec["Actions"]) >= 3

    tray.set_status("Passive")
    assert tray.status == "Passive"

    tray.set_tooltip("Custom Tooltip")
    assert tray.tooltip == "Custom Tooltip"

    res = tray.trigger_action("toggle")
    assert res["success"] is True
    assert res["action"] == "toggle"

    invalid_res = tray.trigger_action("unknown_action")
    assert invalid_res["success"] is False

def test_kde_theme_detector(tmp_path):
    kdeglobals_file = tmp_path / "kdeglobals"
    kdeglobals_content = (
        "[Colors:Window]\n"
        "BackgroundNormal=42,46,50\n"
        "ForegroundNormal=252,252,252\n"
        "[Colors:Selection]\n"
        "BackgroundNormal=61,174,233\n"
    )
    kdeglobals_file.write_text(kdeglobals_content, encoding="utf-8")

    theme = KDEThemeDetector(config_path=str(kdeglobals_file))
    assert theme.is_dark_mode() is True

    colors = theme.get_color_scheme()
    assert colors["background"] == "#2a2e32"
    assert colors["foreground"] == "#fcfcfc"
    assert colors["selection_background"] == "#3daee9"

    palette = theme.get_qml_palette()
    assert palette["windowBackgroundColor"] == "#2a2e32"
    assert palette["highlightColor"] == "#3daee9"

    css = theme.to_css_variables()
    assert "--kde-window-bg: #2a2e32;" in css

def test_kde_plasma_manager(tmp_path):
    os.environ["CMDBAR_FORCE_KDE"] = "1"
    os.environ["CMDBAR_DISABLE_KWALLET"] = "1"
    os.environ["CMDBAR_MOCK_KWIN"] = "1"

    mgr = KDEPlasmaManager()
    assert mgr.is_kde_plasma() is True

    manifest = mgr.get_plasmoid_manifest()
    assert manifest["KPlugin"]["Id"] == "org.kde.cmdbar"

    target_dir = tmp_path / "org.kde.cmdbar"
    installed = mgr.install_plasmoid(target_dir=str(target_dir))
    assert installed is True
    assert (target_dir / "metadata.json").exists()

    status = mgr.get_plasma_status()
    assert status["is_kde"] is True
    assert status["plasmoid_id"] == "org.kde.cmdbar"

    uninstalled = mgr.uninstall_plasmoid(target_dir=str(target_dir))
    assert uninstalled is True
    assert not target_dir.exists()
