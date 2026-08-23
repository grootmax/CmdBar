#!/usr/bin/env python3
import os
import json
import time
import pytest
from companion.stream_deck import (
    LEDState,
    DeviceModel,
    StreamDeckKey,
    StreamDeckProfile,
    StreamDeckManager
)
from companion.dbus_service import CmdBarDBusService
from companion.dbus_client import CmdBarDBusClient
from companion.companion_app import save_config


@pytest.fixture
def temp_config(tmp_path, monkeypatch):
    config_file = tmp_path / "config.json"
    monkeypatch.setenv("CMDBAR_CONFIG_PATH", str(config_file))
    initial_config = {
        "categories": [
            {
                "name": "Projects",
                "commands": [
                    {"name": "Build Project", "template": "echo 'built'"}
                ]
            },
            {
                "name": "DevOps",
                "commands": [
                    {"name": "Deploy Staging", "template": "echo 'deployed'"}
                ]
            }
        ]
    }
    save_config(initial_config)
    return config_file


def test_led_state_and_device_models():
    assert LEDState.IDLE == "idle"
    assert LEDState.RUNNING == "running"
    assert LEDState.SUCCESS == "success"
    assert LEDState.ERROR == "error"

    assert LEDState.COLOR_MAP["idle"] == "#4A5568"
    assert LEDState.COLOR_MAP["success"] == "#48BB78"

    assert DeviceModel.CONFIGS["MINI"]["keys"] == 6
    assert DeviceModel.CONFIGS["ORIGINAL"]["keys"] == 15
    assert DeviceModel.CONFIGS["XL"]["keys"] == 32
    assert DeviceModel.CONFIGS["PLUS"]["keys"] == 8


def test_stream_deck_key_serialization():
    key = StreamDeckKey(
        key_index=2,
        command_name="Test Cmd",
        label_template="{name}\n[{status}]",
        custom_label="Custom",
        bg_color="#222222",
        action_type="command",
        parameters={"env": "prod"}
    )
    d = key.to_dict()
    assert d["key_index"] == 2
    assert d["command_name"] == "Test Cmd"
    assert d["parameters"]["env"] == "prod"

    key2 = StreamDeckKey.from_dict(d)
    assert key2.key_index == 2
    assert key2.command_name == "Test Cmd"
    assert key2.parameters["env"] == "prod"


def test_stream_deck_profile_operations():
    profile = StreamDeckProfile("DevProfile", device_model=DeviceModel.MINI)
    assert profile.get_max_keys() == 6

    key0 = StreamDeckKey(key_index=0, command_name="Cmd 0")
    key5 = StreamDeckKey(key_index=5, command_name="Cmd 5")
    key6 = StreamDeckKey(key_index=6, command_name="Out of bounds")

    profile.set_key(key0)
    profile.set_key(key5)
    profile.set_key(key6)

    assert profile.get_key(0).command_name == "Cmd 0"
    assert profile.get_key(5).command_name == "Cmd 5"
    assert profile.get_key(6) is None

    assert profile.remove_key(0) is True
    assert profile.get_key(0) is None

    p_dict = profile.to_dict()
    profile2 = StreamDeckProfile.from_dict(p_dict)
    assert profile2.name == "DevProfile"
    assert profile2.get_key(5).command_name == "Cmd 5"


def test_manager_profile_crud_and_switching(temp_config):
    manager = StreamDeckManager(config_path=str(temp_config))
    assert "Default" in manager.list_profiles()

    dev_prof = manager.create_profile("DevOps", device_model=DeviceModel.XL, auto_switch_category="DevOps")
    assert "DevOps" in manager.list_profiles()
    assert dev_prof.device_model == DeviceModel.XL

    assert manager.set_active_profile("DevOps") is True
    assert manager.get_active_profile().name == "DevOps"

    # Cannot delete active profile or sole profile without fallback
    assert manager.delete_profile("DevOps") is True
    assert manager.get_active_profile().name == "Default"

    with pytest.raises(ValueError):
        manager.create_profile("   ")


def test_key_bindings_and_dynamic_labels(temp_config):
    manager = StreamDeckManager(config_path=str(temp_config))
    key = manager.set_key_binding(
        key_index=1,
        command_name="Build Project",
        label_template="{name}\n{status}",
        bg_color="#101010",
        parameters={"branch": "main"}
    )
    assert key.key_index == 1

    label = manager.resolve_dynamic_label(key)
    assert "Build Project" in label
    assert "idle" in label

    # Custom label test
    key.custom_label = "Custom Title"
    assert manager.resolve_dynamic_label(key) == "Custom Title"

    manager.clear_key_binding(1)
    assert manager.get_active_profile().get_key(1) is None


def test_visual_button_rendering_and_caching(temp_config):
    manager = StreamDeckManager(config_path=str(temp_config))
    manager.set_key_binding(0, "Build Project", bg_color="#2A2A2A")

    render0 = manager.render_key_visual(0)
    assert render0["key_index"] == 0
    assert render0["bg_color"] == "#2A2A2A"
    assert "<svg" in render0["svg"]
    assert "data:image/svg+xml;base64," in render0["svg_base64"]

    # Test caching
    stats_before = manager.get_performance_stats()
    render0_cached = manager.render_key_visual(0)
    stats_after = manager.get_performance_stats()

    assert stats_after["cache_hits"] > stats_before["cache_hits"]
    assert render0_cached["svg"] == render0["svg"]

    # Full grid render
    grid = manager.render_profile_grid()
    assert len(grid) == DeviceModel.CONFIGS["ORIGINAL"]["keys"]


def test_key_press_execution_and_led_transitions(temp_config):
    manager = StreamDeckManager(config_path=str(temp_config))
    manager.set_key_binding(0, "Build Project")

    executed_events = []
    manager.add_execution_listener(lambda idx, name, meta: executed_events.append((idx, name, meta)))

    res = manager.press_key(0)
    assert res["success"] is True
    assert res["command_name"] == "Build Project"
    assert res["code"] == 0

    key = manager.get_active_profile().get_key(0)
    assert key.led_state == LEDState.SUCCESS
    assert "built" in key.last_output

    assert len(executed_events) == 1
    assert executed_events[0][0] == 0
    assert executed_events[0][1] == "Build Project"


def test_profile_switch_action_and_auto_category_switch(temp_config):
    manager = StreamDeckManager(config_path=str(temp_config))
    manager.create_profile("Media", auto_switch_category="DevOps")

    # Set switch profile action on key 2
    manager.set_key_binding(
        key_index=2,
        command_name="",
        action_type="switch_profile",
        target_profile="Media"
    )

    press_res = manager.press_key(2)
    assert press_res["success"] is True
    assert press_res["action_type"] == "switch_profile"
    assert manager.get_active_profile().name == "Media"

    # Auto category switch
    switched = manager.auto_switch_for_category("DevOps")
    assert switched == "Media"
    assert manager.get_active_profile().name == "Media"


def test_export_and_import_profile_json(temp_config):
    manager = StreamDeckManager(config_path=str(temp_config))
    manager.set_key_binding(0, "Build Project")

    json_str = manager.export_profile_json("Default")
    assert "Default" in json_str
    assert "Build Project" in json_str

    data = json.loads(json_str)
    data["name"] = "ImportedProfile"
    imported = manager.import_profile_json(json.dumps(data))

    assert imported.name == "ImportedProfile"
    assert "ImportedProfile" in manager.list_profiles()


def test_performance_benchmarks(temp_config):
    manager = StreamDeckManager(config_path=str(temp_config))
    for i in range(15):
        manager.set_key_binding(i, f"Cmd {i}")

    # Measure 100 visual render cycles
    start_t = time.perf_counter()
    for _ in range(100):
        manager.clear_render_cache()
        for i in range(15):
            manager.render_key_visual(i)
    total_time_ms = (time.perf_counter() - start_t) * 1000.0

    avg_render_time = total_time_ms / (100 * 15)
    # Acceptance criteria benchmark: Average render time < 5.0ms per key
    assert avg_render_time < 5.0, f"Average key render time ({avg_render_time:.3f}ms) exceeds 5.0ms benchmark"

    stats = manager.get_performance_stats()
    assert stats["total_renders"] >= 1500


def test_dbus_stream_deck_integration(temp_config):
    service = CmdBarDBusService(config_path=str(temp_config))
    client = CmdBarDBusClient(service=service)

    # Press key via DBus
    press_ok = client.stream_deck_press_key(0)
    assert press_ok is True

    # Get grid via DBus
    grid = client.stream_deck_get_profile_grid()
    assert isinstance(grid, list)
    assert len(grid) == 15

    # Switch profile via DBus
    service.stream_deck.create_profile("DBusProf")
    switch_ok = client.stream_deck_set_active_profile("DBusProf")
    assert switch_ok is True
