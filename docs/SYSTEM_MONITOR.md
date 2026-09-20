# System Resource Monitors Specification

CmdBar provides live CPU, Memory, Disk, and Network monitoring with mini sparkline graphs in the top-bar dropdown menu, configurable warning/critical thresholds, desktop notifications on high usage, CSV export capabilities, and D-Bus integration.

---

## Overview & Architecture

System Resource Monitors runs non-blocking sampling of system metrics:
1. **CPU Usage**: Calculates active vs idle CPU time (0–100%).
2. **Memory Usage**: Reads memory consumption (`used_mb`, `total_mb`, `percent`).
3. **Disk Usage**: Reads storage utilisation on mounted filesystems (`used_gb`, `total_gb`, `percent`).
4. **Network Traffic**: Measures Rx and Tx transfer rates in KB/s.

Each snapshot is appended to a rolling history buffer (default size: 20 samples). Sparklines are dynamically generated using Unicode sparkline bar characters (` ▂▃▄▅▆▇█`).

---

## Mini Graphs in Dropdown Menu

Sparkline mini graphs provide real-time visual history directly in the CmdBar menu:

```text
CPU  [ ▂▃▅▆▇█] 78.5%
RAM  [██████░░] 62.0% (10.1 / 16.0 GB)
Disk [███████░] 75.0% (375.0 / 500.0 GB)
Net  [ ▂ ▃ ▅ █] ↓120.5 KB/s ↑45.0 KB/s
```

---

## Configurable Thresholds & High Usage Notifications

Resource thresholds trigger desktop notifications when resource usage breaches warning or critical limits:

| Resource | Default Threshold | Warning / Critical Level |
|----------|-------------------|--------------------------|
| **CPU** | `80%` | >= 80% Warning, >= 95% Critical |
| **Memory** | `80%` | >= 80% Warning, >= 95% Critical |
| **Disk** | `85%` | >= 85% Warning, >= 95% Critical |
| **Network** | `10240 KB/s` (10 MB/s) | >= Threshold Warning |

Notifications are throttled using a configurable cooldown timer (default: 60 seconds) per resource to avoid notification spam.

---

## CSV Export Format

Metric history can be exported to CSV format using `exportToCSV()` or saved to a file via `exportToCSVFile(filePath)` / D-Bus method `GetResourceMonitorCSV`.

### CSV Header & Sample Output:
```csv
timestamp,cpu_percent,memory_used_mb,memory_total_mb,memory_percent,disk_used_gb,disk_total_gb,disk_percent,net_rx_kbps,net_tx_kbps
2026-08-23T12:00:00.000Z,45.2,4096.0,16384.0,25.0,250.0,1000.0,25.0,120.5,45.0
```

---

## D-Bus API Methods & Signals

System Resource Monitors exposes D-Bus methods under interface `org.gnome.CmdBar`:

| D-Bus Member | Type | Signature | Description |
|--------------|------|-----------|-------------|
| `GetSystemMetrics` | Method | `out s` (JSON) | Retrieves current metrics snapshot, history, and active alerts as JSON string |
| `GetResourceMonitorCSV` | Method | `out s` | Retrieves metric history in CSV format |
| `SetResourceThresholds` | Method | `in s` (JSON), `out b` | Sets custom resource alert thresholds |
| `HighResourceUsageAlert` | Signal | `sdd` (resource, val, threshold) | Emitted when resource usage breaches threshold |

### CLI Example (`gdbus`):
```bash
# Get current system metrics and mini graph summary
gdbus call --session --dest org.gnome.CmdBar --object-path /org/gnome/CmdBar --method org.gnome.CmdBar.GetSystemMetrics

# Set custom CPU threshold to 90%
gdbus call --session --dest org.gnome.CmdBar --object-path /org/gnome/CmdBar --method org.gnome.CmdBar.SetResourceThresholds '{"cpu": 90}'

# Export metric history as CSV
gdbus call --session --dest org.gnome.CmdBar --object-path /org/gnome/CmdBar --method org.gnome.CmdBar.GetResourceMonitorCSV
```
