# IoT Trigger Architecture & Developer Integration

This document outlines the architectural specifications, API handlers, and security controls for CmdBar's IoT Trigger subsystem.

## Architecture Overview

The IoT Trigger subsystem enables external hardware devices, smart home automation platforms, and sensors to trigger CmdBar commands securely.

Components:
1. **MQTT Engine (`companion/iot_service.py`, `extension/iotTrigger.js`)**:
   - Subscribes to and processes topics like `cmdbar/trigger/<command_name>`, `cmdbar/sensors/<sensor_id>`, and `cmdbar/homeassistant/event`.
2. **HTTP Webhook Listener**:
   - Serves an HTTP POST endpoint for receiving webhook payloads.
   - Enforces HMAC SHA-256 signature verification or secret token matching (`X-CmdBar-Secret`, `Authorization: Bearer <token>`).
3. **Home Automation Bridge**:
   - Translates Home Assistant and openHAB entity state changes and action events into command triggers.
4. **Sensor Rule Engine**:
   - Evaluates telemetry data against condition rules (`>`, `>=`, `<`, `<=`, `==`, `!=`, `contains`, `between`).
   - Implements configurable cooldown windows (`cooldown_seconds`) to prevent rapid re-triggering and event loops.
5. **D-Bus Integration (`org.gnome.CmdBar`)**:
   - Exposes `TriggerIoTEvent`, `GetIoTTriggers`, and `RegisterIoTTrigger`.

## Security Controls

- **Parameter Validation**: All input arguments extracted from incoming IoT payloads are validated against the command's parameter regex schema before execution.
- **Shell Sanitization**: Parameters are shell-quoted (`substitute_and_quote_command`) to prevent command injection attacks.
- **Rate Limiting & Cooldowns**: Deduplication tracking suppresses duplicate triggers within specified hysteresis windows.
