# IoT Trigger Support User Guide

CmdBar provides complete IoT integration allowing you to trigger desktop shortcuts and commands directly from hardware sensors, home automation systems, MQTT messages, and HTTP webhooks.

## Key Features

1. **MQTT Integration**: Subscribe to MQTT topics (e.g., `cmdbar/trigger/<command_name>` or `cmdbar/sensors/<sensor_id>`) to trigger commands remotely or stream sensor telemetry.
2. **Webhook Listener**: Built-in HTTP listener (`http://127.0.0.1:8088/webhook/trigger` or `/trigger/<command_name>`) with HMAC token authentication (`X-CmdBar-Secret` or `Authorization: Bearer <token>`).
3. **Home Automation Bridge**: Zero-configuration Home Assistant integration (`homeassistant/button/cmdbar_<id>/config`) to expose CmdBar shortcuts as interactive buttons or rest commands in Home Assistant dashboard.
4. **Sensor Trigger Rules Engine**: Condition evaluation (`>`, `<`, `==`, `!=`, `>=`, `<=`, `contains`, `between`) with customizable debounce and cooldown windows per rule.

## Quick Start & Examples

### 1. Webhook Triggers
Send an HTTP POST request to the CmdBar webhook endpoint:

```bash
curl -X POST "http://localhost:8088/trigger/Toggle%20Lights" \
  -H "X-CmdBar-Secret: YOUR_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"parameters": {"room": "office"}}'
```

Or POST directly to `/webhook/trigger`:

```bash
curl -X POST "http://localhost:8088/webhook/trigger" \
  -H "X-CmdBar-Secret: YOUR_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"command": "Ping Host", "args": {"host": "127.0.0.1"}}'
```

### 2. MQTT Integration
Publish messages to your MQTT broker on topics like:
- `cmdbar/trigger/MyCommand`: Triggers `MyCommand` with optional JSON payload parameters.
- `cmdbar/sensors/temp_sensor_01`: Sends telemetry data for rule evaluation.

### 3. Home Assistant Bridge
In Home Assistant, configure an automation or REST command payload:

```yaml
rest_command:
  cmdbar_trigger:
    url: "http://localhost:8088/homeassistant"
    method: POST
    headers:
      X-CmdBar-Secret: "YOUR_SECRET_KEY"
    payload: '{"action": "trigger_cmdbar", "command": "Activate Night Mode"}'
```

### 4. Sensor Rules & Configuration

In your `~/.config/cmdbar/config.json`:

```json
{
  "iot": {
    "enabled": true,
    "webhook_secret": "YOUR_SECRET_KEY",
    "mqtt": {
      "enabled": true,
      "host": "localhost",
      "port": 1883,
      "topic_prefix": "cmdbar",
      "username": "",
      "password": ""
    },
    "webhook": {
      "enabled": true,
      "host": "127.0.0.1",
      "port": 8088,
      "secret": "YOUR_SECRET_KEY"
    },
    "home_automation": {
      "enabled": true,
      "platform": "homeassistant",
      "discovery_prefix": "homeassistant"
    },
    "sensor_rules": [
      {
        "sensor_id": "temp_sensor_01",
        "metric": "temperature",
        "operator": ">",
        "threshold": 30.0,
        "command_name": "High Temp Alert",
        "cooldown_seconds": 30
      }
    ]
  }
}
```
