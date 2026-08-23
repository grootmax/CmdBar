"""
MIDI Controller Support Module for CmdBar Python Companion.
Provides button mappings, LED feedback, value sliders, performance mode, and DJ/producer workflows.
"""

import time
import math


class MidiControllerManager:
    def __init__(self, config=None):
        self._config = self._normalize_config(config or {})
        self._states = {}  # mapping_id -> toggle boolean state
        self._slider_values = {}  # mapping_id -> current scaled value
        self._last_throttle_times = {}  # mapping_id -> timestamp float
        self._on_execute_callback = None
        self._on_led_feedback_callback = None
        self._on_bank_changed_callback = None
        self._on_performance_mode_changed_callback = None

    def _normalize_config(self, config):
        midi = config.get("midi", {}) if isinstance(config, dict) else {}
        return {
            "enabled": midi.get("enabled", True),
            "performance_mode": bool(midi.get("performance_mode", False)),
            "active_bank": midi.get("active_bank", "Bank A"),
            "throttle_ms": midi.get("throttle_ms", 50),
            "led_feedback": midi.get("led_feedback", True),
            "mappings": midi.get("mappings") if isinstance(midi.get("mappings"), list) else self.get_default_mappings(),
        }

    def update_config(self, config):
        old_bank = self._config["active_bank"]
        old_perf = self._config["performance_mode"]
        self._config = self._normalize_config(config)

        if old_bank != self._config["active_bank"] and self._on_bank_changed_callback:
            self._on_bank_changed_callback(self._config["active_bank"])
        if old_perf != self._config["performance_mode"] and self._on_performance_mode_changed_callback:
            self._on_performance_mode_changed_callback(self._config["performance_mode"])

    def set_callbacks(self, on_execute=None, on_led_feedback=None, on_bank_changed=None, on_performance_mode_changed=None):
        if on_execute:
            self._on_execute_callback = on_execute
        if on_led_feedback:
            self._on_led_feedback_callback = on_led_feedback
        if on_bank_changed:
            self._on_bank_changed_callback = on_bank_changed
        if on_performance_mode_changed:
            self._on_performance_mode_changed_callback = on_performance_mode_changed

    def get_default_mappings(self):
        return [
            {
                "id": "dj_deck_a_play",
                "name": "Deck A Play/Pause",
                "bank": "Bank A",
                "type": "note",
                "channel": 1,
                "number": 60,
                "mode": "toggle",
                "action": "execute_command",
                "command": "playerctl play-pause",
                "led_on_value": 127,
                "led_off_value": 0,
            },
            {
                "id": "dj_deck_a_cue",
                "name": "Deck A Cue Point 1",
                "bank": "Bank A",
                "type": "note",
                "channel": 1,
                "number": 61,
                "mode": "momentary",
                "action": "execute_command",
                "command": "echo Cue Deck A",
                "release_command": "echo Release Cue Deck A",
                "led_on_value": 127,
                "led_off_value": 0,
            },
            {
                "id": "dj_volume_fader",
                "name": "Master Volume Slider",
                "bank": "Bank A",
                "type": "cc",
                "channel": 1,
                "number": 7,
                "mode": "trigger",
                "action": "parameter_slider",
                "command": "amixer set Master <value>%",
                "min_value": 0,
                "max_value": 100,
                "led_on_value": 127,
                "led_off_value": 0,
            },
            {
                "id": "switch_bank_b",
                "name": "Switch to Bank B",
                "bank": "Global",
                "type": "note",
                "channel": 1,
                "number": 64,
                "mode": "trigger",
                "action": "switch_bank",
                "target_bank": "Bank B",
                "led_on_value": 127,
                "led_off_value": 0,
            },
            {
                "id": "toggle_performance_mode",
                "name": "Toggle Performance Mode",
                "bank": "Global",
                "type": "note",
                "channel": 1,
                "number": 65,
                "mode": "trigger",
                "action": "toggle_performance_mode",
                "led_on_value": 127,
                "led_off_value": 0,
            },
        ]

    def parse_raw_bytes(self, bytes_data):
        if not bytes_data or len(bytes_data) < 2:
            return None
        status = bytes_data[0]
        data1 = bytes_data[1]
        data2 = bytes_data[2] if len(bytes_data) > 2 else 0

        channel = (status & 0x0F) + 1
        msg_type_num = status & 0xF0

        msg_type = "unknown"
        if msg_type_num == 0x90:
            msg_type = "note_on" if data2 > 0 else "note_off"
        elif msg_type_num == 0x80:
            msg_type = "note_off"
        elif msg_type_num == 0xB0:
            msg_type = "cc"
        elif msg_type_num == 0xC0:
            msg_type = "program_change"
        elif msg_type_num == 0xE0:
            msg_type = "pitch_bend"

        return {"type": msg_type, "channel": channel, "number": data1, "value": data2, "raw": bytes_data}

    def find_matching_mappings(self, msg_type, channel, number):
        if not self._config["enabled"]:
            return []

        norm_type = "note" if msg_type in ("note_on", "note_off") else msg_type

        matches = []
        for m in self._config["mappings"]:
            bank = m.get("bank")
            if bank and bank != "Global" and bank != self._config["active_bank"]:
                continue
            if m.get("type") != norm_type:
                continue
            ch = m.get("channel")
            if ch and ch != 0 and ch != channel:
                continue
            num = m.get("number")
            if num is not None and num != number:
                continue
            matches.append(m)

        return matches

    def scale_slider_value(self, raw_value, min_val=0, max_val=100):
        clamped_raw = max(0, min(127, raw_value))
        normalized = clamped_raw / 127.0
        scaled = min_val + normalized * (max_val - min_val)
        if isinstance(min_val, int) and isinstance(max_val, int) and abs(max_val - min_val) > 1:
            return int(round(scaled))
        return round(scaled, 2)

    def process_midi_message(self, msg_type, channel, number, value, custom_execute_fn=None):
        if not self._config["enabled"]:
            return {"handled": False, "reason": "MIDI disabled"}

        matches = self.find_matching_mappings(msg_type, channel, number)
        if not matches:
            return {"handled": False, "reason": "No matching mapping"}

        now = time.time()
        effective_throttle = (
            min(0.015, self._config["throttle_ms"] / 1000.0)
            if self._config["performance_mode"]
            else self._config["throttle_ms"] / 1000.0
        )

        results = []

        for mapping in matches:
            mapping_id = mapping.get("id") or f"{mapping.get('type')}_{mapping.get('channel')}_{mapping.get('number')}"
            is_press = msg_type == "note_on" or (msg_type == "cc" and value > 0)
            is_release = msg_type == "note_off" or (msg_type == "cc" and value == 0)

            if mapping.get("action") == "parameter_slider" or mapping.get("type") == "cc":
                last_time = self._last_throttle_times.get(mapping_id, 0)
                if (now - last_time < effective_throttle) and value not in (0, 127):
                    continue
                self._last_throttle_times[mapping_id] = now

            executed_action = None
            executed_command = None
            led_feedback = None

            if mapping.get("action") == "parameter_slider":
                min_val = mapping.get("min_value", 0)
                max_val = mapping.get("max_value", 100)
                scaled_val = self.scale_slider_value(value, min_val, max_val)
                self._slider_values[mapping_id] = scaled_val

                cmd_tmpl = mapping.get("command")
                if cmd_tmpl:
                    executed_command = (
                        cmd_tmpl.replace("<value>", str(scaled_val))
                        .replace("<slider_val>", str(scaled_val))
                        .replace("{value}", str(scaled_val))
                        .replace("{val}", str(scaled_val))
                    )
                    executed_action = "parameter_slider"
                    self._dispatch_execution(
                        mapping.get("name") or mapping_id,
                        executed_command,
                        {"value": scaled_val},
                        custom_execute_fn,
                    )

                if self._config["led_feedback"]:
                    led_feedback = {
                        "type": "note_on" if mapping.get("type") == "note" else "cc",
                        "channel": mapping.get("channel") or channel,
                        "number": mapping.get("number"),
                        "value": value,
                    }
                    self._send_led_feedback(led_feedback)

            elif mapping.get("action") == "switch_bank":
                if is_press:
                    target_bank = mapping.get("target_bank", "Bank A")
                    self.switch_bank(target_bank)
                    executed_action = "switch_bank"

            elif mapping.get("action") == "toggle_performance_mode":
                if is_press:
                    self.set_performance_mode(not self._config["performance_mode"])
                    executed_action = "toggle_performance_mode"

            elif mapping.get("action") == "toggle_state":
                if is_press:
                    current_state = bool(self._states.get(mapping_id, False))
                    new_state = not current_state
                    self._states[mapping_id] = new_state

                    cmd = mapping.get("command") if new_state else mapping.get("off_command")
                    if cmd:
                        executed_command = cmd
                        self._dispatch_execution(
                            mapping.get("name") or mapping_id,
                            executed_command,
                            {"state": new_state},
                            custom_execute_fn,
                        )

                    executed_action = "toggle_state"
                    if self._config["led_feedback"]:
                        led_val = (
                            mapping.get("led_on_value", 127) if new_state else mapping.get("led_off_value", 0)
                        )
                        led_feedback = {
                            "type": "note_on" if mapping.get("type") == "note" else "cc",
                            "channel": mapping.get("channel") or channel,
                            "number": mapping.get("number"),
                            "value": led_val,
                        }
                        self._send_led_feedback(led_feedback)

            else:
                mode = mapping.get("mode", "trigger")
                if mode == "momentary":
                    if is_press and mapping.get("command"):
                        executed_command = mapping.get("command")
                        executed_action = "momentary_press"
                        self._dispatch_execution(
                            mapping.get("name") or mapping_id,
                            executed_command,
                            {"event": "press"},
                            custom_execute_fn,
                        )
                        if self._config["led_feedback"]:
                            led_feedback = {
                                "type": "note_on" if mapping.get("type") == "note" else "cc",
                                "channel": mapping.get("channel") or channel,
                                "number": mapping.get("number"),
                                "value": mapping.get("led_on_value", 127),
                            }
                            self._send_led_feedback(led_feedback)
                    elif is_release:
                        if mapping.get("release_command"):
                            executed_command = mapping.get("release_command")
                            executed_action = "momentary_release"
                            self._dispatch_execution(
                                mapping.get("name") or mapping_id,
                                executed_command,
                                {"event": "release"},
                                custom_execute_fn,
                            )
                        if self._config["led_feedback"]:
                            led_feedback = {
                                "type": "note_on" if mapping.get("type") == "note" else "cc",
                                "channel": mapping.get("channel") or channel,
                                "number": mapping.get("number"),
                                "value": mapping.get("led_off_value", 0),
                            }
                            self._send_led_feedback(led_feedback)
                elif mode == "toggle":
                    if is_press:
                        current_state = bool(self._states.get(mapping_id, False))
                        new_state = not current_state
                        self._states[mapping_id] = new_state

                        if mapping.get("command"):
                            executed_command = mapping.get("command")
                            executed_action = "toggle"
                            self._dispatch_execution(
                                mapping.get("name") or mapping_id,
                                executed_command,
                                {"state": new_state},
                                custom_execute_fn,
                            )

                        if self._config["led_feedback"]:
                            led_val = (
                                mapping.get("led_on_value", 127) if new_state else mapping.get("led_off_value", 0)
                            )
                            led_feedback = {
                                "type": "note_on" if mapping.get("type") == "note" else "cc",
                                "channel": mapping.get("channel") or channel,
                                "number": mapping.get("number"),
                                "value": led_val,
                            }
                            self._send_led_feedback(led_feedback)
                else:
                    # trigger mode
                    if is_press and mapping.get("command"):
                        executed_command = mapping.get("command")
                        executed_action = "trigger"
                        self._dispatch_execution(
                            mapping.get("name") or mapping_id,
                            executed_command,
                            {},
                            custom_execute_fn,
                        )
                        if self._config["led_feedback"]:
                            led_feedback = {
                                "type": "note_on" if mapping.get("type") == "note" else "cc",
                                "channel": mapping.get("channel") or channel,
                                "number": mapping.get("number"),
                                "value": mapping.get("led_on_value", 127),
                            }
                            self._send_led_feedback(led_feedback)

            results.append({
                "mapping_id": mapping_id,
                "mapping_name": mapping.get("name"),
                "action": executed_action,
                "command": executed_command,
                "led_feedback": led_feedback,
            })

        return {
            "handled": True,
            "bank": self._config["active_bank"],
            "performance_mode": self._config["performance_mode"],
            "results": results,
        }

    def _dispatch_execution(self, name, command_str, metadata, custom_execute_fn):
        if custom_execute_fn and callable(custom_execute_fn):
            custom_execute_fn(name, command_str, metadata)
        elif self._on_execute_callback:
            self._on_execute_callback(name, command_str, metadata)

    def _send_led_feedback(self, led_data):
        if self._on_led_feedback_callback:
            self._on_led_feedback_callback(led_data)

    def switch_bank(self, bank_name):
        if not bank_name or not isinstance(bank_name, str):
            return False
        self._config["active_bank"] = bank_name

        if self._on_bank_changed_callback:
            self._on_bank_changed_callback(bank_name)

        if self._config["led_feedback"]:
            for msg in self.dump_bank_led_states():
                self._send_led_feedback(msg)
        return True

    def set_performance_mode(self, enabled):
        self._config["performance_mode"] = bool(enabled)
        if self._on_performance_mode_changed_callback:
            self._on_performance_mode_changed_callback(self._config["performance_mode"])
        return True

    def dump_bank_led_states(self):
        feedback_msgs = []
        if not self._config["enabled"] or not self._config["led_feedback"]:
            return feedback_msgs

        active_mappings = [
            m for m in self._config["mappings"]
            if m.get("bank") in ("Global", self._config["active_bank"])
        ]

        for m in active_mappings:
            mapping_id = m.get("id") or f"{m.get('type')}_{m.get('channel')}_{m.get('number')}"
            state = bool(self._states.get(mapping_id, False))
            led_val = m.get("led_off_value", 0)

            if m.get("action") == "switch_bank":
                if m.get("target_bank") == self._config["active_bank"]:
                    led_val = m.get("led_on_value", 127)
            elif m.get("action") == "toggle_performance_mode":
                if self._config["performance_mode"]:
                    led_val = m.get("led_on_value", 127)
            elif state:
                led_val = m.get("led_on_value", 127)

            feedback_msgs.append({
                "type": "note_on" if m.get("type") == "note" else "cc",
                "channel": m.get("channel", 1),
                "number": m.get("number"),
                "value": led_val,
            })

        return feedback_msgs

    def get_bank_names(self):
        banks = {"Bank A", "Bank B"}
        for m in self._config.get("mappings", []):
            b = m.get("bank")
            if b and b != "Global":
                banks.add(b)
        return list(banks)

    def get_mapping_state(self, mapping_id):
        return bool(self._states.get(mapping_id, False))

    def get_slider_value(self, mapping_id):
        return self._slider_values.get(mapping_id)

    def get_config(self):
        return dict(self._config)
