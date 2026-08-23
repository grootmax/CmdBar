# Elgato Stream Deck Integration Guide

CmdBar provides full integration with Elgato Stream Deck hardware devices and the Stream Deck application.

## Key Features

- **Visual Buttons**: Automatically maps your CmdBar commands and categories onto visual Stream Deck key grids (e.g. 3x5, 4x8, Stream Deck Mini/XL/Plus).
- **Feedback LEDs & Status**: Key states update visually in real time:
  - Charcoal/Dark: Idle
  - Amber Yellow LED: Command executing / in progress
  - Vibrant Green LED: Execution success
  - Bright Red LED: Execution error / failure
- **Dynamic Labels**: Dynamically renders wrapped command titles, status badges, and execution timers directly on key displays.
- **Profile Switching**: Automatically organizes commands into category profiles (e.g. Default, Projects, Infrastructure) and provides one-touch profile switching keys.
- **Performance Optimized**: Sub-millisecond SVG rendering with automatic image memoization and non-blocking asynchronous D-Bus execution.

## Getting Started with Stream Deck

1. **Install Plugin**: The Stream Deck plugin manifest resides under `companion/streamdeck_plugin/manifest.json`.
2. **Connect via D-Bus**: CmdBar's Python background service exposes D-Bus methods `GetStreamDeckProfiles`, `SetStreamDeckProfile`, `GetStreamDeckStatus`, and `TriggerStreamDeckButton`.
3. **Execution & Feedback**: Key presses trigger CmdBar shortcuts asynchronously and stream execution feedback back to your Stream Deck display instantly.
