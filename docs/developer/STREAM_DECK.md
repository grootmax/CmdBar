# Elgato Stream Deck Integration Specification

This document details the architectural design, API specifications, and operational workflows for the **Elgato Stream Deck** hardware integration in CmdBar.

## Architecture Overview

The Stream Deck integration enables physical hardware controllers (Elgato Stream Deck Mini, Standard, XL, Plus) or virtual controllers to interact directly with CmdBar.

The architecture comprises two main components:
1. **Python Companion Service (`companion/stream_deck.py`)**: Manages profile persistence, async command execution, feedback LED states, dynamic label resolution, and vector SVG visual rendering.
2. **JavaScript Extension Module (`extension/streamDeck.js`)**: Executes inside GNOME Shell and Node.js test runners, driving real-time button grid state updates and D-Bus IPC methods.

---

## Core Features

### 1. Visual Buttons for Commands
- Direct mapping of physical key indices (0 to N-1) to CmdBar commands.
- Visual button grid rendering supporting background colors, icon symbols, and dynamic title labels.
- Clean vector SVG image generation with base64 data URI output for hardware displays.

### 2. Feedback LEDs & Status Indicators
- Key LED indicators represent real-time execution states:
  - `idle` (Slate Gray `#4A5568` / `⚪`): Ready for interaction.
  - `running` (Amber `#ECC94B` / `⚡`): Pulse animation indicating active command execution.
  - `success` (Green `#48BB78` / `✓`): Command completed with exit code 0.
  - `error` (Red `#F56565` / `✗`): Command failed or exited with non-zero status.

### 3. Dynamic Labels
- Dynamic template strings support variable substitution:
  - `{name}`: Command name
  - `{status}`: Current LED state
  - `{time}`: Current wall-clock time (`HH:MM`)
  - `{last_output}`: Truncated command stdout/stderr
  - `{execution_time}`: Execution duration in milliseconds
  - `{param_name}`: Custom command parameter values
- Automatic text wrapping and truncation optimized for key screen dimensions.

### 4. Profile Management & Switching
- Multiple profiles supported per device model (`MINI`, `ORIGINAL`, `XL`, `PLUS`).
- Profile switching actions directly bound to key presses (`action_type="switch_profile"`).
- Automatic category profile switching when selecting specific command categories.
- Export and import profiles as JSON schema files.

### 5. Performance Optimization & Benchmarking
- **Render Caching**: MD5/SHA256 hashed render cache avoids re-generating vector SVG data for unchanged keys.
- **Latency Benchmarks**: Sub-millisecond key state resolution and <5ms vector visual rendering per key.
- **Non-Blocking Execution**: Asynchronous thread pool execution prevents UI blocking.

---

## D-Bus Interface Specifications

```xml
<method name="StreamDeckPressKey">
  <arg name="key_index" type="i" direction="in"/>
  <arg name="success" type="b" direction="out"/>
</method>

<method name="StreamDeckSetActiveProfile">
  <arg name="profile_name" type="s" direction="in"/>
  <arg name="success" type="b" direction="out"/>
</method>

<method name="StreamDeckGetProfileGrid">
  <arg name="json_grid" type="s" direction="out"/>
</method>
```
