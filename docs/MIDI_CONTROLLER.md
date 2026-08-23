# MIDI Controller Support

CmdBar includes full **MIDI Controller Support** for triggering commands, adjusting parameters in real-time, receiving LED state feedback, and switching performance banks. Designed for hardware power users, DJs, music producers, and live performers.

---

## Features

- **Button Mappings**: Map physical MIDI buttons, pads, or keys to shell commands, scripts, or D-Bus actions.
- **Button Trigger Modes**:
  - `trigger`: Single execution on button press.
  - `momentary`: Execute press action when button is held down, and release action when button is released.
  - `toggle`: Toggle internal ON/OFF state on button press with separate on/off actions.
- **LED Feedback**: Send outgoing MIDI messages (Note On velocity or CC value) back to hardware controllers to light up buttons, pads, or indicators according to active state or bank.
- **Value Sliders & Continuous CC Knobs**: Map faders, sliders, and rotary knobs to dynamic command variables (`<value>`, `<slider_val>`, `{val}`). Automatically scales raw 0-127 MIDI values to custom integer or float ranges (e.g., 0-100%, 0.0-1.0).
- **Throttling & Debouncing**: Continuous fader movements are intelligently debounced and throttled to prevent subprocess spawning overhead.
- **Performance Mode (DJ/Producer Workflows)**: Low-latency performance mode designed for live sets. Bypasses modal confirmation dialogs for instantaneous execution, tunes throttling down to 15ms, and synchronizes controller LEDs instantly on bank switch.
- **Bank & Scene Profiles**: Organize mappings into banks (e.g. "Bank A", "Bank B", "Global"). Switch active banks on-the-fly via MIDI buttons or D-Bus calls.

---

## Configuration Schema

MIDI mappings are configured under the `"midi"` top-level key in `~/.config/cmdbar/config.json`:

```json
{
  "midi": {
    "enabled": true,
    "performance_mode": false,
    "active_bank": "Bank A",
    "throttle_ms": 50,
    "led_feedback": true,
    "mappings": [
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
        "led_off_value": 0
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
        "led_off_value": 0
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
        "led_off_value": 0
      }
    ]
  }
}
```

---

## D-Bus API for MIDI Integration

Applications, MIDI daemons (like `rtmidi` or ALSA/JACK bridges), and scripts can communicate with CmdBar's MIDI engine over D-Bus under `org.gnome.CmdBar`.

### Methods

| Method | Parameters | Return | Description |
|--------|------------|--------|-------------|
| `ProcessMidiMessage` | `string type, int32 channel, int32 number, int32 value` | `string` (JSON) | Process incoming MIDI event (`note_on`, `note_off`, `cc`) and trigger actions |
| `SetMidiPerformanceMode` | `boolean enabled` | `boolean` | Enable or disable low-latency performance mode |
| `SwitchMidiBank` | `string bank` | `boolean` | Switch active MIDI bank profile |
| `GetMidiMappings` | *None* | `string` (JSON) | Get list of configured MIDI mappings |
| `SetMidiLedFeedback` | `boolean enabled` | `boolean` | Toggle LED feedback state |

### Signals

| Signal | Parameters | Description |
|--------|------------|-------------|
| `MidiMessageReceived` | `string type, int32 channel, int32 number, int32 value` | Emitted when a MIDI message is processed |
| `MidiBankSwitched` | `string bank` | Emitted when active bank changes |
| `MidiPerformanceModeToggled` | `boolean enabled` | Emitted when performance mode is toggled |
| `MidiLedFeedbackSent` | `string type, int32 channel, int32 number, int32 value` | Emitted when LED feedback message is generated |

---

## Python Integration Example

```python
from companion.midi_controller import MidiControllerManager
from companion.dbus_client import CmdBarDBusClient

client = CmdBarDBusClient()

# Toggle performance mode for DJ set
client.set_midi_performance_mode(True)

# Process MIDI message from hardware device
result = client.process_midi_message("note_on", 1, 60, 127)
print("MIDI Execution Result:", result)

# Switch to Bank B
client.switch_midi_bank("Bank B")
```
