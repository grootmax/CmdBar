#!/usr/bin/env python3
"""
MIDI Controller Manager for CmdBar Python Companion App.
Provides hardware controller support: button mappings, LED feedback, value sliders,
performance mode, and DJ/producer workflows.
"""

import time
import math
import random
import json

HARDWARE_PROFILES = {
    "launchpad": {
        "name": "Novation Launchpad",
        "type": "pad_matrix",
        "banks": ["Bank 1", "Bank 2", "Bank 3", "Bank 4"],
        "pads": {"note_start": 0, "note_end": 63},
        "scene_buttons": {"cc_start": 104, "cc_end": 111},
        "led_colors": {"off": 0, "green": 60, "amber": 62, "red": 15, "bright_green": 127},
    },
    "lpd8": {
        "name": "Akai LPD8",
        "type": "pads_and_knobs",
        "banks": ["Bank A", "Bank B", "Bank C", "Bank D"],
        "pads": {"note_start": 36, "note_end": 43},
        "knobs": {"cc_start": 1, "cc_end": 8},
        "led_colors": {"off": 0, "on": 127, "active": 64},
    },
    "nanokontrol2": {
        "name": "Korg nanoKONTROL2",
        "type": "faders_and_buttons",
        "banks": ["Mixer", "FX", "Transport"],
        "faders": {"cc_start": 0, "cc_end": 7},
        "knobs": {"cc_start": 16, "cc_end": 23},
        "solo_mute_rec": {"cc_start": 32, "cc_end": 55},
        "transport": {"cc_start": 41, "cc_end": 46},
        "led_colors": {"off": 0, "on": 127},
    },
    "ddj": {
        "name": "Pioneer DDJ",
        "type": "dj_controller",
        "decks": ["Deck A", "Deck B", "Deck C", "Deck D"],
        "hot_cues": {"note_start": 0, "note_end": 7},
        "crossfader": {"cc": 8},
        "volume_faders": {"cc_start": 16, "cc_end": 19},
        "eq_knobs": {"cc_start": 20, "cc_end": 31},
        "pitch_bend": {"pitch_bend": True},
        "led_colors": {"off": 0, "cue_blue": 40, "play_green": 60, "active_red": 127},
    },
    "generic": {
        "name": "Generic MIDI Controller",
        "type": "custom",
        "banks": ["Default"],
        "led_colors": {"off": 0, "on": 127},
    },
}


def parse_raw_midi_bytes(bytes_data):
    """
    Parses raw MIDI byte array/bytes into structured event dict.
    """
    if not bytes_data or len(bytes_data) < 2:
        return {
            "type": "unknown",
            "channel": 0,
            "status": 0,
            "note": None,
            "velocity": None,
            "cc": None,
            "value": None,
            "program": None,
            "raw": list(bytes_data) if bytes_data else [],
            "timestamp": time.time(),
        }

    raw = list(bytes_data)
    status = raw[0]
    command_nibble = status & 0xF0
    channel = status & 0x0F
    data1 = raw[1] if len(raw) > 1 else 0
    data2 = raw[2] if len(raw) > 2 else 0

    evt_type = "unknown"
    note = None
    velocity = None
    cc = None
    value = None
    program = None

    if command_nibble == 0x90:
        note = data1
        velocity = data2
        evt_type = "note_off" if velocity == 0 else "note_on"
    elif command_nibble == 0x80:
        evt_type = "note_off"
        note = data1
        velocity = data2
    elif command_nibble == 0xB0:
        evt_type = "cc"
        cc = data1
        value = data2
    elif command_nibble == 0xC0:
        evt_type = "program_change"
        program = data1
    elif command_nibble == 0xE0:
        evt_type = "pitch_bend"
        value = (data2 << 7) | data1

    return {
        "status": status,
        "channel": channel,
        "type": evt_type,
        "note": note,
        "velocity": velocity,
        "cc": cc,
        "value": value,
        "program": program,
        "raw": raw,
        "timestamp": time.time(),
    }


def scale_value(value, min_val=0, max_val=100, curve="linear", encoder_mode="absolute", last_value=0):
    """
    Scales raw MIDI controller value (0-127 or 0-16383) to a target numeric range.
    """
    min_v = float(min_val)
    max_v = float(max_val)

    if encoder_mode == "relative":
        delta = 0
        if 0 < value < 64:
            delta = value
        elif value >= 64:
            delta = value - 128
        step_size = (max_v - min_v) / 100.0 or 1.0
        new_val = last_value + delta * step_size
        return round(min(max_v, max(min_v, new_val)), 2)

    max_midi = 16383.0 if value > 127 else 127.0
    normalized = min(1.0, max(0.0, float(value) / max_midi))

    if curve == "exponential":
        normalized = normalized ** 2
    elif curve == "logarithmic":
        normalized = math.sqrt(normalized)

    scaled = min_v + normalized * (max_v - min_v)
    return round(scaled, 2)


def get_hardware_profile(profile_name):
    key = str(profile_name or "generic").lower()
    return HARDWARE_PROFILES.get(key, HARDWARE_PROFILES["generic"])


class MidiControllerManager:
    def __init__(self, options=None):
        options = options or {}
        self.devices = {}
        self.mappings = []
        self.active_bank = options.get("activeBank", "Bank 1")
        self.active_deck = options.get("activeDeck", "Deck A")
        self.performance_mode = bool(options.get("performanceMode", False))
        self.led_feedback_enabled = options.get("ledFeedbackEnabled", True)

        self.outbound_led_messages = []
        self.command_executor = options.get("commandExecutor", None)
        self.executed_commands = []

        self.tap_timestamps = []
        self.bpm = 120.0

        self.fader_throttle_timers = {}
        self.fader_last_values = {}
        self.toggle_states = {}

        self.stats = {
            "total_events": 0,
            "total_latency_ms": 0.0,
            "max_latency_ms": 0.0,
            "commands_executed": 0,
        }

    def register_device(self, device_info):
        if not isinstance(device_info, dict):
            raise ValueError("Device info must be a dict.")
        dev_id = device_info.get("id", f"midi_device_{len(self.devices) + 1}")
        profile_name = device_info.get("profile", "generic")
        profile = get_hardware_profile(profile_name)

        dev_obj = {
            "id": dev_id,
            "name": device_info.get("name", "Generic MIDI Device"),
            "profile": profile_name,
            "profile_details": profile,
            "connected": True,
            "registered_at": time.time(),
        }
        self.devices[dev_id] = dev_obj
        return dev_obj

    def disconnect_device(self, device_id):
        if device_id in self.devices:
            self.devices[device_id]["connected"] = False
            return True
        return False

    def get_connected_devices(self):
        return [d for d in self.devices.values() if d["connected"]]

    def get_device_details(self, device_id):
        return self.devices.get(device_id, None)

    def load_profile(self, profile_name, options=None):
        options = options or {}
        profile = get_hardware_profile(profile_name)
        new_mappings = []

        if profile["name"] == "Akai LPD8":
            for i in range(8):
                new_mappings.append({
                    "id": f"lpd8_pad_{i + 1}",
                    "device_id": options.get("deviceId", "*"),
                    "event_type": "note_on",
                    "channel": "*",
                    "note": 36 + i,
                    "mode": "trigger",
                    "command": f'echo "LPD8 Pad {i + 1} pressed velocity={{velocity}}"',
                    "bank": "Bank A",
                    "led": {"on_velocity": 127, "off_velocity": 0},
                })
            for i in range(8):
                new_mappings.append({
                    "id": f"lpd8_knob_{i + 1}",
                    "device_id": options.get("deviceId", "*"),
                    "event_type": "cc",
                    "channel": "*",
                    "cc": 1 + i,
                    "min_value": 0,
                    "max_value": 100,
                    "command": f'echo "LPD8 Knob {i + 1} set to {{value}}"',
                    "bank": "Bank A",
                    "throttle_ms": 10,
                })
        elif profile["name"] == "Pioneer DDJ":
            for deck in ["Deck A", "Deck B"]:
                for i in range(4):
                    new_mappings.append({
                        "id": f"ddj_{deck.replace(' ', '_')}_cue_{i + 1}",
                        "device_id": options.get("deviceId", "*"),
                        "event_type": "note_on",
                        "channel": 0 if deck == "Deck A" else 1,
                        "note": i,
                        "deck": deck,
                        "mode": "trigger",
                        "command": f'echo "Hot Cue {i + 1} on {deck}"',
                        "led": {"on_velocity": 40, "active_velocity": 127},
                    })
            new_mappings.append({
                "id": "ddj_crossfader",
                "device_id": options.get("deviceId", "*"),
                "event_type": "cc",
                "cc": 8,
                "action": "crossfader",
                "min_value": 0,
                "max_value": 100,
                "command": 'echo "Crossfader level: {value}"',
            })
        else:
            new_mappings.append({
                "id": "generic_btn_1",
                "device_id": "*",
                "event_type": "note_on",
                "channel": "*",
                "note": 60,
                "mode": "trigger",
                "command": 'echo "Generic Note 60 trigger"',
                "bank": "Bank 1",
            })

        for m in new_mappings:
            self.add_mapping(m)
        return new_mappings

    def add_mapping(self, mapping):
        if not isinstance(mapping, dict):
            raise ValueError("Mapping must be a dict.")

        sanitized = {
            "id": mapping.get("id", f"map_{int(time.time()*1000)}_{random.randint(100,999)}"),
            "device_id": mapping.get("device_id", "*"),
            "event_type": mapping.get("event_type", "note_on"),
            "channel": mapping.get("channel", "*"),
            "note": mapping.get("note", "*"),
            "cc": mapping.get("cc", "*"),
            "mode": mapping.get("mode", "trigger"),
            "command": mapping.get("command", ""),
            "release_command": mapping.get("release_command", ""),
            "hold_command": mapping.get("hold_command", ""),
            "hold_delay_ms": int(mapping.get("hold_delay_ms", 500)),
            "min_value": float(mapping.get("min_value", 0)),
            "max_value": float(mapping.get("max_value", 100)),
            "curve": mapping.get("curve", "linear"),
            "encoder_mode": mapping.get("encoder_mode", "absolute"),
            "throttle_ms": float(mapping.get("throttle_ms", 0)),
            "bank": mapping.get("bank", None),
            "deck": mapping.get("deck", None),
            "action": mapping.get("action", None),
            "target_bank": mapping.get("target_bank", None),
            "target_deck": mapping.get("target_deck", None),
            "led": mapping.get("led", {"on_velocity": 127, "off_velocity": 0, "active_velocity": 60}),
        }

        existing_idx = next((i for i, m in enumerate(self.mappings) if m["id"] == sanitized["id"]), -1)
        if existing_idx >= 0:
            self.mappings[existing_idx] = sanitized
        else:
            self.mappings.append(sanitized)

        return sanitized

    def remove_mapping(self, mapping_id):
        init_len = len(self.mappings)
        self.mappings = [m for m in self.mappings if m["id"] != mapping_id]
        return len(self.mappings) < init_len

    def get_mappings(self, filter_opts=None):
        filter_opts = filter_opts or {}
        res = []
        for m in self.mappings:
            if filter_opts.get("bank") and m.get("bank") and m.get("bank") != "*" and m.get("bank") != filter_opts["bank"]:
                continue
            if filter_opts.get("deck") and m.get("deck") and m.get("deck") != "*" and m.get("deck") != filter_opts["deck"]:
                continue
            if filter_opts.get("event_type") and m.get("event_type") != filter_opts["event_type"]:
                continue
            if filter_opts.get("device_id") and m.get("device_id") != "*" and m.get("device_id") != filter_opts["device_id"]:
                continue
            res.append(m)
        return res

    def clear_mappings(self):
        self.mappings = []

    def set_command_executor(self, executor):
        self.command_executor = executor

    def set_performance_mode(self, enabled):
        self.performance_mode = bool(enabled)

    def is_performance_mode(self):
        return self.performance_mode

    def set_active_bank(self, bank):
        self.active_bank = bank

    def get_active_bank(self):
        return self.active_bank

    def set_active_deck(self, deck):
        self.active_deck = deck

    def get_active_deck(self):
        return self.active_deck

    def switch_bank(self, bank):
        self.set_active_bank(bank)
        return self.get_mappings({"bank": self.active_bank})

    def switch_deck(self, deck):
        self.set_active_deck(deck)
        return self.get_mappings({"deck": self.active_deck})

    def crossfader_mix(self, cc_value, curve="linear"):
        normalized = min(1.0, max(0.0, float(cc_value) / 127.0))
        if curve == "scratch":
            return {"deckA": 0 if normalized > 0.9 else 1, "deckB": 0 if normalized < 0.1 else 1}
        elif curve == "constant_power":
            angle = normalized * (math.pi / 2.0)
            return {"deckA": round(math.cos(angle), 2), "deckB": round(math.sin(angle), 2)}
        return {"deckA": round(1.0 - normalized, 2), "deckB": round(normalized, 2)}

    def tap_tempo(self):
        now = time.time()
        self.tap_timestamps.append(now)
        if len(self.tap_timestamps) > 5:
            self.tap_timestamps.pop(0)

        if len(self.tap_timestamps) >= 2:
            intervals = [self.tap_timestamps[i] - self.tap_timestamps[i - 1] for i in range(1, len(self.tap_timestamps))]
            avg_interval = sum(intervals) / len(intervals)
            if avg_interval > 0:
                self.bpm = round(60.0 / avg_interval, 1)
                return {"bpm": self.bpm, "intervalMs": avg_interval * 1000.0}

        return {"bpm": self.bpm, "intervalMs": 0.0}

    def send_led_feedback(self, device_id, mapping, state):
        if not self.led_feedback_enabled:
            return None

        channel = mapping.get("channel", 0)
        if channel == "*":
            channel = 0
        note_or_cc = mapping.get("note") if mapping.get("note") not in ["*", None] else mapping.get("cc", 0)
        if note_or_cc == "*":
            note_or_cc = 0

        led_cfg = mapping.get("led", {})
        if state in ["on", "success"]:
            velocity = led_cfg.get("on_velocity", 127)
        elif state in ["active", "running"]:
            velocity = led_cfg.get("active_velocity", 60)
        elif state == "error":
            velocity = led_cfg.get("error_velocity", 15)
        elif state == "toggled":
            velocity = led_cfg.get("toggled_velocity", 127)
        else:
            velocity = led_cfg.get("off_velocity", 0)

        status_byte = (0xB0 if mapping.get("event_type") == "cc" else 0x90) | int(channel)
        bytes_out = [status_byte, int(note_or_cc), int(velocity)]

        self.outbound_led_messages.append({
            "device_id": device_id,
            "mapping_id": mapping.get("id"),
            "state": state,
            "bytes": bytes_out,
            "timestamp": time.time(),
        })

        return bytes_out

    def process_midi_event(self, event_or_bytes, device_id="default"):
        start_time = time.time()

        if isinstance(event_or_bytes, (list, bytes, bytearray)):
            event = parse_raw_midi_bytes(event_or_bytes)
        else:
            event = event_or_bytes

        self.stats["total_events"] += 1

        matching = []
        for m in self.mappings:
            if m.get("device_id") != "*" and m.get("device_id") != device_id:
                continue
            if m.get("bank") not in [None, "*"] and m.get("bank") != self.active_bank:
                continue
            if m.get("deck") not in [None, "*"] and m.get("deck") != self.active_deck:
                continue
            is_note_match = (m.get("event_type") in ["note_on", "note_off"]) and (event["type"] in ["note_on", "note_off"])
            if m.get("event_type") != event["type"] and not is_note_match:
                continue
            if m.get("channel") != "*" and m.get("channel") != event["channel"]:
                continue
            if event["type"] in ["note_on", "note_off"]:
                if m.get("note") != "*" and m.get("note") != event["note"]:
                    continue
            if event["type"] == "cc":
                if m.get("cc") != "*" and m.get("cc") != event["cc"]:
                    continue
            matching.append(m)

        if not matching:
            elapsed = (time.time() - start_time) * 1000.0
            self._record_latency(elapsed)
            return {"executed": False, "command": None, "result": None, "latency_ms": elapsed}

        last_result = None
        executed_cmd = None
        scaled_val = event.get("value")

        for mapping in matching:
            cmd_to_run = None

            if mapping.get("action") == "switch_bank":
                new_bank = mapping.get("target_bank", "Bank 2" if self.active_bank == "Bank 1" else "Bank 1")
                self.switch_bank(new_bank)
                self.send_led_feedback(device_id, mapping, "on")
                cmd_to_run = f'echo "Switched bank to {new_bank}"'
            elif mapping.get("action") == "switch_deck":
                new_deck = mapping.get("target_deck", "Deck B" if self.active_deck == "Deck A" else "Deck A")
                self.switch_deck(new_deck)
                self.send_led_feedback(device_id, mapping, "on")
                cmd_to_run = f'echo "Switched deck to {new_deck}"'
            elif mapping.get("action") == "tap_tempo":
                tap_res = self.tap_tempo()
                cmd_to_run = f'echo "Tap Tempo BPM set to {tap_res["bpm"]}"'
            elif mapping.get("action") == "crossfader" or event["type"] in ["cc", "pitch_bend"]:
                last_v = self.fader_last_values.get(mapping["id"], 0)
                raw_v = event.get("value") if event.get("value") is not None else event.get("velocity", 0)
                scaled_val = scale_value(raw_v, mapping["min_value"], mapping["max_value"], mapping["curve"], mapping["encoder_mode"], last_v)
                self.fader_last_values[mapping["id"]] = scaled_val

                if mapping.get("throttle_ms", 0) > 0:
                    last_t = self.fader_throttle_timers.get(mapping["id"], 0)
                    if (time.time() - last_t) * 1000.0 < mapping["throttle_ms"]:
                        continue
                    self.fader_throttle_timers[mapping["id"]] = time.time()

                cmd_to_run = mapping.get("command")
            elif mapping.get("mode") == "toggle":
                if event["type"] == "note_on" or (event["type"] == "cc" and event.get("value", 0) > 0):
                    curr = bool(self.toggle_states.get(mapping["id"], False))
                    new_st = not curr
                    self.toggle_states[mapping["id"]] = new_st
                    self.send_led_feedback(device_id, mapping, "toggled" if new_st else "off")
                    cmd_to_run = mapping.get("command") if new_st else (mapping.get("release_command") or mapping.get("command"))
            elif mapping.get("mode") == "momentary":
                if event["type"] == "note_on" or (event["type"] == "cc" and event.get("value", 0) > 0):
                    cmd_to_run = mapping.get("command")
                    self.send_led_feedback(device_id, mapping, "on")
                elif event["type"] == "note_off" or (event["type"] == "cc" and event.get("value", 0) == 0):
                    cmd_to_run = mapping.get("release_command")
                    self.send_led_feedback(device_id, mapping, "off")
            else:
                if event["type"] == "note_on" or (event["type"] == "cc" and event.get("value", 0) > 0):
                    cmd_to_run = mapping.get("command")
                    self.send_led_feedback(device_id, mapping, "active")

            if cmd_to_run:
                norm_val = (event.get("value") if event.get("value") is not None else event.get("velocity", 0)) / 127.0
                percent_val = int(norm_val * 100)
                eff_vel = event.get("velocity") if event.get("velocity") is not None else (event.get("value") if event.get("value") is not None else 0)

                cmd_to_run = (
                    cmd_to_run.replace("{value}", str(scaled_val))
                    .replace("{velocity}", str(eff_vel))
                    .replace("{cc}", str(event.get("cc", 0) or 0))
                    .replace("{note}", str(event.get("note", 0) or 0))
                    .replace("{channel}", str(event.get("channel", 0)))
                    .replace("{percent}", str(percent_val))
                    .replace("{normalized}", str(round(norm_val, 2)))
                    .replace("{bpm}", str(self.bpm))
                    .replace("{bank}", str(self.active_bank))
                    .replace("{deck}", str(self.active_deck))
                )

                executed_cmd = cmd_to_run
                self.send_led_feedback(device_id, mapping, "active")

                if self.command_executor:
                    last_result = self.command_executor(cmd_to_run, {
                        "performance_mode": self.performance_mode,
                        "mapping": mapping,
                        "event": event,
                    })
                else:
                    last_result = {"status": "mock_executed", "command": cmd_to_run}

                self.send_led_feedback(device_id, mapping, "success")
                self.stats["commands_executed"] += 1
                self.executed_commands.append({
                    "command": cmd_to_run,
                    "timestamp": time.time(),
                    "mode": mapping.get("mode"),
                    "device_id": device_id,
                })

        elapsed = (time.time() - start_time) * 1000.0
        self._record_latency(elapsed)

        return {
            "executed": bool(executed_cmd),
            "command": executed_cmd,
            "value": scaled_val,
            "result": last_result,
            "latency_ms": elapsed,
        }

    def _record_latency(self, latency_ms):
        self.stats["total_latency_ms"] += latency_ms
        if latency_ms > self.stats["max_latency_ms"]:
            self.stats["max_latency_ms"] = latency_ms

    def get_performance_stats(self):
        avg_lat = (self.stats["total_latency_ms"] / self.stats["total_events"]) if self.stats["total_events"] > 0 else 0.0
        return {
            "total_events": self.stats["total_events"],
            "average_latency_ms": round(avg_lat, 2),
            "max_latency_ms": round(self.stats["max_latency_ms"], 2),
            "commands_executed": self.stats["commands_executed"],
            "performance_mode": self.performance_mode,
        }

    def run_latency_benchmark(self, iterations=1000):
        start_t = time.perf_counter()
        for i in range(iterations):
            raw = [0x90, 36 + (i % 8), 100 if i % 2 == 0 else 0]
            parse_raw_midi_bytes(raw)
            scale_value(i % 128, 0, 100, "linear", "absolute")
        end_t = time.perf_counter()
        total_time_ms = (end_t - start_t) * 1000.0
        avg_lat = total_time_ms / iterations
        return {
            "iterations": iterations,
            "total_time_ms": round(total_time_ms, 2),
            "average_latency_ms": round(avg_lat, 4),
            "passed": avg_lat < 5.0,
        }

    def export_config(self):
        return {
            "activeBank": self.active_bank,
            "activeDeck": self.active_deck,
            "performanceMode": self.performance_mode,
            "ledFeedbackEnabled": self.led_feedback_enabled,
            "bpm": self.bpm,
            "mappings": self.mappings,
        }

    def import_config(self, config_data):
        if not isinstance(config_data, dict):
            return
        if "activeBank" in config_data:
            self.set_active_bank(config_data["activeBank"])
        if "activeDeck" in config_data:
            self.set_active_deck(config_data["activeDeck"])
        if "performanceMode" in config_data:
            self.set_performance_mode(config_data["performanceMode"])
        if "ledFeedbackEnabled" in config_data:
            self.led_feedback_enabled = bool(config_data["ledFeedbackEnabled"])
        if "bpm" in config_data:
            self.bpm = float(config_data["bpm"])
        if isinstance(config_data.get("mappings"), list):
            self.clear_mappings()
            for m in config_data["mappings"]:
                self.add_mapping(m)
