#!/usr/bin/env python3
"""
Comprehensive Unit, Integration, Security, and Performance Benchmark Tests
for CmdBar Stream Deck Integration.
"""

import json
import time
import pytest
from companion.stream_deck import (
    StreamDeckButton,
    StreamDeckProfile,
    VisualRenderer,
    StreamDeckPluginProtocol,
    StreamDeckManager,
    get_stream_deck_manager,
)
from companion.dbus_service import CmdBarDBusService
from companion.dbus_client import CmdBarDBusClient


@pytest.fixture
def mock_config():
    return {
        "categories": [
            {
                "name": "Projects",
                "commands": [
                    {"name": "Git Status", "template": "git status"},
                    {"name": "Build Project", "template": "npm run build"},
                ],
            },
            {
                "name": "Infrastructure",
                "commands": [
                    {"name": "Docker PS", "template": "docker ps"},
                    {"name": "Kube Get Pods", "template": "kubectl get pods"},
                ],
            },
        ]
    }


# =====================================================================
# 1. UNIT TESTS: BUTTONS & VISUAL LED FEEDBACK
# =====================================================================

def test_stream_deck_button_creation_and_states():
    btn = StreamDeckButton(
        key_index=0,
        action_type="command",
        command_name="Git Status",
        category="Projects",
        label="Git Status"
    )
    assert btn.key_index == 0
    assert btn.action_type == "command"
    assert btn.command_name == "Git Status"
    assert btn.state == "idle"

    # State update
    btn.set_state("executing")
    assert btn.state == "executing"

    btn.set_state("success", output="On branch main", exec_time_ms=120.0)
    assert btn.state == "success"
    assert btn.last_output == "On branch main"
    assert btn.execution_time_ms == 120.0

    # Serialization and deserialization
    btn_dict = btn.to_dict()
    restored_btn = StreamDeckButton.from_dict(btn_dict)
    assert restored_btn.command_name == "Git Status"
    assert restored_btn.state == "success"
    assert restored_btn.execution_time_ms == 120.0


def test_visual_renderer_led_colors_and_labels():
    renderer = VisualRenderer()

    # LED Feedback colors
    idle_color = renderer.get_led_color_for_state("idle")
    exec_color = renderer.get_led_color_for_state("executing")
    success_color = renderer.get_led_color_for_state("success")
    error_color = renderer.get_led_color_for_state("error")

    assert idle_color != exec_color
    assert success_color == (30, 180, 75)  # Green LED
    assert error_color == (220, 50, 50)     # Red LED

    # Dynamic Label Formatting and Wrapping
    lines = renderer.format_dynamic_label("Deploy Application to Production Staging", max_chars_per_line=10, max_lines=3)
    assert len(lines) <= 3
    assert all(len(line) <= 10 for line in lines)


def test_visual_renderer_svg_and_data_url_generation():
    renderer = VisualRenderer()

    svg = renderer.render_button_svg(
        label="Git Status",
        state="success",
        subtitle="0.1s"
    )
    assert "<svg" in svg
    assert "Git Status" in svg
    assert "0.1s" in svg

    data_url = renderer.render_button_data_url(
        label="Build App",
        state="executing"
    )
    assert data_url.startswith("data:image/svg+xml;base64,")


# =====================================================================
# 2. UNIT TESTS: PROFILES & PROFILE SWITCHING
# =====================================================================

def test_stream_deck_profile_auto_population(mock_config):
    profile = StreamDeckProfile(name="Projects", grid_rows=3, grid_cols=5)
    available_profiles = ["Default", "Projects", "Infrastructure"]

    profile.auto_populate_from_category("Projects", mock_config, available_profiles)

    btn0 = profile.get_button(0)
    assert btn0 is not None
    assert btn0.command_name == "Git Status"

    btn1 = profile.get_button(1)
    assert btn1 is not None
    assert btn1.command_name == "Build Project"

    # Verify Profile Switcher Button placed on key 14 (3x5 grid = 15 keys)
    switch_btn = profile.get_button(14)
    assert switch_btn is not None
    assert switch_btn.action_type == "profile_switch"


def test_profile_switching(mock_config):
    manager = StreamDeckManager()
    manager.load_profiles(mock_config)

    assert "Default" in manager.profiles
    assert "Projects" in manager.profiles
    assert "Infrastructure" in manager.profiles

    # Switch profile
    switched = manager.switch_profile("Infrastructure")
    assert switched is True
    assert manager.active_profile_name == "Infrastructure"

    active_prof = manager.get_active_profile()
    assert active_prof.name == "Infrastructure"

    # Switch to non-existent profile returns False
    assert manager.switch_profile("InvalidProfile") is False
    assert manager.active_profile_name == "Infrastructure"


# =====================================================================
# 3. UNIT TESTS: STREAM DECK PROTOCOL PARSING & MESSAGES
# =====================================================================

def test_stream_deck_protocol_parsing_and_formatting():
    # Incoming message parsing
    raw_incoming = json.dumps({
        "event": "keyDown",
        "action": "com.cmdbar.streamdeck.execute",
        "context": "ctx_123",
        "device": "dev_456",
        "payload": {"keyIndex": 2}
    })

    parsed = StreamDeckPluginProtocol.parse_incoming_message(raw_incoming)
    assert parsed["event"] == "keyDown"
    assert parsed["context"] == "ctx_123"
    assert parsed["payload"]["keyIndex"] == 2

    # Parse invalid json
    invalid_parsed = StreamDeckPluginProtocol.parse_incoming_message("invalid json")
    assert invalid_parsed["event"] == "error"

    # Outgoing messages
    reg_msg = StreamDeckPluginProtocol.format_register_plugin("plugin_uuid_789")
    assert '"event": "registerPlugin"' in reg_msg
    assert '"uuid": "plugin_uuid_789"' in reg_msg

    title_msg = StreamDeckPluginProtocol.format_set_title("ctx_123", "New Label")
    assert '"event": "setTitle"' in title_msg
    assert '"title": "New Label"' in title_msg

    img_msg = StreamDeckPluginProtocol.format_set_image("ctx_123", "data:image/png;base64,123")
    assert '"event": "setImage"' in img_msg

    state_msg = StreamDeckPluginProtocol.format_set_state("ctx_123", 1)
    assert '"event": "setState"' in state_msg

    alert_msg = StreamDeckPluginProtocol.format_show_alert("ctx_123")
    assert '"event": "showAlert"' in alert_msg

    ok_msg = StreamDeckPluginProtocol.format_show_ok("ctx_123")
    assert '"event": "showOk"' in ok_msg

    switch_msg = StreamDeckPluginProtocol.format_switch_to_profile("dev_456", "Projects")
    assert '"event": "switchToProfile"' in switch_msg
    assert '"profile": "Projects"' in switch_msg

    fb_msg = StreamDeckPluginProtocol.format_set_feedback("ctx_123", {"title": "Test"})
    assert '"event": "setFeedback"' in fb_msg


def test_stream_deck_profile_serialization(mock_config):
    profile = StreamDeckProfile(name="TestProfile", grid_rows=3, grid_cols=5)
    profile.auto_populate_from_category("Projects", mock_config)

    p_dict = profile.to_dict()
    restored = StreamDeckProfile.from_dict(p_dict)
    assert restored.name == "TestProfile"
    assert restored.grid_rows == 3
    assert restored.grid_cols == 5
    assert restored.get_button(0).command_name == "Git Status"


def test_manager_context_and_key_actions(mock_config, tmp_path, monkeypatch):
    config_file = tmp_path / "config.json"
    config_file.write_text(json.dumps(mock_config))
    monkeypatch.setenv("CMDBAR_CONFIG_PATH", str(config_file))

    manager = get_stream_deck_manager()
    manager.load_profiles(mock_config)

    # Context registration
    manager.register_context("ctx_test", 0)
    assert manager.context_key_map["ctx_test"] == 0
    manager.unregister_context("ctx_test")
    assert "ctx_test" not in manager.context_key_map

    # Handle key down for command fallback
    res = manager.handle_key_down("ctx_0", 0)
    assert res["status"] == "executed"
    assert res["action"] == "command"

    # Handle key down for profile switch button (slot 14)
    prof = manager.get_active_profile()
    prof.set_button(14, StreamDeckButton(14, action_type="profile_switch", target_profile="Projects"))
    res_switch = manager.handle_key_down("ctx_14", 14)
    assert res_switch["status"] == "profile_switched"

    # Update command feedback
    manager.update_command_feedback("Git Status", exit_code=0, success=True, execution_time_ms=50.0)
    btn = manager.profiles["Projects"].get_button(0)
    assert btn.state == "success"
    assert btn.execution_time_ms == 0.05



# =====================================================================
# 4. SECURITY REVIEW TESTS
# =====================================================================

def test_security_input_sanitization():
    renderer = VisualRenderer()

    # XML injection attack in labels
    malicious_label = "<script>alert('xss')</script> & 'hello'"
    clean_label = renderer.sanitize_label(malicious_label)
    assert "<script>" not in clean_label
    assert "&lt;script&gt;" in clean_label
    assert "&amp;" in clean_label

    svg = renderer.render_button_svg(label=malicious_label)
    assert "<script>" not in svg

    manager = StreamDeckManager()
    dirty_profile_name = "Projects\r\n; rm -rf /"
    clean_profile = manager.sanitize_input(dirty_profile_name)
    assert "\r" not in clean_profile
    assert "\n" not in clean_profile


# =====================================================================
# 5. INTEGRATION TESTS: D-BUS & STREAM DECK MANAGER
# =====================================================================

def test_dbus_stream_deck_integration(tmp_path, mock_config, monkeypatch):
    config_file = tmp_path / "config.json"
    config_file.write_text(json.dumps(mock_config))
    monkeypatch.setenv("CMDBAR_CONFIG_PATH", str(config_file))

    manager = get_stream_deck_manager()
    manager.active_profile_name = "Default"
    manager.load_profiles(mock_config)

    service = CmdBarDBusService(config_path=str(config_file))
    client = CmdBarDBusClient(service=service)

    # Fetch profiles via D-Bus client
    profiles_info = client.get_stream_deck_profiles()
    assert profiles_info["active_profile"] == "Default"
    assert "Projects" in profiles_info["profiles"]

    # Switch profile via D-Bus client
    switch_res = client.set_stream_deck_profile("Projects")
    assert switch_res is True

    updated_profiles = client.get_stream_deck_profiles()
    assert updated_profiles["active_profile"] == "Projects"

    # Trigger button execution via D-Bus client
    trigger_res = client.trigger_stream_deck_button(0)
    assert trigger_res is True

    # Status summary check
    status = client.get_stream_deck_status()
    assert status["active_profile"] == "Projects"


# =====================================================================
# 6. PERFORMANCE BENCHMARKS
# =====================================================================

def test_performance_benchmarks():
    renderer = VisualRenderer(cache_size=500)

    # 1. Render Throughput Benchmark (<5ms per SVG render)
    labels = [f"Command {i}" for i in range(100)]
    start_time = time.perf_counter()
    for lbl in labels:
        renderer.render_button_svg(lbl, state="idle")
    total_render_ms = (time.perf_counter() - start_time) * 1000.0
    avg_render_ms = total_render_ms / 100.0

    print(f"\n[BENCHMARK] Average visual button render time: {avg_render_ms:.3f} ms")
    assert avg_render_ms < 5.0, f"Render benchmark failed: {avg_render_ms:.3f} ms >= 5.0 ms target"

    # 2. Render Cache Benchmark (Repeated renders <0.1ms)
    start_cache_time = time.perf_counter()
    for _ in range(500):
        renderer.render_button_svg("Command 0", state="idle")
    total_cache_ms = (time.perf_counter() - start_cache_time) * 1000.0
    avg_cache_ms = total_cache_ms / 500.0

    print(f"[BENCHMARK] Average cached render time: {avg_cache_ms:.4f} ms")
    assert avg_cache_ms < 0.1, f"Cache benchmark failed: {avg_cache_ms:.4f} ms >= 0.1 ms target"

    # 3. Profile Switch Latency Benchmark (<10ms)
    manager = StreamDeckManager()
    manager.profiles["Projects"] = StreamDeckProfile("Projects")
    manager.profiles["Infrastructure"] = StreamDeckProfile("Infrastructure")

    start_switch = time.perf_counter()
    for i in range(100):
        target = "Infrastructure" if i % 2 == 0 else "Projects"
        manager.switch_profile(target)
    total_switch_ms = (time.perf_counter() - start_switch) * 1000.0
    avg_switch_ms = total_switch_ms / 100.0

    print(f"[BENCHMARK] Average profile switch latency: {avg_switch_ms:.3f} ms")
    assert avg_switch_ms < 10.0, f"Profile switch benchmark failed: {avg_switch_ms:.3f} ms >= 10.0 ms target"
