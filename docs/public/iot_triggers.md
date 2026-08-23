# IoT Trigger Support User Guide

CmdBar supports triggering commands directly from IoT devices, MQTT brokers, Home Assistant, openHAB, and sensor telemetry.

## Quick Start

### 1. Webhook Triggers
Send an HTTP POST request to the CmdBar webhook endpoint:

```bash
curl -X POST "http://localhost:8088/trigger/Toggle%20Lights" \
  -H "X-CmdBar-Secret: YOUR_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"parameters": {"room": "office"}}'
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

### 4. Sensor Rules
Define rules in `config.json` under `"iot.sensor_rules"`:

```json
{
  "iot": {
    "webhook_secret": "YOUR_SECRET_KEY",
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
