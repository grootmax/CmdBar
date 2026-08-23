# MIDI Controller Developer Guide

Technical specifications for CmdBar's MIDI Controller integration engine (`extension/midiController.js` and `companion/midi_controller.py`).

## System Architecture

The MIDI Controller system consists of:
1. **Raw Byte Parser**: `parseRawMidiBytes` converts raw 2- or 3-byte MIDI events into normalized JavaScript/Python event objects.
2. **Value Scaler**: `scaleValue` scales 7-bit (0-127) or 14-bit (0-16383) MIDI values to configured target ranges, applying linear, exponential, logarithmic, or relative encoder adjustments.
3. **MidiControllerManager**: Manages device connectivity, hardware profiles, active banks/decks, mapping registration, event dispatching, command execution, LED feedback, and latency benchmarking.
4. **D-Bus Integration**: Exposes D-Bus methods `ProcessMidiEvent`, `SetMidiBank`, and `TogglePerformanceMode` for external process integration.

## Latency & Performance

- Event processing latency is benchmarked to < 5ms per event.
- High-frequency fader/slider events can be throttled via `throttle_ms`.
- Performance Mode bypasses dialog prompts to ensure instant command execution.
