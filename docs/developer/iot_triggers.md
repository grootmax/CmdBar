# IoT Trigger Architecture & Developer Guide

This document outlines the architectural specifications, API handlers, and security controls for CmdBar's IoT Trigger subsystem.

## Architecture Overview

The IoT Trigger subsystem enables external hardware devices, smart home automation platforms, and sensors to trigger CmdBar commands securely across two synchronized layers:

1. **Python Companion Subsystem (`companion/iot_service.py` & `companion/iot_triggers.py`)**:
   - `SensorTriggerEngine` / `SensorRuleEvaluator`: High-performance rule evaluator with debouncing and cooldown tracking.
   - `HomeAutomationBridge`: Generates Home Assistant Discovery configurations and translates Home Assistant / openHAB entity state changes and action events into command triggers.
   - `WebhookListenerServer`: Multi-threaded HTTP server utilizing `urllib` / `http.server` with HMAC SHA-256 signature verification or secret token matching (`X-CmdBar-Secret`, `Authorization: Bearer <token>`).
   - `MQTTTriggerHandler`: Subscribes to and processes topics like `cmdbar/trigger/<command_name>`, `cmdbar/sensors/<sensor_id>`, and `cmdbar/homeassistant/event`.
   - `IoTTriggerManager`: Orchestrator managing lifecycle, configuration reload, and command dispatching.

2. **JavaScript Extension Layer (`extension/iotTrigger.js`)**:
   - `IoTTriggerProcessor` / `IoTTriggerManager`: Client-side rule processor and debouncer.
   - Helper functions: `evaluateCondition`, `processMQTTTopicAndPayload`, `validateWebhookAuth`, `processWebhookRequest`, `processHomeAutomationEvent`, `evaluateSensorRules`, `evaluateSensorRule`, `checkCooldown`, `parseWebhookPayload`, `formatMqttTopic`, `buildHomeAssistantConfig`.

3. **D-Bus Integration (`org.gnome.CmdBar`)**:
   - Exposes `TriggerIoTEvent`, `GetIoTTriggers`, and `RegisterIoTTrigger`.

## Security Controls & Considerations

- **Parameter Validation**: All input arguments extracted from incoming IoT payloads are validated against the command's parameter regex schema before execution.
- **Shell Sanitization**: Parameters are shell-quoted (`substitute_and_quote_command`) to prevent command injection attacks.
- **Webhook Security**: Webhook secret verification uses constant-time comparison (`hmac.compare_digest`) and token checks to prevent unauthorized execution or timing attacks.
- **Rate Limiting & Cooldowns**: Deduplication tracking suppresses duplicate triggers within specified hysteresis windows (`cooldown_seconds`).
