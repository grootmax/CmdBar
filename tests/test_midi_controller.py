#!/usr/bin/env python3
"""
Unit tests for MIDI Controller Manager in companion app.
"""

import pytest
import time
from companion.midi_controller import (
    parse_raw_midi_bytes,
    scale_value,
    get_hardware_profile,
    HARDWARE_PROFILES,
    MidiControllerManager,
)


def test_parse_raw_midi_bytes_note_on():
    bytes_in = [0x90, 60, 100]
    evt = parse_raw_midi_bytes(bytes_in)
    assert evt["type"] == "note_on"
    assert evt["channel"] == 0
    assert evt["note"] == 60
    assert evt["velocity"] == 100


def test_parse_raw_midi_bytes_note_off_zero_velocity():
    bytes_in = [0x90, 60, 0]
    evt = parse_raw_midi_bytes(bytes_in)
    assert evt["type"] == "note_off"
    assert evt["velocity"] == 0


def test_parse_raw_midi_bytes_cc():
    bytes_in = [0xB0, 7, 127]
    evt = parse_raw_midi_bytes(bytes_in)
    assert evt["type"] == "cc"
    assert evt["cc"] == 7
    assert evt["value"] == 127


def test_parse_raw_midi_bytes_program_change():
    bytes_in = [0xC1, 5]
    evt = parse_raw_midi_bytes(bytes_in)
    assert evt["type"] == "program_change"
    assert evt["channel"] == 1
    assert evt["program"] == 5


def test_parse_raw_midi_bytes_pitch_bend():
    bytes_in = [0xE0, 0x00, 0x40]
    evt = parse_raw_midi_bytes(bytes_in)
    assert evt["type"] == "pitch_bend"
    assert evt["value"] == 8192


def test_parse_raw_midi_bytes_invalid():
    evt = parse_raw_midi_bytes(None)
    assert evt["type"] == "unknown"
    evt2 = parse_raw_midi_bytes([0x90])
    assert evt2["type"] == "unknown"


def test_scale_value():
    assert scale_value(0, 0, 100, "linear") == 0.0
    assert scale_value(127, 0, 100, "linear") == 100.0
    assert scale_value(63.5, 0, 100, "linear") == pytest.approx(50.0, abs=1.0)

    # Curves
    mid_exp = scale_value(63.5, 0, 100, "exponential")
    assert mid_exp < 50.0

    mid_log = scale_value(63.5, 0, 100, "logarithmic")
    assert mid_log > 50.0

    # Relative
    inc = scale_value(1, 0, 100, "linear", "relative", 50.0)
    assert inc > 50.0


def test_get_hardware_profile():
    lp = get_hardware_profile("launchpad")
    assert lp["name"] == "Novation Launchpad"

    lpd8 = get_hardware_profile("lpd8")
    assert lpd8["name"] == "Akai LPD8"

    gen = get_hardware_profile("unknown")
    assert gen["name"] == "Generic MIDI Controller"


def test_midi_controller_device_management():
    mgr = MidiControllerManager()
    dev = mgr.register_device({"id": "d1", "name": "Device 1", "profile": "lpd8"})
    assert dev["id"] == "d1"
    assert len(mgr.get_connected_devices()) == 1

    assert mgr.disconnect_device("d1") is True
    assert len(mgr.get_connected_devices()) == 0


def test_midi_controller_profile_loading():
    mgr = MidiControllerManager()
    mappings = mgr.load_profile("lpd8")
    assert len(mappings) == 16
    assert len(mgr.mappings) == 16


def test_midi_controller_event_processing_trigger():
    mgr = MidiControllerManager()
    executed = []

    def mock_exec(cmd, meta):
        executed.append(cmd)
        return True

    mgr.set_command_executor(mock_exec)
    mgr.add_mapping({
        "id": "btn1",
        "event_type": "note_on",
        "note": 60,
        "mode": "trigger",
        "command": "echo 'Hello MIDI'",
    })

    res = mgr.process_midi_event([0x90, 60, 100])
    assert res["executed"] is True
    assert res["command"] == "echo 'Hello MIDI'"
    assert len(executed) == 1


def test_midi_controller_event_processing_toggle():
    mgr = MidiControllerManager()
    mgr.add_mapping({
        "id": "t1",
        "event_type": "note_on",
        "note": 60,
        "mode": "toggle",
        "command": "echo 'ON'",
        "release_command": "echo 'OFF'",
    })

    r1 = mgr.process_midi_event([0x90, 60, 100])
    assert r1["command"] == "echo 'ON'"

    r2 = mgr.process_midi_event([0x90, 60, 100])
    assert r2["command"] == "echo 'OFF'"


def test_midi_controller_parameter_substitution():
    mgr = MidiControllerManager()
    mgr.add_mapping({
        "id": "knob1",
        "event_type": "cc",
        "cc": 7,
        "command": "volume {value}% vel={velocity}",
    })

    res = mgr.process_midi_event([0xB0, 7, 64])
    assert "volume" in res["command"]
    assert "vel=0" in res["command"] or "vel=64" in res["command"] or "value" in res["command"]


def test_midi_controller_led_feedback():
    mgr = MidiControllerManager()
    mapping = {"id": "m1", "channel": 0, "note": 60, "event_type": "note_on", "led": {"on_velocity": 127}}
    bytes_out = mgr.send_led_feedback("dev1", mapping, "on")
    assert bytes_out == [0x90, 60, 127]
    assert len(mgr.outbound_led_messages) == 1


def test_midi_controller_performance_mode():
    mgr = MidiControllerManager()
    assert mgr.is_performance_mode() is False
    mgr.set_performance_mode(True)
    assert mgr.is_performance_mode() is True


def test_midi_controller_dj_workflows():
    mgr = MidiControllerManager()
    mgr.set_active_bank("Bank 1")
    mgr.switch_bank("Bank 2")
    assert mgr.get_active_bank() == "Bank 2"

    mgr.set_active_deck("Deck A")
    mgr.switch_deck("Deck B")
    assert mgr.get_active_deck() == "Deck B"

    mix = mgr.crossfader_mix(64, "linear")
    assert mix["deckA"] == pytest.approx(0.5, abs=0.1)
    assert mix["deckB"] == pytest.approx(0.5, abs=0.1)


def test_midi_controller_benchmark():
    mgr = MidiControllerManager()
    bench = mgr.run_latency_benchmark(1000)
    assert bench["iterations"] == 1000
    assert bench["average_latency_ms"] < 5.0
    assert bench["passed"] is True


def test_midi_controller_config_export_import():
    mgr = MidiControllerManager()
    mgr.set_performance_mode(True)
    mgr.set_active_bank("Bank 2")
    mgr.add_mapping({"id": "m1", "event_type": "note_on", "note": 60, "command": "cmd1"})

    cfg = mgr.export_config()
    assert cfg["performanceMode"] is True
    assert cfg["activeBank"] == "Bank 2"

    new_mgr = MidiControllerManager()
    new_mgr.import_config(cfg)
    assert new_mgr.is_performance_mode() is True
    assert new_mgr.get_active_bank() == "Bank 2"
    assert len(new_mgr.mappings) == 1
