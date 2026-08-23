# IoT Trigger Support

CmdBar provides complete IoT integration allowing you to trigger desktop shortcuts and commands directly from hardware sensors, home automation systems, MQTT messages, and HTTP webhooks.

## Key Features

1. **MQTT Integration**: Subscribe to MQTT topics (e.g., `cmdbar/trigger/<command_name>` or `cmdbar/sensor/<sensor_name>`) to trigger commands remotely or stream sensor readings.
2. **Webhook Listener**: Built-in HTTP listener (`http://127.0.0.1:8088/webhook/trigger`) with HMAC token authentication (`X-CmdBar-Secret`).
3. **Home Automation Bridge**: Zero-configuration Home Assistant MQTT Discovery (`homeassistant/button/cmdbar_<id>/config`) to expose CmdBar shortcuts as interactive buttons in Home Assistant dashboard.
4. **Sensor Trigger Rules Engine**: Condition evaluation (`>`, `<`, `==`, `!=`, `>=`, `<=`, `contains`) with customizable debounce and cooldown windows per rule.

## Configuration

In your `~/.config/cmdbar/config.json`:

```json
{
  "iot": {
    "enabled": true,
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
      "secret": "your-secure-webhook-secret"
    },
    "home_automation": {
      "enabled": true,
      "platform": "homeassistant",
      "discovery_prefix": "homeassistant"
    },
    "sensor_triggers": [
      {
        "id": "high_temp_alert",
        "sensor_name": "living_room_temp",
        "operator": ">",
        "value": 30,
        "command": "Ping Host",
        "args": { "host": "127.0.0.1" },
        "cooldown_seconds": 10
      }
    ]
  }
}
```

## Webhook Endpoint API

### Trigger Command
- **URL**: `POST http://127.0.0.1:8088/webhook/trigger`
- **Header**: `X-CmdBar-Secret: your-secure-webhook-secret`
- **Body**:
  ```json
  {
    "command": "Ping Host",
    "args": {
      "host": "127.0.0.1"
    }
  }
  ```

### Stream Sensor Reading
- **URL**: `POST http://127.0.0.1:8088/webhook/sensor`
- **Header**: `X-CmdBar-Secret: your-secure-webhook-secret`
- **Body**:
  ```json
  {
    "sensor_name": "living_room_temp",
    "value": 35
  }
  ```
