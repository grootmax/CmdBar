import os
import json
import pytest
import tempfile
from app.config_schema import load_config, save_config
from companion.dbus_service import CmdBarDBusService
from companion.dbus_client import CmdBarDBusClient


def test_cron_config_persistence_and_dbus():
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        config_path = tmp.name

    try:
        # Load fresh config
        config = load_config(config_path)
        assert "schedules" in config
        assert isinstance(config["schedules"], list)

        # Add a schedule to config
        test_schedule = {
            "id": "integration-job-1",
            "name": "Integration Test Job",
            "command": "echo 'Integration test passed'",
            "schedule": "0 0 * * *",
            "timezone": "UTC",
            "enabled": True,
            "prevent_overlap": True,
            "email_reports": {"enabled": False, "recipients": [], "trigger": "on_failure"},
            "last_run": None,
            "next_run": None,
            "last_status": "never_run",
            "last_output": "",
            "last_error": ""
        }
        config["schedules"].append(test_schedule)
        save_config(config, config_path)

        # Reload config and verify persistence
        reloaded = load_config(config_path)
        assert len(reloaded["schedules"]) == 1
        assert reloaded["schedules"][0]["name"] == "Integration Test Job"

        # Initialize D-Bus service and client with test config
        service = CmdBarDBusService(config_path=config_path)
        client = CmdBarDBusClient(service=service)

        schedules = client.get_schedules()
        assert len(schedules) == 1
        assert schedules[0]["id"] == "integration-job-1"

        # Add schedule via D-Bus client
        add_res = client.add_schedule(
            s_id="dbus-job-2",
            name="D-Bus Added Job",
            command="echo 'Added via D-Bus'",
            schedule="0 12 * * *",
            timezone="Local",
            prevent_overlap=True
        )
        assert add_res is True

        schedules_after = client.get_schedules()
        assert len(schedules_after) == 2

        # Trigger run_schedule_now via D-Bus client
        executed_signals = []
        def on_sched_executed(s_id_or_name, exit_code, success, status):
            executed_signals.append((s_id_or_name, exit_code, success, status))

        client.on_schedule_executed(on_sched_executed)

        run_res = client.run_schedule_now("dbus-job-2")
        assert run_res is True
        assert len(executed_signals) == 1
        assert executed_signals[0][0] == "dbus-job-2"
        assert executed_signals[0][2] is True

        # Remove schedule via D-Bus client
        rem_res = client.remove_schedule("integration-job-1")
        assert rem_res is True

        schedules_final = client.get_schedules()
        assert len(schedules_final) == 1
        assert schedules_final[0]["id"] == "dbus-job-2"

    finally:
        if os.path.exists(config_path):
            try:
                os.remove(config_path)
            except Exception:
                pass
        key_path = config_path.replace("config.json", ".key")
        if os.path.exists(key_path):
            try:
                os.remove(key_path)
            except Exception:
                pass
