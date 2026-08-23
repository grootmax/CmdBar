import time
import json
import urllib.request
import urllib.error
import pytest
from companion.iot_triggers import (
    SensorTriggerEngine,
    HomeAutomationBridge,
    WebhookListenerServer,
    MQTTTriggerHandler,
    IoTTriggerManager,
)


def test_sensor_trigger_engine_evaluations():
    rules = [
        {
            "id": "rule_temp_high",
            "sensor_name": "living_room_temp",
            "operator": ">",
            "value": 30,
            "command": "Turn On AC",
            "cooldown_seconds": 2,
        },
        {
            "id": "rule_humidity_low",
            "sensor_name": "humidity",
            "operator": "<=",
            "value": 20,
            "command": "Turn On Humidifier",
            "cooldown_seconds": 1,
        },
        {
            "id": "rule_door_open",
            "sensor_name": "front_door",
            "operator": "==",
            "value": "open",
            "command": "Alert Security",
            "cooldown_seconds": 5,
        },
        {
            "id": "rule_status_contains",
            "sensor_name": "system_log",
            "operator": "contains",
            "value": "CRITICAL",
            "command": "Notify Admin",
            "cooldown_seconds": 0,
        },
    ]

    engine = SensorTriggerEngine(rules)

    # 1. Temperature > 30 test
    assert len(engine.process_sensor_reading("living_room_temp", 25)) == 0
    triggered = engine.process_sensor_reading("living_room_temp", 35)
    assert len(triggered) == 1
    assert triggered[0]["command"] == "Turn On AC"

    # 2. Cooldown suppression test
    suppressed = engine.process_sensor_reading("living_room_temp", 36)
    assert len(suppressed) == 0

    # 3. Humidity <= 20 test
    h_triggered = engine.process_sensor_reading("humidity", 18)
    assert len(h_triggered) == 1
    assert h_triggered[0]["command"] == "Turn On Humidifier"

    # 4. String comparison test
    door_triggered = engine.process_sensor_reading("front_door", "open")
    assert len(door_triggered) == 1
    assert door_triggered[0]["command"] == "Alert Security"

    # 5. String containment test
    log_triggered = engine.process_sensor_reading(
        "system_log", "System state: CRITICAL error encountered"
    )
    assert len(log_triggered) == 1
    assert log_triggered[0]["command"] == "Notify Admin"


def test_home_automation_bridge():
    bridge = HomeAutomationBridge(
        platform="homeassistant", discovery_prefix="homeassistant"
    )
    disc_topic, payload = bridge.generate_ha_discovery_payload(
        "Deploy Staging", topic_prefix="cmdbar"
    )

    assert disc_topic == "homeassistant/button/cmdbar_deploy_staging/config"
    assert payload["name"] == "CmdBar Deploy Staging"
    assert payload["unique_id"] == "cmdbar_btn_deploy_staging"
    assert payload["command_topic"] == "cmdbar/trigger/Deploy Staging"
    assert payload["availability_topic"] == "cmdbar/status"
    assert "device" in payload


def test_webhook_listener_server():
    executed_commands = []

    def mock_executor(cmd, args):
        executed_commands.append((cmd, args))
        return {"success": True, "command": cmd, "exit_code": 0}

    port = 8891
    server = WebhookListenerServer(
        host="127.0.0.1",
        port=port,
        secret="test-secret-key-123",
        executor_callback=mock_executor,
    )
    assert server.start() is True
    time.sleep(0.1)  # Allow thread to start

    try:
        url = f"http://127.0.0.1:{port}/webhook/trigger"

        # 1. Health check endpoint
        req_health = urllib.request.Request(f"http://127.0.0.1:{port}/health")
        with urllib.request.urlopen(req_health) as resp:
            assert resp.status == 200
            data = json.loads(resp.read().decode("utf-8"))
            assert data["status"] == "ok"

        # 2. Unauthorized request without secret header
        req_unauth = urllib.request.Request(
            url,
            data=json.dumps({"command": "Ping Host"}).encode("utf-8"),
            method="POST",
        )
        req_unauth.add_header("Content-Type", "application/json")
        with pytest.raises(urllib.error.HTTPError) as exc_info:
            urllib.request.urlopen(req_unauth)
        assert exc_info.value.code == 401

        # 3. Authorized request with X-CmdBar-Secret header
        req_auth = urllib.request.Request(
            url,
            data=json.dumps(
                {"command": "Ping Host", "args": {"host": "localhost"}}
            ).encode("utf-8"),
            method="POST",
        )
        req_auth.add_header("Content-Type", "application/json")
        req_auth.add_header("X-CmdBar-Secret", "test-secret-key-123")
        with urllib.request.urlopen(req_auth) as resp:
            assert resp.status == 200
            res_data = json.loads(resp.read().decode("utf-8"))
            assert res_data["success"] is True

        assert len(executed_commands) == 1
        assert executed_commands[0] == ("Ping Host", {"host": "localhost"})

    finally:
        server.stop()


def test_mqtt_trigger_handler():
    received_triggers = []

    def mock_executor(cmd, args):
        received_triggers.append((cmd, args))
        return {"status": "executed", "command": cmd}

    handler = MQTTTriggerHandler(topic_prefix="mybar", executor_callback=mock_executor)

    # 1. Test topic builder
    assert handler.build_topic("trigger", "Ping Host") == "mybar/trigger/Ping Host"
    assert handler.build_topic("status") == "mybar/status"

    # 2. Test trigger topic message parsing
    res = handler.process_message(
        "mybar/trigger/Build", json.dumps({"args": {"target": "prod"}})
    )
    assert res["status"] == "executed"
    assert len(received_triggers) == 1
    assert received_triggers[0] == ("Build", {"target": "prod"})

    # 3. Test direct payload command
    res_direct = handler.process_message(
        "mybar/trigger", json.dumps({"command": "Deploy", "args": {}})
    )
    assert res_direct["status"] == "executed"
    assert len(received_triggers) == 2
    assert received_triggers[1][0] == "Deploy"


def test_iot_trigger_manager():
    executed = []

    def mock_exec(cmd, args):
        executed.append((cmd, args))
        return {"success": True}

    cfg = {
        "iot": {
            "enabled": True,
            "sensor_triggers": [
                {
                    "id": "rule_leak",
                    "sensor_name": "water_sensor",
                    "operator": "==",
                    "value": "LEAK",
                    "command": "Shutoff Valve",
                    "cooldown_seconds": 0,
                }
            ],
        }
    }

    manager = IoTTriggerManager(config=cfg, executor_callback=mock_exec)
    manager.start()

    try:
        # Simulate sensor reading
        triggered = manager._handle_sensor_update("water_sensor", "LEAK")
        assert len(triggered) == 1
        assert len(executed) == 1
        assert executed[0][0] == "Shutoff Valve"
    finally:
        manager.stop()


def test_performance_benchmark():
    rules = [
        {
            "id": f"rule_{i}",
            "sensor_name": f"sensor_{i % 5}",
            "operator": ">",
            "value": 50,
            "command": f"cmd_{i}",
            "cooldown_seconds": 0,
        }
        for i in range(10)
    ]
    engine = SensorTriggerEngine(rules)

    start_time = time.time()
    for _ in range(1000):
        engine.process_sensor_reading("sensor_2", 75)
    duration = time.time() - start_time

    # Performance threshold: 1,000 evaluations must take under 100 milliseconds
    assert duration < 0.100
