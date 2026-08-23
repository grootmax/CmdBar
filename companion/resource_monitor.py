#!/usr/bin/env python3
"""
System Resource Monitor module for CmdBar Python companion.
Provides CPU, Memory, Disk, and Network monitoring, sparklines generation,
configurable alert thresholds, and CSV export.
"""

import os
import time
import json
import math
from datetime import datetime


def render_sparkline(history_list, length=8, max_val=100):
    """
    Maps a list of numbers to Unicode sparkline characters.
    """
    if not history_list or not isinstance(history_list, list):
        return " " * length

    bars = [" ", "▂", "▃", "▄", "▅", "▆", "▇", "█"]
    data = list(history_list)

    if len(data) > length:
        data = data[-length:]

    pad = " " * (length - len(data))
    eff_max = max_val if max_val > 0 else 100

    rendered = []
    for val in data:
        try:
            num = float(val)
        except (ValueError, TypeError):
            num = 0.0
        clamped = max(0.0, min(num, float(eff_max)))
        ratio = clamped / float(eff_max)
        idx = min(len(bars) - 1, int(ratio * len(bars)))
        rendered.append(bars[idx])

    return pad + "".join(rendered)


def format_bytes(bytes_num, decimals=1):
    """
    Format bytes to human readable string (B, KB, MB, GB).
    """
    if bytes_num is None or bytes_num <= 0:
        return "0 B"
    k = 1024
    sizes = ["B", "KB", "MB", "GB", "TB"]
    i = int(math.floor(math.log(bytes_num, k))) if bytes_num > 0 else 0
    idx = min(len(sizes) - 1, i)
    val = round(bytes_num / (k**idx), decimals)
    return f"{val} {sizes[idx]}"


def export_to_csv_string(history):
    """
    Converts metrics history list into CSV string.
    """
    headers = [
        "Timestamp",
        "CPU (%)",
        "Memory Used (MB)",
        "Memory Total (MB)",
        "Memory (%)",
        "Disk Used (GB)",
        "Disk Total (GB)",
        "Disk (%)",
        "Network Rx (KB/s)",
        "Network Tx (KB/s)",
    ]
    rows = [",".join(headers)]

    if isinstance(history, list):
        for sample in history:
            ts = sample.get("timestamp", datetime.now().isoformat())
            cpu = f"{sample.get('cpu', {}).get('usagePercent', 0.0):.1f}"
            mem = sample.get("memory", {})
            mem_used = f"{mem.get('usedMB', 0.0):.1f}"
            mem_total = f"{mem.get('totalMB', 0.0):.1f}"
            mem_pct = f"{mem.get('usagePercent', 0.0):.1f}"
            disk = sample.get("disk", {})
            disk_used = f"{disk.get('usedGB', 0.0):.2f}"
            disk_total = f"{disk.get('totalGB', 0.0):.2f}"
            disk_pct = f"{disk.get('usagePercent', 0.0):.1f}"
            net = sample.get("network", {})
            net_rx = f"{net.get('rxRateKBps', 0.0):.1f}"
            net_tx = f"{net.get('txRateKBps', 0.0):.1f}"

            rows.append(
                f'"{ts}",{cpu},{mem_used},{mem_total},{mem_pct},{disk_used},{disk_total},{disk_pct},{net_rx},{net_tx}'
            )

    return "\n".join(rows)


class SystemResourceMonitor:
    def __init__(self, config=None, system_reader=None):
        self.config = {
            "polling_interval": 2.0,
            "max_history_length": 20,
            "cpu_threshold": 80.0,
            "memory_threshold": 85.0,
            "disk_threshold": 90.0,
            "network_threshold": 5000.0,
            "notification_cooldown": 30.0,
        }
        if config:
            self.config.update(config)

        self.system_reader = system_reader
        self.history = []
        self.last_notified = {
            "cpu": 0.0,
            "memory": 0.0,
            "disk": 0.0,
            "network": 0.0,
        }
        self._prev_cpu_stat = None
        self._prev_net_stat = None

    def update_config(self, new_config):
        if new_config:
            self.config.update(new_config)

    def read_cpu_usage(self):
        if self.system_reader and hasattr(self.system_reader, "read_cpu"):
            return self.system_reader.read_cpu()

        try:
            if os.path.exists("/proc/stat"):
                with open("/proc/stat", "r") as f:
                    line = f.readline()
                if line.startswith("cpu "):
                    parts = [float(x) for x in line.split()[1:]]
                    user, nice, system, idle = parts[0], parts[1], parts[2], parts[3]
                    iowait = parts[4] if len(parts) > 4 else 0.0
                    irq = parts[5] if len(parts) > 5 else 0.0
                    softirq = parts[6] if len(parts) > 6 else 0.0
                    steal = parts[7] if len(parts) > 7 else 0.0

                    curr_idle = idle + iowait
                    curr_total = (
                        user + nice + system + idle + iowait + irq + softirq + steal
                    )

                    if self._prev_cpu_stat:
                        idle_delta = curr_idle - self._prev_cpu_stat["idle"]
                        total_delta = curr_total - self._prev_cpu_stat["total"]
                        self._prev_cpu_stat = {"idle": curr_idle, "total": curr_total}
                        if total_delta > 0:
                            usage = (1.0 - (idle_delta / total_delta)) * 100.0
                            return round(max(0.0, min(100.0, usage)), 1)
                    else:
                        self._prev_cpu_stat = {"idle": curr_idle, "total": curr_total}
                        return 0.0
        except Exception:
            pass

        return 0.0

    def read_memory_usage(self):
        if self.system_reader and hasattr(self.system_reader, "read_memory"):
            return self.system_reader.read_memory()

        try:
            if os.path.exists("/proc/meminfo"):
                total_kb, avail_kb, free_kb, buffers_kb, cached_kb = 0, 0, 0, 0, 0
                with open("/proc/meminfo", "r") as f:
                    for line in f:
                        if line.startswith("MemTotal:"):
                            total_kb = int("".join(filter(str.isdigit, line)))
                        elif line.startswith("MemAvailable:"):
                            avail_kb = int("".join(filter(str.isdigit, line)))
                        elif line.startswith("MemFree:"):
                            free_kb = int("".join(filter(str.isdigit, line)))
                        elif line.startswith("Buffers:"):
                            buffers_kb = int("".join(filter(str.isdigit, line)))
                        elif line.startswith("Cached:"):
                            cached_kb = int("".join(filter(str.isdigit, line)))

                if total_kb > 0:
                    used_kb = (
                        total_kb - avail_kb
                        if avail_kb > 0
                        else total_kb - free_kb - buffers_kb - cached_kb
                    )
                    total_mb = total_kb / 1024.0
                    used_mb = used_kb / 1024.0
                    free_mb = (avail_kb if avail_kb > 0 else free_kb) / 1024.0
                    usage_pct = round((used_kb / total_kb) * 100.0, 1)
                    return {
                        "totalMB": round(total_mb, 1),
                        "usedMB": round(used_mb, 1),
                        "freeMB": round(free_mb, 1),
                        "usagePercent": usage_pct,
                    }
        except Exception:
            pass

        return {
            "totalMB": 8192.0,
            "usedMB": 2048.0,
            "freeMB": 6144.0,
            "usagePercent": 25.0,
        }

    def read_disk_usage(self, path="/"):
        if self.system_reader and hasattr(self.system_reader, "read_disk"):
            return self.system_reader.read_disk(path)

        try:
            stat = os.statvfs(path)
            total = stat.f_blocks * stat.f_frsize
            free = stat.f_bfree * stat.f_frsize
            used = total - free
            if total > 0:
                total_gb = total / (1024.0**3)
                used_gb = used / (1024.0**3)
                free_gb = free / (1024.0**3)
                usage_pct = round((used / total) * 100.0, 1)
                return {
                    "totalGB": round(total_gb, 2),
                    "usedGB": round(used_gb, 2),
                    "freeGB": round(free_gb, 2),
                    "usagePercent": usage_pct,
                }
        except Exception:
            pass

        return {
            "totalGB": 250.0,
            "usedGB": 100.0,
            "freeGB": 150.0,
            "usagePercent": 40.0,
        }

    def read_network_usage(self):
        if self.system_reader and hasattr(self.system_reader, "read_network"):
            return self.system_reader.read_network()

        now = time.time()
        try:
            if os.path.exists("/proc/net/dev"):
                total_rx, total_tx = 0, 0
                with open("/proc/net/dev", "r") as f:
                    for line in f:
                        if ":" in line and not line.strip().startswith("lo:"):
                            parts = line.split(":")[1].split()
                            if len(parts) >= 9:
                                total_rx += int(parts[0])
                                total_tx += int(parts[8])

                if self._prev_net_stat:
                    time_delta = now - self._prev_net_stat["timestamp"]
                    if time_delta > 0:
                        rx_delta = max(0, total_rx - self._prev_net_stat["rx_bytes"])
                        tx_delta = max(0, total_tx - self._prev_net_stat["tx_bytes"])
                        rx_rate = round((rx_delta / 1024.0) / time_delta, 1)
                        tx_rate = round((tx_delta / 1024.0) / time_delta, 1)
                        tot_rate = round(rx_rate + tx_rate, 1)

                        self._prev_net_stat = {
                            "rx_bytes": total_rx,
                            "tx_bytes": total_tx,
                            "timestamp": now,
                        }
                        return {
                            "rxBytes": total_rx,
                            "txBytes": total_tx,
                            "rxRateKBps": rx_rate,
                            "txRateKBps": tx_rate,
                            "totalRateKBps": tot_rate,
                        }

                self._prev_net_stat = {
                    "rx_bytes": total_rx,
                    "tx_bytes": total_tx,
                    "timestamp": now,
                }
                return {
                    "rxBytes": total_rx,
                    "txBytes": total_tx,
                    "rxRateKBps": 0.0,
                    "txRateKBps": 0.0,
                    "totalRateKBps": 0.0,
                }
        except Exception:
            pass

        return {
            "rxBytes": 0,
            "txBytes": 0,
            "rxRateKBps": 0.0,
            "txRateKBps": 0.0,
            "totalRateKBps": 0.0,
        }

    def sample_metrics(self):
        cpu = self.read_cpu_usage()
        mem = self.read_memory_usage()
        disk = self.read_disk_usage()
        net = self.read_network_usage()

        sample = {
            "timestamp": datetime.now().isoformat(),
            "cpu": {"usagePercent": cpu},
            "memory": mem,
            "disk": disk,
            "network": net,
        }

        self.history.append(sample)
        if len(self.history) > self.config.get("max_history_length", 20):
            self.history.pop(0)

        self.check_thresholds(sample)
        return sample

    def check_thresholds(self, sample):
        if not sample:
            return []

        now = time.time()
        cooldown = float(self.config.get("notification_cooldown", 30.0))
        alerts = []

        cpu_val = sample.get("cpu", {}).get("usagePercent", 0.0)
        cpu_thresh = float(self.config.get("cpu_threshold", 80.0))
        if cpu_val >= cpu_thresh:
            if now - self.last_notified["cpu"] >= cooldown:
                self.last_notified["cpu"] = now
                alerts.append(
                    {
                        "metric": "cpu",
                        "value": cpu_val,
                        "threshold": cpu_thresh,
                        "title": "High CPU Usage Alert",
                        "message": f"CPU usage reached {cpu_val}% (Threshold: {cpu_thresh}%)",
                    }
                )

        mem_val = sample.get("memory", {}).get("usagePercent", 0.0)
        mem_thresh = float(self.config.get("memory_threshold", 85.0))
        if mem_val >= mem_thresh:
            if now - self.last_notified["memory"] >= cooldown:
                self.last_notified["memory"] = now
                alerts.append(
                    {
                        "metric": "memory",
                        "value": mem_val,
                        "threshold": mem_thresh,
                        "title": "High Memory Usage Alert",
                        "message": f"Memory usage reached {mem_val}% (Threshold: {mem_thresh}%)",
                    }
                )

        disk_val = sample.get("disk", {}).get("usagePercent", 0.0)
        disk_thresh = float(self.config.get("disk_threshold", 90.0))
        if disk_val >= disk_thresh:
            if now - self.last_notified["disk"] >= cooldown:
                self.last_notified["disk"] = now
                alerts.append(
                    {
                        "metric": "disk",
                        "value": disk_val,
                        "threshold": disk_thresh,
                        "title": "High Disk Usage Alert",
                        "message": f"Disk usage reached {disk_val}% (Threshold: {disk_thresh}%)",
                    }
                )

        net_val = sample.get("network", {}).get("totalRateKBps", 0.0)
        net_thresh = float(self.config.get("network_threshold", 5000.0))
        if net_val >= net_thresh:
            if now - self.last_notified["network"] >= cooldown:
                self.last_notified["network"] = now
                alerts.append(
                    {
                        "metric": "network",
                        "value": net_val,
                        "threshold": net_thresh,
                        "title": "High Network Activity Alert",
                        "message": f"Network rate reached {net_val} KB/s (Threshold: {net_thresh} KB/s)",
                    }
                )

        return alerts

    def get_sparkline(self, metric_name, length=8):
        data = []
        max_val = 100.0

        if metric_name == "cpu":
            data = [s.get("cpu", {}).get("usagePercent", 0.0) for s in self.history]
        elif metric_name == "memory":
            data = [s.get("memory", {}).get("usagePercent", 0.0) for s in self.history]
        elif metric_name == "disk":
            data = [s.get("disk", {}).get("usagePercent", 0.0) for s in self.history]
        elif metric_name in ("network", "networkTotal"):
            data = [
                s.get("network", {}).get("totalRateKBps", 0.0) for s in self.history
            ]
            max_val = max(data) if data else 1000.0
            max_val = max(
                max_val, float(self.config.get("network_threshold", 1000.0)), 10.0
            )

        return render_sparkline(data, length=length, max_val=max_val)

    def export_to_csv(self, filepath):
        content = export_to_csv_string(self.history)
        if filepath:
            try:
                os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)
                with open(filepath, "w") as f:
                    f.write(content)
                return True
            except Exception:
                return False
        return content

    def get_metrics_dict(self):
        latest = self.history[-1] if self.history else {}
        return {
            "cpu": latest.get("cpu", {"usagePercent": 0.0}),
            "memory": latest.get(
                "memory",
                {"totalMB": 0.0, "usedMB": 0.0, "freeMB": 0.0, "usagePercent": 0.0},
            ),
            "disk": latest.get(
                "disk",
                {"totalGB": 0.0, "usedGB": 0.0, "freeGB": 0.0, "usagePercent": 0.0},
            ),
            "network": latest.get(
                "network",
                {
                    "rxBytes": 0,
                    "txBytes": 0,
                    "rxRateKBps": 0.0,
                    "txRateKBps": 0.0,
                    "totalRateKBps": 0.0,
                },
            ),
            "sparklines": {
                "cpu": self.get_sparkline("cpu"),
                "memory": self.get_sparkline("memory"),
                "disk": self.get_sparkline("disk"),
                "network": self.get_sparkline("networkTotal"),
            },
            "history": self.history,
        }
