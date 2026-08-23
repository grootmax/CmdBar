import json
import pytest
from companion.numpad_manager import NumpadManager, DEFAULT_NUMPAD_CONFIG
from companion.dbus_service import CmdBarDBusService
from app.config_schema import load_config, save_config, DEFAULT_CONFIG

def test_default_numpad_config():
    assert DEFAULT_NUMPAD_CONFIG["enabled"] is True
    assert len(DEFAULT_NUMPAD_CONFIG["layers"]) == 3
    layer_ids = [l["id"] for l in DEFAULT_NUMPAD_CONFIG["layers"]]
    assert "default" in layer_ids
    assert "gaming" in layer_ids
    assert "dev" in layer_ids

def test_numpad_manager_init():
    config = {"numpad": DEFAULT_NUMPAD_CONFIG}
    mgr = NumpadManager(config)
    assert mgr.is_enabled() is True
    assert mgr.get_active_layer_index() == 0
    assert mgr.get_active_layer()["name"] == "Default"

def test_numpad_manager_switch_layer():
    config = {"numpad": json.loads(json.dumps(DEFAULT_NUMPAD_CONFIG))}
    mgr = NumpadManager(config)

    mgr.switch_layer(1)
    assert mgr.get_active_layer_index() == 1
    assert mgr.get_active_layer()["id"] == "gaming"

    mgr.switch_layer("dev")
    assert mgr.get_active_layer_index() == 2

    mgr.cycle_layer()
    assert mgr.get_active_layer_index() == 0

def test_numpad_manager_bindings():
    config = {"numpad": json.loads(json.dumps(DEFAULT_NUMPAD_CONFIG))}
    mgr = NumpadManager(config)

    binding0 = mgr.get_binding(0)
    assert binding0 is not None
    assert binding0["name"] == "System Status"

    new_binding = {"name": "Test Action", "command": "echo test"}
    assert mgr.set_binding("gaming", 5, new_binding) is True

    mgr.switch_layer("gaming")
    b5 = mgr.get_binding(5)
    assert b5["name"] == "Test Action"

def test_numpad_manager_trigger_key():
    config = {"numpad": json.loads(json.dumps(DEFAULT_NUMPAD_CONFIG))}
    mgr = NumpadManager(config)

    executed = []
    res = mgr.trigger_key(1, executor=lambda name, cmd, b: executed.append((name, cmd)))
    assert res["success"] is True
    assert res["key"] == 1
    assert res["name"] == "Build Project"
    assert len(executed) == 1
    assert executed[0][0] == "Build Project"

def test_numpad_manager_disabled_trigger():
    config = {"numpad": json.loads(json.dumps(DEFAULT_NUMPAD_CONFIG))}
    mgr = NumpadManager(config)
    mgr.set_enabled(False)
    res = mgr.trigger_key(1)
    assert res["success"] is False
    assert res["reason"] == "Numpad disabled"

def test_numpad_manager_overlay():
    config = {"numpad": json.loads(json.dumps(DEFAULT_NUMPAD_CONFIG))}
    mgr = NumpadManager(config)

    assert mgr.is_overlay_visible() is False
    vis = mgr.toggle_overlay()
    assert vis is True
    assert mgr.is_overlay_visible() is True

    data = mgr.get_overlay_data()
    assert data["enabled"] is True
    assert data["activeLayerName"] == "Default"
    assert len(data["grid"]) == 10

    ascii_hud = mgr.format_overlay_ascii()
    assert "CmdBar Numpad Macro Pad" in ascii_hud
    assert "Default" in ascii_hud

def test_dbus_service_numpad_methods(tmp_path):
    cfg_file = tmp_path / "config.json"
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    save_config(cfg, str(cfg_file))

    service = CmdBarDBusService(config_path=str(cfg_file))
    
    numpad_cfg = service.get_numpad_config()
    assert "layers" in numpad_cfg

    success, layer_idx = service.switch_numpad_layer("gaming")
    assert success is True
    assert layer_idx == 1

    ok, name = service.trigger_numpad_key(0)
    assert ok is True
    assert name == "Mute Mic"
