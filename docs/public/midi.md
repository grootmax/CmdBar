# MIDI Controller Support

CmdBar provides complete MIDI hardware controller integration. Trigger commands, adjust system values using faders and knobs, receive visual LED feedback, and use dedicated performance mode and DJ/producer workflows.

## Features

- **Button Mappings**: Map pads and buttons using Note On/Off or Control Change (CC) messages. Supports `trigger`, `toggle`, `momentary`, and `hold` button modes.
- **Value Sliders & Encoders**: Map faders, knobs, and pitch bend controllers to numeric parameter ranges with linear, exponential, or logarithmic response curves and relative/absolute encoder modes.
- **Hardware LED Feedback**: Outgoing MIDI feedback updates controller button LEDs to reflect command state (`idle`, `running`, `success`, `error`, `toggled`).
- **Performance Mode**: Toggle zero-latency performance mode for live execution without confirmation prompts.
- **DJ & Producer Workflows**: Seamlessly switch between active MIDI banks and DJ decks (Deck A, Deck B, Deck C, Deck D), adjust crossfader mix levels, and sync tempo with tap tempo calculation.
- **Hardware Presets**: Built-in hardware profiles for Novation Launchpad, Akai LPD8, Korg nanoKONTROL2, Pioneer DDJ, and Generic controllers.

## Example Configuration

```json
{
  "midi": {
    "enabled": true,
    "performance_mode": false,
    "active_bank": "Bank 1",
    "active_deck": "Deck A",
    "led_feedback": true,
    "mappings": [
      {
        "id": "play_btn",
        "event_type": "note_on",
        "note": 60,
        "mode": "trigger",
        "command": "systemctl start my-service",
        "bank": "Bank 1"
      },
      {
        "id": "volume_fader",
        "event_type": "cc",
        "cc": 7,
        "min_value": 0,
        "max_value": 100,
        "command": "amixer set Master {value}%"
      }
    ]
  }
}
```
