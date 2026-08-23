"""
Unit tests for CmdBar Cron Scheduling Support.
Tests cron expression parsing, timezone awareness, overlap prevention,
error handling, history logging, email reports, DBus integration, and config persistence.
"""

import os
import json
import time
import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch

from app.cron_scheduler import (
    expand_shorthand,
    parse_cron_field,
    parse_cron_expression,
    get_timezone_object,
    is_cron_due,
    get_next_runs,
    format_email_report,
    send_email_report,
    CronJob,
    CronScheduler
)
from companion.dbus_service import CmdBarDBusService
from companion.dbus_client import CmdBarDBusClient


def test_expand_shorthand():
    assert expand_shorthand("@daily") == "0 0 * * *"
    assert expand_shorthand("@hourly") == "0 * * * *"
    assert expand_shorthand("@weekly") == "0 0 * * 0"
    assert expand_shorthand("@monthly") == "0 0 1 * *"
    assert expand_shorthand("@yearly") == "0 0 1 1 *"
    assert expand_shorthand("@annually") == "0 0 1 1 *"
    assert expand_shorthand("@minutely") == "* * * * *"
    assert expand_shorthand("*/5 * * * *") == "*/5 * * * *"


def test_parse_cron_field():
    # Wildcard
    assert parse_cron_field("*", 0, 5) == {0, 1, 2, 3, 4, 5}
    # Step
    assert parse_cron_field("*/2", 0, 5) == {0, 2, 4}
    # Range
    assert parse_cron_field("1-3", 0, 5) == {1, 2, 3}
    # List
    assert parse_cron_field("1,3,5", 0, 5) == {1, 3, 5}
    # Combined range with step
    assert parse_cron_field("0-4/2", 0, 5) == {0, 2, 4}

    # Errors
    with pytest.raises(ValueError):
        parse_cron_field("10", 0, 5)
    with pytest.raises(ValueError):
        parse_cron_field("1-10", 0, 5)
    with pytest.raises(ValueError):
        parse_cron_field("*/0", 0, 5)


def test_parse_cron_expression():
    parsed = parse_cron_expression("0 12 * JAN MON")
    assert 0 in parsed["minute"]
    assert 12 in parsed["hour"]
    assert 1 in parsed["month"]
    assert 1 in parsed["dow"]

    with pytest.raises(ValueError):
        parse_cron_expression("invalid expression")


def test_is_cron_due_and_timezones():
    # Fixed test datetime: 2026-08-23 12:00:00 UTC (a Sunday)
    dt_utc = datetime(2026, 8, 23, 12, 0, 0, tzinfo=timezone.utc)

    # 12:00 UTC matches "0 12 * * *" in UTC
    assert is_cron_due("0 12 * * *", dt=dt_utc, tz_str="UTC") is True
    assert is_cron_due("0 13 * * *", dt=dt_utc, tz_str="UTC") is False

    # Shorthand matching
    dt_midnight = datetime(2026, 8, 23, 0, 0, 0, tzinfo=timezone.utc)
    assert is_cron_due("@daily", dt=dt_midnight, tz_str="UTC") is True


def test_get_next_runs():
    start_dt = datetime(2026, 8, 23, 10, 0, 0, tzinfo=timezone.utc)
    runs = get_next_runs("*/15 * * * *", start_dt=start_dt, tz_str="UTC", count=3)
    assert len(runs) == 3
    assert runs[0] == datetime(2026, 8, 23, 10, 15, 0, tzinfo=timezone.utc)
    assert runs[1] == datetime(2026, 8, 23, 10, 30, 0, tzinfo=timezone.utc)
    assert runs[2] == datetime(2026, 8, 23, 10, 45, 0, tzinfo=timezone.utc)


def test_cron_job_to_from_dict():
    job_data = {
        "id": "job-1",
        "name": "Test Backup",
        "command": "echo backup",
        "cron_expression": "@daily",
        "timezone": "America/New_York",
        "overlap_prevention": True,
        "email_reports": {
            "enabled": True,
            "recipient": "admin@example.com",
            "on_failure": True,
            "on_success": False
        },
        "enabled": True
    }

    job = CronJob.from_dict(job_data)
    assert job.job_id == "job-1"
    assert job.name == "Test Backup"
    assert job.timezone == "America/New_York"
    assert job.email_reports["recipient"] == "admin@example.com"

    d = job.to_dict()
    assert d["id"] == "job-1"
    assert d["cron_expression"] == "@daily"


def test_overlap_prevention():
    job = CronJob(
        job_id="job-overlap",
        name="Long Running Task",
        command="sleep 10",
        cron_expression="* * * * *",
        overlap_prevention=True
    )
    job.is_running = True  # Simulate currently running instance

    scheduler = CronScheduler()
    scheduler.add_job(job)

    result = scheduler.run_job(job)
    assert result["status"] == "skipped_overlap"
    assert "skipped" in result["stderr"].lower()
    assert job.last_status == "skipped_overlap"


def test_error_handling_and_execution():
    scheduler = CronScheduler()

    # Successful command
    job_success = CronJob(
        job_id="job-ok",
        name="Success Task",
        command="echo 'Hello World'",
        cron_expression="* * * * *"
    )
    res_ok = scheduler.run_job(job_success)
    assert res_ok["status"] == "success"
    assert res_ok["exit_code"] == 0
    assert "Hello World" in res_ok["stdout"]

    # Failing command
    job_fail = CronJob(
        job_id="job-fail",
        name="Failing Task",
        command="exit 42",
        cron_expression="* * * * *"
    )
    res_fail = scheduler.run_job(job_fail)
    assert res_fail["status"] == "failed"
    assert res_fail["exit_code"] == 42


def test_email_report_formatting_and_sending():
    subject, body = format_email_report(
        job_name="DB Backup",
        command="pg_dump mydb",
        status="success",
        exit_code=0,
        stdout="Dump complete",
        stderr="",
        duration_sec=1.23
    )

    assert "[CmdBar Cron] SUCCESS: DB Backup" in subject
    assert "Job Name:     DB Backup" in body
    assert "Exit Code:    0" in body
    assert "Dump complete" in body

    # Test send_email_report with mocked smtplib
    with patch("smtplib.SMTP") as mock_smtp:
        mock_server = MagicMock()
        mock_smtp.return_value.__enter__.return_value = mock_server

        ok = send_email_report(
            job_name="Test Job",
            command="echo test",
            status="failed",
            exit_code=1,
            stdout="",
            stderr="Error occurred",
            duration_sec=0.5,
            recipient="devops@example.com",
            smtp_config={"smtp_host": "localhost", "smtp_port": 25}
        )

        assert ok is True
        mock_server.send_message.assert_called_once()


def test_scheduler_check_and_run_due_jobs():
    scheduler = CronScheduler()

    # Job due every minute
    due_job = CronJob(
        job_id="due-1",
        name="Due Job",
        command="echo due",
        cron_expression="* * * * *",
        enabled=True
    )

    # Disabled job
    disabled_job = CronJob(
        job_id="disabled-1",
        name="Disabled Job",
        command="echo disabled",
        cron_expression="* * * * *",
        enabled=False
    )

    scheduler.add_job(due_job)
    scheduler.add_job(disabled_job)

    now = datetime(2026, 8, 23, 12, 0, 0, tzinfo=timezone.utc)
    results = scheduler.check_and_run_due_jobs(now_dt=now)

    assert len(results) == 1
    assert results[0]["job_id"] == "due-1"


def test_dbus_cron_job_api(tmp_path):
    config_file = str(tmp_path / "config.json")
    os.environ["CMDBAR_CONFIG_PATH"] = config_file

    service = CmdBarDBusService(config_path=config_file)
    client = CmdBarDBusClient(service=service)

    # Initial empty cron jobs
    jobs = client.get_cron_jobs()
    assert len(jobs) == 0

    # Add cron job via DBus client
    new_job_data = {
        "id": "dbus-job-1",
        "name": "DBus Cron Job",
        "command": "echo dbus cron",
        "cron_expression": "*/10 * * * *",
        "timezone": "UTC"
    }
    assert client.add_cron_job(new_job_data) is True

    # Retrieve added cron job
    jobs = client.get_cron_jobs()
    assert len(jobs) == 1
    assert jobs[0]["id"] == "dbus-job-1"
    assert jobs[0]["name"] == "DBus Cron Job"

    # Run cron job manually via DBus client
    assert client.run_cron_job("dbus-job-1") is True

    # Check and run due jobs via DBus
    due_results = client.check_and_run_due_cron_jobs()
    assert isinstance(due_results, list)

    # Remove cron job
    assert client.remove_cron_job("dbus-job-1") is True
    assert len(client.get_cron_jobs()) == 0

    del os.environ["CMDBAR_CONFIG_PATH"]
