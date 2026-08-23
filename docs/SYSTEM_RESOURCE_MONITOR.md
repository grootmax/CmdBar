# System Resource Monitors

CmdBar provides real-time system performance monitoring integrated directly into the GNOME Shell status area menu and accessible via D-Bus and Python companion utilities.

## Overview

The **System Resource Monitor** feature delivers live tracking for key hardware resources:
- **CPU Usage (%)**: Sampled via `/proc/stat` deltas over polling intervals.
- **Memory Usage (%)**: Tracks total, used, and available system RAM via `/proc/meminfo`.
- **Disk Usage (%)**: Tracks mounted filesystem capacity and usage for root and target partitions.
- **Network Bandwidth (KB/s)**: Calculates real-time Rx/Tx network throughput from `/proc/net/dev`.

---

## Features

### 1. Mini Sparkline Graphs
Visual sparkline mini graphs rendered with Unicode block elements (` `, `▂`, `▃`, `▄`, `▅`, `▆`, `▇`, `█`) display historical usage trends directly within the indicator popup menu:
```text
CPU: 42.5% [ ▂▄▅▇█]
Mem: 8.2G/16.0G (51.2%) [ ▂▃▅]
Disk: 120.0G/250.0G (48.0%) [▂▃▄]
Net: Rx 120.5 KB/s | Tx 45.2 KB/s [  ▃▅█]
```

### 2. Configurable Thresholds & Notifications
Set custom warning thresholds for system resource consumption. When consumption crosses configured limits, CmdBar emits desktop notifications with configurable cooldown throttling to prevent alert spam:
- **CPU Threshold**: Default `80%`
- **Memory Threshold**: Default `85%`
- **Disk Threshold**: Default `90%`
- **Network Threshold**: Default `5000 KB/s`
- **Notification Cooldown**: Default `30000 ms` (30 seconds)

### 3. CSV Export
Export recorded metric history to standard CSV files (`~/.config/cmdbar/resource_metrics.csv`) or via D-Bus API for offline analysis and reporting:
```csv
Timestamp,CPU (%),Memory Used (MB),Memory Total (MB),Memory (%),Disk Used (GB),Disk Total (GB),Disk (%),Network Rx (KB/s),Network Tx (KB/s)
"2026-08-23T12:00:00.000Z",42.5,8388.6,16384.0,51.2,120.00,250.00,48.0,120.5,45.2
```

### 4. D-Bus Integration
Access resource metrics programmatically via D-Bus on Session Bus under bus name `org.gnome.CmdBar`:
```bash
gdbus call --session --dest org.gnome.CmdBar --object-path /org/gnome/CmdBar --method org.gnome.CmdBar.GetResourceMetrics
```

Python Client bindings:
```python
from companion.dbus_client import CmdBarDBusClient

client = CmdBarDBusClient()
metrics = client.get_resource_metrics()
print("CPU Usage:", metrics["cpu"]["usagePercent"])
print("Sparkline:", metrics["sparklines"]["cpu"])
```
