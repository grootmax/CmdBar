"""
System Resource Monitors module for CmdBar Companion & CLI.
Live CPU, Memory, Disk, Network monitoring with sparklines,
configurable thresholds, notifications, and CSV export.
"""

import os
import sys
import time
import json
import math
import shutil
from datetime import datetime, timezone

DEFAULT_THRESHOLDS = {
    "cpu": 80.0,        # %
    "memory": 80.0,     # %
    "disk": 85.0,       # %
    "network": 10240.0  # KB/s
}

SPARKLINE_CHARS = [" ", "▂", "▃", "▄", "▅", "▆", "▇", "█"]


def generate_sparkline(values, min_val=0.0, max_val=100.0) -> str:
    """
    Generates a unicode sparkline string from a list of numeric values.
    """
    if not values or not isinstance(values, (list, tuple)):
        return ""
    
    range_val = max_val - min_val
    if range_val <= 0:
        range_val = 1.0

    sparkline = []
    for val in values:
        try:
            num = float(val)
        except (ValueError, TypeError):
            num = 0.0
        clamped = max(min_val, min(max_val, num))
        normalized = (clamped - min_val) / range_val
        idx = min(len(SPARKLINE_CHARS) - 1, max(0, math.floor(normalized * len(SPARKLINE_CHARS))))
        sparkline.append(SPARKLINE_CHARS[idx])

    return "".join(sparkline)


def render_progress_bar(percent, length=10) -> str:
    """
    Renders an ASCII/Unicode progress bar.
    """
    try:
        p = float(percent)
    except (ValueError, TypeError):
        p = 0.0
    p = max(0.0, min(100.0, p))
    filled = int(round((p / 100.0) * length))
    empty = length - filled
    bar = "█" * filled + "░" * empty
    return f"[{bar}] {p:.1f}%"


_last_cpu_times = None


def collect_cpu_usage() -> float:
    """
    Collects CPU usage percentage (0 - 100%).
    """
    global _last_cpu_times
    try:
        if os.path.exists("/proc/stat"):
            with open("/proc/stat", "r", encoding="utf-8") as f:
                first_line = f.readline()
            parts = first_line.strip().split()[1:]
            vals = [float(x) for x in parts]
            if len(vals) >= 4:
                idle = vals[3] + (vals[4] if len(vals) > 4 else 0.0)
                total = sum(vals[:8]) if len(vals) >= 8 else sum(vals)

                if _last_cpu_times is None:
                    _last_cpu_times = (idle, total)
                    non_idle = total - idle
                    return round((non_idle / total * 100.0), 1) if total > 0 else 0.0

                prev_idle, prev_total = _last_cpu_times
                _last_cpu_times = (idle, total)

                idle_diff = idle - prev_idle
                total_diff = total - prev_total
                if total_diff <= 0:
                    return 0.0
                usage = ((total_diff - idle_diff) / total_diff) * 100.0
                return round(max(0.0, min(100.0, usage)), 1)
    except Exception:
        pass

    return 0.0


def collect_memory_usage() -> dict:
    """
    Collects memory usage statistics.
    Returns dict: {"used_mb": float, "total_mb": float, "percent": float}
    """
    try:
        if os.path.exists("/proc/meminfo"):
            mem_info = {}
            with open("/proc/meminfo", "r", encoding="utf-8") as f:
                for line in f:
                    parts = line.split(":")
                    if len(parts) == 2:
                        key = parts[0].strip()
                        val_str = parts[1].strip().split()[0]
                        try:
                            mem_info[key] = float(val_str)
                        except ValueError:
                            pass

            total_kb = mem_info.get("MemTotal", 0.0)
            free_kb = mem_info.get("MemFree", 0.0)
            buffers_kb = mem_info.get("Buffers", 0.0)
            cached_kb = mem_info.get("Cached", 0.0)
            sreclaimable_kb = mem_info.get("SReclaimable", 0.0)

            actual_free_kb = free_kb + buffers_kb + cached_kb + sreclaimable_kb
            used_kb = max(0.0, total_kb - actual_free_kb)

            total_mb = round(total_kb / 1024.0, 1)
            used_mb = round(used_kb / 1024.0, 1)
            percent = round((used_kb / total_kb * 100.0), 1) if total_kb > 0 else 0.0

            return {"used_mb": used_mb, "total_mb": total_mb, "percent": percent}
    except Exception:
        pass

    return {"used_mb": 0.0, "total_mb": 1.0, "percent": 0.0}


def collect_disk_usage(mount_path="/") -> dict:
    """
    Collects disk usage statistics for specified mount path.
    Returns dict: {"used_gb": float, "total_gb": float, "percent": float}
    """
    try:
        if hasattr(os, "statvfs"):
            stat = os.statvfs(mount_path)
            total_bytes = stat.f_blocks * stat.f_frsize
            free_bytes = stat.f_bfree * stat.f_frsize
            used_bytes = total_bytes - free_bytes

            total_gb = round(total_bytes / (1024.0 ** 3), 1)
            used_gb = round(used_bytes / (1024.0 ** 3), 1)
            percent = round((used_bytes / total_bytes * 100.0), 1) if total_bytes > 0 else 0.0

            return {"used_gb": used_gb, "total_gb": total_gb, "percent": percent}
    except Exception:
        pass

    return {"used_gb": 0.0, "total_gb": 1.0, "percent": 0.0}


_last_net_bytes = None


def collect_network_usage() -> dict:
    """
    Collects network usage (Rx and Tx rate in KB/s).
    Returns dict: {"rx_kbps": float, "tx_kbps": float, "total_kbps": float}
    """
    global _last_net_bytes
    try:
        if os.path.exists("/proc/net/dev"):
            total_rx = 0
            total_tx = 0
            with open("/proc/net/dev", "r", encoding="utf-8") as f:
                lines = f.readlines()

            for line in lines:
                if ":" not in line:
                    continue
                parts = line.split(":")
                iface = parts[0].strip()
                if iface == "lo":
                    continue
                
                stats = parts[1].strip().split()
                if len(stats) >= 9:
                    total_rx += int(stats[0])
                    total_tx += int(stats[8])

            now = time.time()
            if _last_net_bytes is None:
                _last_net_bytes = (total_rx, total_tx, now)
                return {"rx_kbps": 0.0, "tx_kbps": 0.0, "total_kbps": 0.0}

            prev_rx, prev_tx, prev_time = _last_net_bytes
            _last_net_bytes = (total_rx, total_tx, now)

            time_diff = now - prev_time if (now - prev_time) > 0 else 1.0
            rx_diff = max(0, total_rx - prev_rx)
            tx_diff = max(0, total_tx - prev_tx)

            rx_kbps = round((rx_diff / 1024.0 / time_diff), 1)
            tx_kbps = round((tx_diff / 1024.0 / time_diff), 1)
            total_kbps = round(rx_kbps + tx_kbps, 1)

            return {"rx_kbps": rx_kbps, "tx_kbps": tx_kbps, "total_kbps": total_kbps}
    except Exception:
        pass

    return {"rx_kbps": 0.0, "tx_kbps": 0.0, "total_kbps": 0.0}


def collect_system_metrics(mount_path="/") -> dict:
    """
    Collects current system resource metrics snapshot.
    """
    return {
        "timestamp": int(time.time() * 1000),
        "cpu": {"percent": collect_cpu_usage()},
        "memory": collect_memory_usage(),
        "disk": collect_disk_usage(mount_path),
        "network": collect_network_usage()
    }


def validate_thresholds(thresholds=None) -> dict:
    """
    Validates threshold options dict.
    """
    result = dict(DEFAULT_THRESHOLDS)
    if not isinstance(thresholds, dict):
        return result

    if "cpu" in thresholds and isinstance(thresholds["cpu"], (int, float)) and 0 <= thresholds["cpu"] <= 100:
        result["cpu"] = float(thresholds["cpu"])
    if "memory" in thresholds and isinstance(thresholds["memory"], (int, float)) and 0 <= thresholds["memory"] <= 100:
        result["memory"] = float(thresholds["memory"])
    if "disk" in thresholds and isinstance(thresholds["disk"], (int, float)) and 0 <= thresholds["disk"] <= 100:
        result["disk"] = float(thresholds["disk"])
    if "network" in thresholds and isinstance(thresholds["network"], (int, float)) and thresholds["network"] >= 0:
        result["network"] = float(thresholds["network"])

    return result


def export_to_csv(history=None) -> str:
    """
    Converts metric history list of dicts to CSV string.
    """
    headers = [
        "timestamp",
        "cpu_percent",
        "memory_used_mb",
        "memory_total_mb",
        "memory_percent",
        "disk_used_gb",
        "disk_total_gb",
        "disk_percent",
        "net_rx_kbps",
        "net_tx_kbps"
    ]

    rows = [",".join(headers)]
    if isinstance(history, list):
        for sample in history:
            if not isinstance(sample, dict):
                continue
            ts_ms = sample.get("timestamp", int(time.time() * 1000))
            ts_str = datetime.fromtimestamp(ts_ms / 1000.0, timezone.utc).isoformat().replace("+00:00", "Z")
            
            cpu_p = sample.get("cpu", {}).get("percent", 0.0)
            mem = sample.get("memory", {})
            disk = sample.get("disk", {})
            net = sample.get("network", {})

            row = [
                ts_str,
                str(cpu_p),
                str(mem.get("used_mb", 0.0)),
                str(mem.get("total_mb", 0.0)),
                str(mem.get("percent", 0.0)),
                str(disk.get("used_gb", 0.0)),
                str(disk.get("total_gb", 0.0)),
                str(disk.get("percent", 0.0)),
                str(net.get("rx_kbps", 0.0)),
                str(net.get("tx_kbps", 0.0))
            ]
            rows.append(",".join(row))

    return "\n".join(rows)


class SystemMonitor:
    """
    SystemMonitor class managing history, thresholds, alerts, and formatting.
    """
    def __init__(self, max_history=20, thresholds=None, notification_cooldown_secs=60):
        self.max_history = max_history
        self.thresholds = validate_thresholds(thresholds)
        self.notification_cooldown_secs = notification_cooldown_secs
        self.history = []
        self.last_notification_time = {
            "cpu": 0.0,
            "memory": 0.0,
            "disk": 0.0,
            "network": 0.0
        }

    def set_thresholds(self, new_thresholds) -> dict:
        self.thresholds = validate_thresholds({**self.thresholds, **(new_thresholds or {})})
        return dict(self.thresholds)

    def get_thresholds(self) -> dict:
        return dict(self.thresholds)

    def record_sample(self, sample=None) -> dict:
        if not isinstance(sample, dict):
            sample = collect_system_metrics()
        self.history.append(sample)
        if len(self.history) > self.max_history:
            self.history.pop(0)
        return sample

    def get_history(self) -> list:
        return list(self.history)

    def clear_history(self):
        self.history.clear()

    def get_latest_sample(self):
        return self.history[-1] if self.history else None

    def check_thresholds(self, sample=None, custom_thresholds=None) -> list:
        if sample is None:
            sample = self.get_latest_sample()
        if not sample:
            return []

        thresholds = validate_thresholds(custom_thresholds or self.thresholds)
        alerts = []

        cpu = sample.get("cpu", {})
        if "percent" in cpu and cpu["percent"] >= thresholds["cpu"]:
            alerts.append({
                "resource": "cpu",
                "value": cpu["percent"],
                "threshold": thresholds["cpu"],
                "unit": "%",
                "level": "critical" if cpu["percent"] >= 95 else "warning",
                "message": f"High CPU Usage: {cpu['percent']}% (Threshold: {thresholds['cpu']}%)"
            })

        mem = sample.get("memory", {})
        if "percent" in mem and mem["percent"] >= thresholds["memory"]:
            alerts.append({
                "resource": "memory",
                "value": mem["percent"],
                "threshold": thresholds["memory"],
                "unit": "%",
                "level": "critical" if mem["percent"] >= 95 else "warning",
                "message": f"High Memory Usage: {mem['percent']}% ({mem.get('used_mb', 0)} MB / {mem.get('total_mb', 0)} MB, Threshold: {thresholds['memory']}%)"
            })

        disk = sample.get("disk", {})
        if "percent" in disk and disk["percent"] >= thresholds["disk"]:
            alerts.append({
                "resource": "disk",
                "value": disk["percent"],
                "threshold": thresholds["disk"],
                "unit": "%",
                "level": "critical" if disk["percent"] >= 95 else "warning",
                "message": f"High Disk Usage: {disk['percent']}% ({disk.get('used_gb', 0)} GB / {disk.get('total_gb', 0)} GB, Threshold: {thresholds['disk']}%)"
            })

        net = sample.get("network", {})
        if "total_kbps" in net and net["total_kbps"] >= thresholds["network"]:
            alerts.append({
                "resource": "network",
                "value": net["total_kbps"],
                "threshold": thresholds["network"],
                "unit": "KB/s",
                "level": "warning",
                "message": f"High Network Traffic: {net['total_kbps']} KB/s (Threshold: {thresholds['network']} KB/s)"
            })

        return alerts

    def check_and_notify(self, sample=None, notify_callback=None, now_sec=None) -> list:
        if now_sec is None:
            now_sec = time.time()

        alerts = self.check_thresholds(sample)
        triggered = []

        for alert in alerts:
            res = alert["resource"]
            last_time = self.last_notification_time.get(res, 0.0)
            if now_sec - last_time >= self.notification_cooldown_secs:
                self.last_notification_time[res] = now_sec
                triggered.append(alert)
                if callable(notify_callback):
                    title = f"CmdBar Alert: {res.upper()} High Usage"
                    notify_callback(title, alert["message"], alert)

        return triggered

    def format_metric_mini_graph(self, resource, sample=None, history=None) -> str:
        if sample is None:
            sample = self.get_latest_sample()
        if history is None:
            history = self.history
        if not sample:
            return f"{resource.upper()}: N/A"

        res = resource.lower()
        if res == "cpu":
            values = [s.get("cpu", {}).get("percent", 0.0) for s in history]
            sparkline = generate_sparkline(values, 0.0, 100.0)
            cpu_p = sample.get("cpu", {}).get("percent", 0.0)
            return f"CPU [{sparkline}] {cpu_p}%"
        elif res == "memory":
            values = [s.get("memory", {}).get("percent", 0.0) for s in history]
            sparkline = generate_sparkline(values, 0.0, 100.0)
            mem = sample.get("memory", {})
            return f"RAM [{sparkline}] {mem.get('percent', 0.0)}% ({mem.get('used_mb', 0)} / {mem.get('total_mb', 0)} MB)"
        elif res == "disk":
            values = [s.get("disk", {}).get("percent", 0.0) for s in history]
            sparkline = generate_sparkline(values, 0.0, 100.0)
            disk = sample.get("disk", {})
            return f"Disk [{sparkline}] {disk.get('percent', 0.0)}% ({disk.get('used_gb', 0)} / {disk.get('total_gb', 0)} GB)"
        elif res == "network":
            values = [s.get("network", {}).get("total_kbps", 0.0) for s in history]
            max_net = max([100.0] + values)
            sparkline = generate_sparkline(values, 0.0, max_net)
            net = sample.get("network", {})
            return f"Net [{sparkline}] ↓{net.get('rx_kbps', 0.0)} KB/s ↑{net.get('tx_kbps', 0.0)} KB/s"

        return f"{resource}: Unknown"

    def format_menu_summary(self, sample=None, history=None) -> str:
        if sample is None:
            sample = self.get_latest_sample()
        if history is None:
            history = self.history
        if not sample:
            return "System Monitor: Sampling..."

        cpu_str = self.format_metric_mini_graph("cpu", sample, history)
        mem_str = self.format_metric_mini_graph("memory", sample, history)
        disk_str = self.format_metric_mini_graph("disk", sample, history)
        net_str = self.format_metric_mini_graph("network", sample, history)

        return f"{cpu_str}\n{mem_str}\n{disk_str}\n{net_str}"

    def export_to_csv(self) -> str:
        return export_to_csv(self.history)

    def export_to_csv_file(self, file_path: str) -> bool:
        if not file_path:
            return False
        try:
            csv_data = self.export_to_csv()
            folder = os.path.dirname(os.path.abspath(file_path))
            if folder and not os.path.exists(folder):
                os.makedirs(folder, exist_ok=True)
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(csv_data)
            return True
        except Exception:
            return False
