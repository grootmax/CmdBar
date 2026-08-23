# IoT Trigger Architecture & Developer Guide

This document describes the internal architecture and implementation details of the CmdBar IoT Trigger subsystem.

## Architecture Overview

The IoT subsystem consists of two synchronized layers:

1. **Python Companion Layer (`companion/iot_triggers.py`)**:
   - `SensorTriggerEngine`: High-performance rule evaluator with debouncing and cooldown tracking.
   - `HomeAutomationBridge`: Generates Home Assistant Discovery configurations and MQTT topics.
   - `WebhookListenerServer`: Multi-threaded HTTP server utilizing `urllib` / `http.server` with HMAC timing-attack safe header verification.
   - `MQTTTriggerHandler`: MQTT packet/topic parser and routing interface.
   - `IoTTriggerManager`: Orchestrator managing lifecycle, configuration reload, and command dispatching.

2. **JavaScript Extension Layer (`extension/iotTrigger.js`)**:
   - `IoTTriggerProcessor`: Client-side rule processor and debouncer.
   - Helper functions: `evaluateSensorRule`, `checkCooldown`, `parseWebhookPayload`, `formatMqttTopic`, `buildHomeAssistantConfig`.

## Security Considerations

- Webhook secret verification uses constant-time comparison `hmac.compare_digest` to prevent timing attacks.
- Input parameters are validated against regex patterns and forbidden shell characters using `validate_parameter_value`.
