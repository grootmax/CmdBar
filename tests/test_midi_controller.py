import unittest
import time
import json
from companion.midi_controller import MidiControllerManager
from companion.dbus_service import CmdBarDBusService
from companion.dbus_client import CmdBarDBusClient


class TestMidiControllerManager(unittest.TestCase):
    def setUp(self):
        self.executed_commands = []
        self.led_feedbacks = []
        self.bank_changes = []
        self.perf_changes = []

        self.controller = MidiControllerManager()
        self.controller.set_callbacks(
            on_execute=lambda name, cmd_str, meta: self.executed_commands.append((name, cmd_str, meta)),
            on_led_feedback=lambda data: self.led_feedbacks.append(data),
            on_bank_changed=lambda bank: self.bank_changes.append(bank),
            on_performance_mode_changed=lambda enabled: self.perf_changes.append(enabled),
        )

    def test_initialization_and_config(self):
        cfg = self.controller.get_config()
        self.assertTrue(cfg["enabled"])
        self.assertFalse(cfg["performance_mode"])
        self.assertEqual(cfg["active_bank"], "Bank A")
        self.assertIsInstance(cfg["mappings"], list)
        self.assertGreater(len(cfg["mappings"]), 0)

    def test_update_config(self):
        self.controller.update_config({
            "midi": {
                "enabled": True,
                "performance_mode": True,
                "active_bank": "Bank B",
                "throttle_ms": 25,
                "mappings": []
            }
        })
        cfg = self.controller.get_config()
        self.assertTrue(cfg["performance_mode"])
        self.assertEqual(cfg["active_bank"], "Bank B")
        self.assertIn("Bank B", self.bank_changes)
        self.assertIn(True, self.perf_changes)

    def test_parse_raw_bytes(self):
        note_on = self.controller.parse_raw_bytes([0x90, 60, 100])
        self.assertEqual(note_on["type"], "note_on")
        self.assertEqual(note_on["channel"], 1)
        self.assertEqual(note_on["number"], 60)
        self.assertEqual(note_on["value"], 100)

        note_off = self.controller.parse_raw_bytes([0x90, 60, 0])
        self.assertEqual(note_off["type"], "note_off")

        cc = self.controller.parse_raw_bytes([0xB0, 7, 127])
        self.assertEqual(cc["type"], "cc")

        self.assertIsNone(self.controller.parse_raw_bytes(None))
        self.assertIsNone(self.controller.parse_raw_bytes([0x90]))

    def test_button_toggle_mode(self):
        # Deck A Play/Pause (note 60, ch 1)
        res1 = self.controller.process_midi_message("note_on", 1, 60, 127)
        self.assertTrue(res1["handled"])
        self.assertEqual(len(self.executed_commands), 1)
        self.assertEqual(self.executed_commands[0][1], "playerctl play-pause")
        self.assertEqual(self.led_feedbacks[0]["value"], 127)

        # Toggle OFF
        res2 = self.controller.process_midi_message("note_on", 1, 60, 127)
        self.assertTrue(res2["handled"])
        self.assertEqual(self.led_feedbacks[1]["value"], 0)

    def test_button_momentary_mode(self):
        # Deck A Cue Point (note 61, ch 1)
        # Press
        self.controller.process_midi_message("note_on", 1, 61, 127)
        self.assertEqual(self.executed_commands[0][1], "echo Cue Deck A")
        self.assertEqual(self.led_feedbacks[0]["value"], 127)

        # Release
        self.controller.process_midi_message("note_off", 1, 61, 0)
        self.assertEqual(self.executed_commands[1][1], "echo Release Cue Deck A")
        self.assertEqual(self.led_feedbacks[1]["value"], 0)

    def test_value_slider_scaling_and_substitution(self):
        self.assertEqual(self.controller.scale_slider_value(0, 0, 100), 0)
        self.assertEqual(self.controller.scale_slider_value(127, 0, 100), 100)
        self.assertEqual(self.controller.scale_slider_value(63, 0.0, 1.0), 0.5)

        # Master Volume Slider (CC 7, ch 1)
        res = self.controller.process_midi_message("cc", 1, 7, 95)
        self.assertTrue(res["handled"])
        self.assertEqual(self.executed_commands[0][1], "amixer set Master 75%")

    def test_bank_switching_and_led_dump(self):
        # Switch to Bank B via mapping (note 64, ch 1)
        self.controller.process_midi_message("note_on", 1, 64, 127)
        self.assertEqual(self.controller.get_config()["active_bank"], "Bank B")

        dump = self.controller.dump_bank_led_states()
        self.assertIsInstance(dump, list)
        self.assertGreater(len(dump), 0)

        banks = self.controller.get_bank_names()
        self.assertIn("Bank A", banks)
        self.assertIn("Bank B", banks)

    def test_dbus_service_and_client_integration(self):
        service = CmdBarDBusService()
        client = CmdBarDBusClient(service=service)

        # Performance mode via D-Bus client
        ok = client.set_midi_performance_mode(True)
        self.assertTrue(ok)
        self.assertTrue(service.midi_controller.get_config()["performance_mode"])

        # Switch bank via D-Bus client
        ok_bank = client.switch_midi_bank("Bank B")
        self.assertTrue(ok_bank)
        self.assertEqual(service.midi_controller.get_config()["active_bank"], "Bank B")

        # Get MIDI mappings via D-Bus client
        mappings = client.get_midi_mappings()
        self.assertIsInstance(mappings, list)
        self.assertGreater(len(mappings), 0)

        # Process MIDI message via D-Bus client
        res = client.process_midi_message("note_on", 1, 65, 127)
        self.assertIn("handled", res)


if __name__ == "__main__":
    unittest.main()
