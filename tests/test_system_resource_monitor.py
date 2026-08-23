#!/usr/bin/env python3
import os
import json
import pytest
import tempfile
from companion.resource_monitor import (
    SystemResourceMonitor,
    render_sparkline,
    format_bytes,
    export_to_csv_string,
)
from companion.dbus_service import CmdBarDBusService
from companion.dbus_client import CmdBarDBusClient


def test_render_sparkline():
    history = [0, 20, 50, 80, 100]
    spark = render_sparkline(history, length=5, max_val=100)
    assert len(spark) == 5
    assert spark == " ▂▅▇█"

    pad_spark = render_sparkline([50, 100], length=4, max_val=100)
    assert len(pad_spark) == 4
    assert pad_spark.startswith("  ")


def test_format_bytes():
    assert format_bytes(0) == "0 B"
    assert format_bytes(1024) == "1.0 KB"
    assert format_bytes(1048576) == "1.0 MB"
    assert format_bytes(1073741824) == "1.0 GB"


def test_export_to_csv_string():
    sample_history = [
        {
            "timestamp": "2026-08-23T12:00:00.000Z",
            "cpu": {"usagePercent": 45.2},
            "memory": {
                "totalMB": 16000.0,
                "usedMB": 8000.0,
                "freeMB": 8000.0,
                "usagePercent": 50.0,
            },
            "disk": {
                "totalGB": 500.0,
                "usedGB": 200.0,
                "freeGB": 300.0,
                "usagePercent": 40.0,
            },
            "network": {
                "rxRateKBps": 120.5,
                "txRateKBps": 30.2,
                "totalRateKBps": 150.7,
            },
        }
    ]
    csv = export_to_csv_string(sample_history)
    lines = csv.splitlines()
    assert len(lines) == 2
    assert "Timestamp,CPU (%),Memory Used (MB)" in lines[0]
    assert (
        '"2026-08-23T12:00:00.000Z",45.2,8000.0,16000.0,50.0,200.00,500.00,40.0,120.5,30.2'
        in lines[1]
    )


class MockSystemReader:
    def read_cpu(self):
        return 88.5

    def read_memory(self):
        return {
            "totalMB": 16384.0,
            "usedMB": 12288.0,
            "freeMB": 4096.0,
            "usagePercent": 75.0,
        }

    def read_disk(self, path="/"):
        return {
            "totalGB": 500.0,
            "usedGB": 250.0,
            "freeGB": 250.0,
            "usagePercent": 50.0,
        }

    def read_network(self):
        return {
            "rxBytes": 2000000,
            "txBytes": 1000000,
            "rxRateKBps": 500.0,
            "txRateKBps": 200.0,
            "totalRateKBps": 700.0,
        }


def test_system_resource_monitor_sampling():
    reader = MockSystemReader()
    rm = SystemResourceMonitor(config={"max_history_length": 5}, system_reader=reader)

    sample = rm.sample_metrics()
    assert sample["cpu"]["usagePercent"] == 88.5
    assert sample["memory"]["usagePercent"] == 75.0
    assert sample["disk"]["usagePercent"] == 50.0
    assert len(rm.history) == 1


def test_check_thresholds_alerts():
    reader = MockSystemReader()
    rm = SystemResourceMonitor(
        config={"cpu_threshold": 80.0, "notification_cooldown": 10.0},
        system_reader=reader,
    )
    sample = rm.sample_metrics()
    alerts = rm.check_thresholds(sample)

    # Since sample_metrics() already ran check_thresholds once, check last_notified or test direct check_thresholds
    rm.last_notified["cpu"] = 0.0
    direct_alerts = rm.check_thresholds(sample)

    assert len(direct_alerts) == 1
    assert direct_alerts[0]["metric"] == "cpu"
    assert direct_alerts[0]["value"] == 88.5

    # Cooldown prevents immediate re-fire
    second_alerts = rm.check_thresholds(sample)
    assert len(second_alerts) == 0


def test_export_to_csv_file():
    reader = MockSystemReader()
    rm = SystemResourceMonitor(system_reader=reader)
    rm.sample_metrics()

    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp:
        path = tmp.name

    try:
        ok = rm.export_to_csv(path)
        assert ok is True
        assert os.path.exists(path)
        with open(path, "r") as f:
            content = f.read()
        assert "Timestamp" in content
        assert "88.5" in content
    finally:
        if os.path.exists(path):
            os.remove(path)


def test_python_dbus_resource_metrics():
    service = CmdBarDBusService()
    metrics = service.get_resource_metrics()
    assert "cpu" in metrics
    assert "memory" in metrics
    assert "disk" in metrics
    assert "network" in metrics
    assert "sparklines" in metrics

    client = CmdBarDBusClient(service=service)
    client_metrics = client.get_resource_metrics()
    assert "cpu" in client_metrics
    assert "sparklines" in client_metrics
