import time
import pytest
from datetime import datetime, timezone
from app.cron_scheduler import CronScheduler, get_next_run_time, should_job_run_now, parse_cron_expression


def test_cron_tick_evaluation_benchmark():
    scheduler = CronScheduler()

    # Create 100 scheduled jobs
    schedules = []
    for i in range(100):
        schedules.append({
            "id": f"bench-job-{i}",
            "name": f"Benchmark Job {i}",
            "command": "echo benchmark",
            "schedule": "0 0 1 1 *",  # Yearly - will not launch subprocesses during tick
            "timezone": "UTC",
            "enabled": True,
            "prevent_overlap": True,
            "last_run": None
        })

    scheduler.set_schedules(schedules)

    # Benchmark tick evaluation time for 100 jobs
    now_dt = datetime(2026, 8, 23, 12, 0, 0, tzinfo=timezone.utc)
    start_time = time.time()

    # Run 10 consecutive ticks (1000 job evaluations)
    for _ in range(10):
        scheduler.tick(now_dt=now_dt)

    elapsed_ms = (time.time() - start_time) * 1000.0

    # 10 ticks over 100 jobs (1000 job evaluations) should complete in < 50ms
    assert elapsed_ms < 50.0, f"Benchmark failed: 10 ticks over 100 jobs took {elapsed_ms:.2f} ms"


def test_cron_next_run_calculation_benchmark():
    expressions = [
        "* * * * *",
        "*/5 * * * *",
        "0 * * * *",
        "0 0 * * *",
        "0 12 * * 1-5",
        "@hourly",
        "@daily",
        "@weekly",
        "@monthly"
    ]

    base_time = datetime(2026, 8, 23, 12, 0, 0, tzinfo=timezone.utc)
    start_time = time.time()

    # Run 1000 calculations
    for _ in range(100):
        for expr in expressions:
            get_next_run_time(expr, base_time=base_time, tz_str="UTC")

    elapsed_ms = (time.time() - start_time) * 1000.0

    # 900 next run calculations should execute in < 150ms
    assert elapsed_ms < 150.0, f"Benchmark failed: 900 next run calculations took {elapsed_ms:.2f} ms"
