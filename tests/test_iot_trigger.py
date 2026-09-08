import json
import os
import time
import urllib.request
import pytest
from companion.iot_service import SensorRule, IoTTriggerManager, WebhookListenerServer
from companion.dbus_service import CmdBarDBusService
from companion.companion_app import save_config


@pytest.fixture
def temp_config_dir(tmp_path, monkeypatch):
    cfg_file = tmp_path / "config.json"
    key_file = tmp_path / ".key"
    monkeypatch.setenv("CMDBAR_CONFIG_PATH", str(cfg_file))

    sample_config = {
        "categories": [
            {
                "name": "Smart Home",
                "commands": [
                    {
                        "name": "Toggle Lights",
                        "template": "echo 'Lights toggled in {room}'",
                        "parameters": {
                            "room": {
                                "regex": "^[a-zA-Z0-9_]+$",
                                "placeholder": "Room name"
                            }
                        }
                    },
                    {
                        "name": "High Temp Alert",
                        "template": "echo 'ALERT: Temperature reached {metric_value} in {sensor_id}'",
                        "parameters": {}
                    },
                    {
                        "name": "Door Sensor Event",
                        "template": "echo 'Door event: {metric_value}'",
                        "parameters": {}
                    }
                ]
            }
        ],
        "iot": {
            "webhook_secret": "test_secret_key_12345",
            "sensor_rules": [
                {
                    "sensor_id": "temp_sensor_1",
                    "metric": "temperature",
                    "operator": ">",
                    "threshold": 30.0,
                    "command_name": "High Temp Alert",
                    "cooldown_seconds": 2.0
                }
            ]
        }
    }
    save_config(sample_config)
    return cfg_file


def test_sensor_rule_evaluation(temp_config_dir):
    rule = SensorRule("s1", "temp", ">", 25.0, "High Temp Alert", cooldown_seconds=1.0)
    assert rule.to_dict()["operator"] == ">"

    manager = IoTTriggerManager()
    manager.sensor_rules = [rule]

    # Under threshold
    res1 = manager.evaluate_sensor_telemetry("s1", {"temp": 20.0})
    assert len(res1) == 0

    # Over threshold
    res2 = manager.evaluate_sensor_telemetry("s1", {"temp": 28.5})
    assert len(res2) == 1
    assert res2[0]["success"] is True
    assert res2[0]["command_name"] == "High Temp Alert"

    # Immediate second event within cooldown should be suppressed
    res3 = manager.evaluate_sensor_telemetry("s1", {"temp": 29.0})
    assert len(res3) == 0


def test_sensor_operators():
    manager = IoTTriggerManager()
    
    # Operators: >, >=, <, <=, ==, !=, contains, between
    r_gt = SensorRule("s1", "v", ">", 10, "High Temp Alert")
    r_gte = SensorRule("s1", "v", ">=", 10, "High Temp Alert")
    r_lt = SensorRule("s1", "v", "<", 10, "High Temp Alert")
    r_lte = SensorRule("s1", "v", "<=", 10, "High Temp Alert")
    r_eq = SensorRule("s1", "v", "==", "active", "High Temp Alert")
    r_ne = SensorRule("s1", "v", "!=", "idle", "High Temp Alert")
    r_contains = SensorRule("s1", "v", "contains", "warning", "High Temp Alert")
    r_between = SensorRule("s1", "v", "between", [10, 20], "High Temp Alert")

    assert manager._evaluate_condition(15, ">", 10) is True
    assert manager._evaluate_condition(10, ">=", 10) is True
    assert manager._evaluate_condition(5, "<", 10) is True
    assert manager._evaluate_condition(10, "<=", 10) is True
    assert manager._evaluate_condition("active", "==", "active") is True
    assert manager._evaluate_condition("active", "!=", "idle") is True
    assert manager._evaluate_condition("system_warning_high", "contains", "warning") is True
    assert manager._evaluate_condition(15, "between", [10, 20]) is True
    assert manager._evaluate_condition(25, "between", [10, 20]) is False


def test_mqtt_topic_processing(temp_config_dir):
    manager = IoTTriggerManager()

    # Direct command trigger topic
    res1 = manager.process_mqtt_message(
        "cmdbar/trigger/Toggle Lights",
        json.dumps({"parameters": {"room": "livingroom"}})
    )
    assert res1["success"] is True
    assert res1["code"] == 200
    assert "livingroom" in res1["executed_command"]

    # Parameter validation failure
    res_bad = manager.process_mqtt_message(
        "cmdbar/trigger/Toggle Lights",
        json.dumps({"parameters": {"room": "living room; rm -rf /"}})
    )
    assert res_bad["success"] is False
    assert res_bad["code"] == 422


def test_webhook_auth_and_execution(temp_config_dir):
    manager = IoTTriggerManager()
    manager.set_webhook_secret("my_super_secret_token", persist=False)

    headers_invalid = {"X-CmdBar-Secret": "wrong_secret"}
    res_unauth = manager.process_webhook_request(
        "/trigger/Toggle Lights",
        headers_invalid,
        json.dumps({"parameters": {"room": "bedroom"}})
    )
    assert res_unauth["success"] is False
    assert res_unauth["code"] == 401

    headers_valid = {"X-CmdBar-Secret": "my_super_secret_token"}
    res_auth = manager.process_webhook_request(
        "/trigger/Toggle Lights",
        headers_valid,
        json.dumps({"parameters": {"room": "bedroom"}})
    )
    assert res_auth["success"] is True
    assert res_auth["code"] == 200
    assert "bedroom" in res_auth["executed_command"]


def test_home_assistant_event_bridge(temp_config_dir):
    manager = IoTTriggerManager()

    # Home Assistant action payload
    ha_action = {
        "action": "trigger_cmdbar",
        "command": "Toggle Lights",
        "parameters": {"room": "kitchen"}
    }
    res_ha = manager.process_home_assistant_event(ha_action)
    assert res_ha["success"] is True
    assert res_ha["code"] == 200
    assert "kitchen" in res_ha["executed_command"]


def test_dbus_iot_methods(temp_config_dir):
    dbus_svc = CmdBarDBusService()
    
    # Trigger IoT event via D-Bus
    success = dbus_svc.trigger_iot_event(
        "mqtt",
        "cmdbar/trigger/Toggle Lights",
        json.dumps({"parameters": {"room": "hallway"}})
    )
    assert success is True

    # Register sensor rule via D-Bus
    new_rule = {
        "sensor_id": "door_1",
        "metric": "state",
        "operator": "==",
        "threshold": "open",
        "command_name": "Door Sensor Event"
    }
    reg_ok = dbus_svc.register_iot_trigger(json.dumps(new_rule))
    assert reg_ok is True

    triggers = dbus_svc.get_iot_triggers()
    assert len(triggers) >= 1
    assert any(t["sensor_id"] == "door_1" for t in triggers)


def test_webhook_listener_http_server(temp_config_dir):
    manager = IoTTriggerManager()
    manager.set_webhook_secret("server_secret_999", persist=False)

    server = WebhookListenerServer(manager, host="127.0.0.1", port=8989)
    server.start()
    time.sleep(0.1)

    try:
        url = "http://127.0.0.1:8989/trigger/Toggle%20Lights"
        req_data = json.dumps({"parameters": {"room": "office"}}).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=req_data,
            headers={"Content-Type": "application/json", "X-CmdBar-Secret": "server_secret_999"},
            method="POST"
        )
        with urllib.request.urlopen(req) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            assert resp.status == 200
            assert body["success"] is True
            assert body["code"] == 200
    finally:
        server.stop()
