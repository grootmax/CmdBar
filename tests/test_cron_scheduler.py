import pytest
import time
import os
import tempfile
import threading
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

from app.cron_scheduler import (
    parse_cron_field,
    parse_cron_expression,
    is_valid_cron_expression,
    get_timezone_object,
    get_next_run_time,
    should_job_run_now,
    send_email_report,
    set_email_sent_hook,
    CronJobRunner,
    CronScheduler,
    PRESET_CRON_MAP,
)


def test_parse_cron_field():
    assert parse_cron_field("*", 0, 59) == set(range(0, 60))
    assert parse_cron_field("*/15", 0, 59) == {0, 15, 30, 45}
    assert parse_cron_field("1,5,10", 0, 59) == {1, 5, 10}
    assert parse_cron_field("1-5", 0, 59) == {1, 2, 3, 4, 5}
    assert parse_cron_field("1-10/2", 0, 59) == {1, 3, 5, 7, 9}

    with pytest.raises(ValueError):
        parse_cron_field("60", 0, 59)

    with pytest.raises(ValueError):
        parse_cron_field("invalid", 0, 59)


def test_parse_cron_expression_and_macros():
    parsed = parse_cron_expression("0 12 * * 1-5")
    assert parsed["minute"] == {0}
    assert parsed["hour"] == {12}
    assert parsed["day"] == set(range(1, 32))
    assert parsed["month"] == set(range(1, 13))
    assert parsed["weekday"] == {1, 2, 3, 4, 5}

    # Macros
    assert is_valid_cron_expression("@hourly")
    assert is_valid_cron_expression("@daily")
    assert is_valid_cron_expression("@weekly")
    assert is_valid_cron_expression("@monthly")
    assert is_valid_cron_expression("@yearly")
    assert is_valid_cron_expression("@every_minute")
    assert is_valid_cron_expression("@every_5_minutes")

    # Invalid
    assert not is_valid_cron_expression("invalid cron string")
    assert not is_valid_cron_expression("0 0 * *")  # 4 fields


def test_timezone_resolution():
    tz_utc = get_timezone_object("UTC")
    assert tz_utc == timezone.utc

    tz_ny = get_timezone_object("America/New_York")
    assert isinstance(tz_ny, ZoneInfo)
    assert tz_ny.key == "America/New_York"

    # Fallback for invalid timezone name
    tz_invalid = get_timezone_object("Invalid/Timezone_Name")
    assert tz_invalid is not None


def test_get_next_run_time():
    base_time = datetime(2026, 8, 23, 12, 0, 0, tzinfo=timezone.utc)
    
    # Every minute
    next_min = get_next_run_time("* * * * *", base_time=base_time, tz_str="UTC")
    assert next_min == datetime(2026, 8, 23, 12, 1, 0, tzinfo=timezone.utc)

    # Hourly
    next_hour = get_next_run_time("0 * * * *", base_time=base_time, tz_str="UTC")
    assert next_hour == datetime(2026, 8, 23, 13, 0, 0, tzinfo=timezone.utc)

    # Daily at midnight
    next_daily = get_next_run_time("0 0 * * *", base_time=base_time, tz_str="UTC")
    assert next_daily == datetime(2026, 8, 24, 0, 0, 0, tzinfo=timezone.utc)

    # Timezone aware
    next_ny = get_next_run_time("0 12 * * *", base_time=base_time, tz_str="America/New_York")
    assert next_ny.tzinfo is not None


def test_should_job_run_now():
    now = datetime(2026, 8, 23, 12, 30, 0, tzinfo=timezone.utc)
    assert should_job_run_now("30 12 * * *", current_time=now, tz_str="UTC")
    assert not should_job_run_now("31 12 * * *", current_time=now, tz_str="UTC")

    # Duplicate trigger prevention in same minute
    last_run = datetime(2026, 8, 23, 12, 30, 15, tzinfo=timezone.utc)
    assert not should_job_run_now("30 12 * * *", current_time=now, tz_str="UTC", last_run=last_run)


def test_overlap_prevention():
    runner = CronJobRunner()

    job_slow = {
        "id": "slow_job_1",
        "name": "Slow Job",
        "command": "sleep 1.5",
        "prevent_overlap": True
    }

    # Start long job in background thread
    t = threading.Thread(target=runner.execute_job, args=(job_slow,), daemon=True)
    t.start()

    time.sleep(0.2)
    assert runner.is_job_running("slow_job_1")

    # Attempt second execution while first is active -> skipped
    res_second = runner.execute_job(job_slow)
    assert res_second["status"] == "skipped"
    assert res_second["reason"] == "overlap_prevented"

    t.join(timeout=3.0)
    assert not runner.is_job_running("slow_job_1")


def test_error_handling_and_execution():
    runner = CronJobRunner()

    # Success job
    job_ok = {
        "id": "job_ok",
        "name": "Successful Job",
        "command": "echo 'Hello World'",
        "prevent_overlap": True
    }
    res_ok = runner.execute_job(job_ok)
    assert res_ok["status"] == "success"
    assert res_ok["exit_code"] == 0
    assert "Hello World" in res_ok["stdout"]

    # Failed job (exit code 1)
    job_fail = {
        "id": "job_fail",
        "name": "Failing Job",
        "command": "ls /nonexistent_directory_12345",
        "prevent_overlap": True
    }
    res_fail = runner.execute_job(job_fail)
    assert res_fail["status"] == "failed"
    assert res_fail["exit_code"] != 0
    assert len(res_fail["stderr"]) > 0


def test_email_reports():
    sent_reports = []

    def mock_email_hook(msg_dict):
        sent_reports.append(msg_dict)

    set_email_sent_hook(mock_email_hook)

    job_fail = {
        "id": "job_fail_email",
        "name": "Email Fail Job",
        "command": "exit 1",
        "email_reports": {
            "enabled": True,
            "recipients": ["test@example.com"],
            "trigger": "on_failure"
        }
    }

    runner = CronJobRunner()
    runner.execute_job(job_fail)

    assert len(sent_reports) == 1
    assert sent_reports[0]["recipients"] == ["test@example.com"]
    assert "Email Fail Job" in sent_reports[0]["subject"]
    assert "FAILED" in sent_reports[0]["subject"]

    # Reset hook
    set_email_sent_hook(None)


def test_cron_scheduler_lifecycle():
    scheduler = CronScheduler(tick_interval=0.1)

    sched = {
        "id": "life_job",
        "name": "Lifecycle Job",
        "command": "echo 'tick'",
        "schedule": "* * * * *",
        "timezone": "UTC",
        "enabled": True
    }

    added = scheduler.add_or_update_schedule(sched)
    assert added["id"] == "life_job"
    assert len(scheduler.get_schedules()) == 1

    # Manual run now
    res = scheduler.run_job_now("life_job")
    assert res["status"] == "success"
    assert "tick" in res["stdout"]

    # Delete schedule
    assert scheduler.delete_schedule("life_job")
    assert len(scheduler.get_schedules()) == 0
