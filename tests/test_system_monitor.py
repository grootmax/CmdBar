import os
import tempfile
import time
import pytest

from companion.system_monitor import (
    DEFAULT_THRESHOLDS,
    generate_sparkline,
    render_progress_bar,
    collect_cpu_usage,
    collect_memory_usage,
    collect_disk_usage,
    collect_network_usage,
    collect_system_metrics,
    validate_thresholds,
    export_to_csv,
    SystemMonitor,
)

from companion.dbus_service import CmdBarDBusService
from companion.dbus_client import CmdBarDBusClient


def test_sparklines_and_progress_bars():
    assert generate_sparkline([]) == ""
    assert generate_sparkline(None) == ""

    spark = generate_sparkline([0, 25, 50, 75, 100], 0, 100)
    assert len(spark) == 5
    assert spark[0] == " "
    assert spark[4] == "█"

    bar0 = render_progress_bar(0, 10)
    assert bar0 == "[░░░░░░░░░░] 0.0%"

    bar50 = render_progress_bar(50, 10)
    assert bar50 == "[█████░░░░░] 50.0%"

    bar100 = render_progress_bar(100, 10)
    assert bar100 == "[██████████] 100.0%"


def test_metric_collectors():
    cpu = collect_cpu_usage()
    assert isinstance(cpu, float)
    assert 0.0 <= cpu <= 100.0

    mem = collect_memory_usage()
    assert "used_mb" in mem and "total_mb" in mem and "percent" in mem
    assert 0.0 <= mem["percent"] <= 100.0

    disk = collect_disk_usage("/")
    assert "used_gb" in disk and "total_gb" in disk and "percent" in disk
    assert 0.0 <= disk["percent"] <= 100.0

    net = collect_network_usage()
    assert "rx_kbps" in net and "tx_kbps" in net and "total_kbps" in net

    metrics = collect_system_metrics()
    assert "timestamp" in metrics
    assert "cpu" in metrics
    assert "memory" in metrics
    assert "disk" in metrics
    assert "network" in metrics


def test_threshold_validation():
    defaults = validate_thresholds(None)
    assert defaults == DEFAULT_THRESHOLDS

    custom = validate_thresholds({"cpu": 90.0, "memory": 75.0, "disk": 92.0, "network": 20480.0})
    assert custom["cpu"] == 90.0
    assert custom["memory"] == 75.0
    assert custom["disk"] == 92.0
    assert custom["network"] == 20480.0

    invalid = validate_thresholds({"cpu": 150.0, "memory": -5.0})
    assert invalid["cpu"] == DEFAULT_THRESHOLDS["cpu"]
    assert invalid["memory"] == DEFAULT_THRESHOLDS["memory"]


def test_system_monitor_class():
    monitor = SystemMonitor(max_history=5, notification_cooldown_secs=1)

    # Record samples beyond max_history
    for i in range(10):
        monitor.record_sample({
            "timestamp": int(time.time() * 1000) + i * 1000,
            "cpu": {"percent": float(i * 10)},
            "memory": {"used_mb": 1000.0, "total_mb": 8000.0, "percent": 12.5},
            "disk": {"used_gb": 50.0, "total_gb": 500.0, "percent": 10.0},
            "network": {"rx_kbps": 100.0, "tx_kbps": 50.0, "total_kbps": 150.0}
        })

    history = monitor.get_history()
    assert len(history) == 5
    assert history[-1]["cpu"]["percent"] == 90.0

    monitor.clear_history()
    assert len(monitor.get_history()) == 0
    assert monitor.get_latest_sample() is None


def test_threshold_checking_and_alerts():
    monitor = SystemMonitor()
    high_sample = {
        "timestamp": int(time.time() * 1000),
        "cpu": {"percent": 88.0},
        "memory": {"used_mb": 7500.0, "total_mb": 8000.0, "percent": 93.75},
        "disk": {"used_gb": 480.0, "total_gb": 500.0, "percent": 96.0},
        "network": {"rx_kbps": 8000.0, "tx_kbps": 4000.0, "total_kbps": 12000.0}
    }

    alerts = monitor.check_thresholds(high_sample)
    assert len(alerts) == 4
    resources = [a["resource"] for a in alerts]
    assert resources == ["cpu", "memory", "disk", "network"]

    disk_alert = next(a for a in alerts if a["resource"] == "disk")
    assert disk_alert["level"] == "critical"


def test_notification_cooldown():
    monitor = SystemMonitor(notification_cooldown_secs=2)
    high_sample = {
        "timestamp": int(time.time() * 1000),
        "cpu": {"percent": 90.0},
        "memory": {"percent": 10.0},
        "disk": {"percent": 10.0},
        "network": {"total_kbps": 0.0}
    }

    calls = []
    def notify_cb(title, msg, alert):
        calls.append((title, msg))

    t0 = 1000.0
    triggered1 = monitor.check_and_notify(high_sample, notify_cb, now_sec=t0)
    assert len(triggered1) == 1
    assert len(calls) == 1

    # Call within cooldown window
    triggered2 = monitor.check_and_notify(high_sample, notify_cb, now_sec=t0 + 1.0)
    assert len(triggered2) == 0
    assert len(calls) == 1

    # Call after cooldown window
    triggered3 = monitor.check_and_notify(high_sample, notify_cb, now_sec=t0 + 2.5)
    assert len(triggered3) == 1
    assert len(calls) == 2


def test_mini_graph_and_menu_summary():
    monitor = SystemMonitor()
    sample = {
        "timestamp": int(time.time() * 1000),
        "cpu": {"percent": 55.0},
        "memory": {"used_mb": 4096.0, "total_mb": 16384.0, "percent": 25.0},
        "disk": {"used_gb": 250.0, "total_gb": 1000.0, "percent": 25.0},
        "network": {"rx_kbps": 120.0, "tx_kbps": 45.0, "total_kbps": 165.0}
    }
    monitor.record_sample(sample)

    cpu_graph = monitor.format_metric_mini_graph("cpu", sample)
    assert "CPU [" in cpu_graph
    assert "55.0%" in cpu_graph

    summary = monitor.format_menu_summary(sample)
    assert "CPU [" in summary
    assert "RAM [" in summary
    assert "Disk [" in summary
    assert "Net [" in summary


def test_csv_export():
    monitor = SystemMonitor()
    monitor.record_sample({
        "timestamp": 1700000000000,
        "cpu": {"percent": 40.0},
        "memory": {"used_mb": 2048.0, "total_mb": 8192.0, "percent": 25.0},
        "disk": {"used_gb": 100.0, "total_gb": 500.0, "percent": 20.0},
        "network": {"rx_kbps": 50.0, "tx_kbps": 20.0, "total_kbps": 70.0}
    })

    csv_data = monitor.export_to_csv()
    assert "timestamp,cpu_percent,memory_used_mb" in csv_data
    assert "40.0,2048.0,8192.0,25.0" in csv_data

    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        success = monitor.export_to_csv_file(tmp_path)
        assert success is True
        assert os.path.exists(tmp_path)
        with open(tmp_path, "r", encoding="utf-8") as f:
            content = f.read()
        assert "timestamp,cpu_percent" in content
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def test_dbus_integration():
    service = CmdBarDBusService()
    client = CmdBarDBusClient(service=service)

    metrics = service.get_system_metrics()
    assert "current" in metrics
    assert "summary" in metrics
    assert "history" in metrics

    csv_out = service.get_resource_monitor_csv()
    assert "timestamp,cpu_percent" in csv_out

    set_res = service.set_resource_thresholds({"cpu": 95.0})
    assert set_res is True
    assert service._system_monitor.get_thresholds()["cpu"] == 95.0

    alerts_received = []
    def on_alert(res, val, thresh):
        alerts_received.append((res, val, thresh))

    client.on_high_resource_usage_alert(on_alert)
    client.emit_signal_alert("cpu", 98.0, 95.0)
    assert len(alerts_received) == 1
    assert alerts_received[0] == ("cpu", 98.0, 95.0)
