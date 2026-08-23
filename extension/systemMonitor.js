/**
 * System Resource Monitors module for CmdBar extension.
 * Live CPU, Memory, Disk, Network monitoring with sparklines,
 * configurable thresholds, notifications, and CSV export.
 */

import fs from "fs";
import path from "path";
import os from "os";

let Gio, GLib;
const isNode = typeof process !== "undefined" && process.versions && process.versions.node;

if (!isNode) {
  try {
    const gi = await import("gi");
    Gio = gi.Gio || (gi.default && gi.default.Gio) || gi.default;
    GLib = gi.GLib || (gi.default && gi.default.GLib);
  } catch (e) {}
}

export const DEFAULT_THRESHOLDS = {
  cpu: 80,         // %
  memory: 80,      // %
  disk: 85,        // %
  network: 10240,  // KB/s
};

const SPARKLINE_CHARS = [" ", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/**
 * Generates a unicode sparkline string from an array of numeric values.
 * @param {number[]} values
 * @param {number} [minVal=0]
 * @param {number} [maxVal=100]
 * @returns {string}
 */
export function generateSparkline(values, minVal = 0, maxVal = 100) {
  if (!Array.isArray(values) || values.length === 0) {
    return "";
  }
  const range = maxVal - minVal || 1;
  return values
    .map((val) => {
      const clamped = Math.max(minVal, Math.min(maxVal, Number(val) || 0));
      const normalized = (clamped - minVal) / range;
      const index = Math.min(
        SPARKLINE_CHARS.length - 1,
        Math.max(0, Math.floor(normalized * SPARKLINE_CHARS.length))
      );
      return SPARKLINE_CHARS[index];
    })
    .join("");
}

/**
 * Renders an ASCII/Unicode progress bar.
 * @param {number} percent
 * @param {number} [length=10]
 * @returns {string}
 */
export function renderProgressBar(percent, length = 10) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  const filled = Math.round((p / 100) * length);
  const empty = length - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  return `[${bar}] ${p.toFixed(1)}%`;
}

let lastCpuTimes = null;

/**
 * Collects CPU usage percentage (0 - 100%).
 * @returns {number}
 */
export function collectCpuUsage() {
  if (isNode && typeof os.cpus === "function") {
    const cpus = os.cpus();
    if (cpus && cpus.length > 0) {
      let totalUser = 0;
      let totalNice = 0;
      let totalSys = 0;
      let totalIdle = 0;
      let totalIrq = 0;

      cpus.forEach((cpu) => {
        totalUser += cpu.times.user;
        totalNice += cpu.times.nice;
        totalSys += cpu.times.sys;
        totalIdle += cpu.times.idle;
        totalIrq += cpu.times.irq || 0;
      });

      const currentTimes = {
        idle: totalIdle,
        total: totalUser + totalNice + totalSys + totalIdle + totalIrq,
      };

      if (!lastCpuTimes) {
        lastCpuTimes = currentTimes;
        const busy = totalUser + totalNice + totalSys;
        const total = currentTimes.total || 1;
        return Number(((busy / total) * 100).toFixed(1));
      }

      const idleDiff = currentTimes.idle - lastCpuTimes.idle;
      const totalDiff = currentTimes.total - lastCpuTimes.total;
      lastCpuTimes = currentTimes;

      if (totalDiff <= 0) return 0;
      const usage = ((totalDiff - idleDiff) / totalDiff) * 100;
      return Number(Math.max(0, Math.min(100, usage)).toFixed(1));
    }
  }

  // Fallback / Linux /proc/stat reading
  try {
    if (fs.existsSync("/proc/stat")) {
      const statContent = fs.readFileSync("/proc/stat", "utf8");
      const cpuLine = statContent.split("\n")[0];
      const parts = cpuLine.trim().split(/\s+/).slice(1).map(Number);
      if (parts.length >= 4) {
        const user = parts[0] || 0;
        const nice = parts[1] || 0;
        const system = parts[2] || 0;
        const idle = parts[3] || 0;
        const iowait = parts[4] || 0;
        const irq = parts[5] || 0;
        const softirq = parts[6] || 0;
        const steal = parts[7] || 0;

        const totalIdle = idle + iowait;
        const totalNonIdle = user + nice + system + irq + softirq + steal;
        const total = totalIdle + totalNonIdle;

        if (total > 0) {
          const usage = (totalNonIdle / total) * 100;
          return Number(usage.toFixed(1));
        }
      }
    }
  } catch (e) {}

  return 0;
}

/**
 * Collects memory usage statistics.
 * @returns {{ usedMb: number, totalMb: number, percent: number }}
 */
export function collectMemoryUsage() {
  if (isNode && typeof os.totalmem === "function" && typeof os.freemem === "function") {
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const usedBytes = totalBytes - freeBytes;
    const totalMb = Number((totalBytes / (1024 * 1024)).toFixed(1));
    const usedMb = Number((usedBytes / (1024 * 1024)).toFixed(1));
    const percent = totalBytes > 0 ? Number(((usedBytes / totalBytes) * 100).toFixed(1)) : 0;
    return { usedMb, totalMb, percent };
  }

  try {
    if (fs.existsSync("/proc/meminfo")) {
      const content = fs.readFileSync("/proc/meminfo", "utf8");
      let totalKb = 0;
      let freeKb = 0;
      let buffersKb = 0;
      let cachedKb = 0;
      let sReclaimableKb = 0;

      content.split("\n").forEach((line) => {
        if (line.startsWith("MemTotal:")) totalKb = parseInt(line.split(/\s+/)[1], 10) || 0;
        else if (line.startsWith("MemFree:")) freeKb = parseInt(line.split(/\s+/)[1], 10) || 0;
        else if (line.startsWith("Buffers:")) buffersKb = parseInt(line.split(/\s+/)[1], 10) || 0;
        else if (line.startsWith("Cached:")) cachedKb = parseInt(line.split(/\s+/)[1], 10) || 0;
        else if (line.startsWith("SReclaimable:")) sReclaimableKb = parseInt(line.split(/\s+/)[1], 10) || 0;
      });

      const actualFreeKb = freeKb + buffersKb + cachedKb + sReclaimableKb;
      const usedKb = Math.max(0, totalKb - actualFreeKb);
      const totalMb = Number((totalKb / 1024).toFixed(1));
      const usedMb = Number((usedKb / 1024).toFixed(1));
      const percent = totalKb > 0 ? Number(((usedKb / totalKb) * 100).toFixed(1)) : 0;

      return { usedMb, totalMb, percent };
    }
  } catch (e) {}

  return { usedMb: 0, totalMb: 1, percent: 0 };
}

/**
 * Collects disk usage statistics for specified mount path.
 * @param {string} [mountPath="/"]
 * @returns {{ usedGb: number, totalGb: number, percent: number }}
 */
export function collectDiskUsage(mountPath = "/") {
  if (isNode && typeof fs.statfsSync === "function") {
    try {
      const stats = fs.statfsSync(mountPath);
      const totalBytes = stats.blocks * stats.bsize;
      const freeBytes = stats.bfree * stats.bsize;
      const usedBytes = totalBytes - freeBytes;

      const totalGb = Number((totalBytes / (1024 * 1024 * 1024)).toFixed(1));
      const usedGb = Number((usedBytes / (1024 * 1024 * 1024)).toFixed(1));
      const percent = totalBytes > 0 ? Number(((usedBytes / totalBytes) * 100).toFixed(1)) : 0;
      return { usedGb, totalGb, percent };
    } catch (e) {}
  }

  // Fallback to df execution or mock values
  try {
    const { execSync } = require("child_process");
    const output = execSync(`df -k "${mountPath}"`, { encoding: "utf8" });
    const lines = output.trim().split("\n");
    if (lines.length >= 2) {
      const parts = lines[1].trim().split(/\s+/);
      const totalKb = parseInt(parts[1], 10) || 0;
      const usedKb = parseInt(parts[2], 10) || 0;
      const totalGb = Number((totalKb / (1024 * 1024)).toFixed(1));
      const usedGb = Number((usedKb / (1024 * 1024)).toFixed(1));
      const percent = totalKb > 0 ? Number(((usedKb / totalKb) * 100).toFixed(1)) : 0;
      return { usedGb, totalGb, percent };
    }
  } catch (e) {}

  return { usedGb: 0, totalGb: 1, percent: 0 };
}

let lastNetBytes = null;

/**
 * Collects network usage (Rx and Tx rate in KB/s).
 * @returns {{ rxKbps: number, txKbps: number, totalKbps: number }}
 */
export function collectNetworkUsage() {
  try {
    if (fs.existsSync("/proc/net/dev")) {
      const content = fs.readFileSync("/proc/net/dev", "utf8");
      let totalRxBytes = 0;
      let totalTxBytes = 0;

      const lines = content.split("\n");
      for (const line of lines) {
        if (!line.includes(":")) continue;
        const parts = line.trim().split(":");
        const iface = parts[0].trim();
        if (iface === "lo") continue; // Skip loopback

        const stats = parts[1].trim().split(/\s+/).map(Number);
        if (stats.length >= 9) {
          totalRxBytes += stats[0] || 0;
          totalTxBytes += stats[8] || 0;
        }
      }

      const now = Date.now();
      if (!lastNetBytes) {
        lastNetBytes = { rx: totalRxBytes, tx: totalTxBytes, time: now };
        return { rxKbps: 0, txKbps: 0, totalKbps: 0 };
      }

      const timeDiffSec = (now - lastNetBytes.time) / 1000 || 1;
      const rxDiff = Math.max(0, totalRxBytes - lastNetBytes.rx);
      const txDiff = Math.max(0, totalTxBytes - lastNetBytes.tx);

      lastNetBytes = { rx: totalRxBytes, tx: totalTxBytes, time: now };

      const rxKbps = Number((rxDiff / 1024 / timeDiffSec).toFixed(1));
      const txKbps = Number((txDiff / 1024 / timeDiffSec).toFixed(1));
      const totalKbps = Number((rxKbps + txKbps).toFixed(1));

      return { rxKbps, txKbps, totalKbps };
    }
  } catch (e) {}

  return { rxKbps: 0, txKbps: 0, totalKbps: 0 };
}

/**
 * Collects current system resource metrics snapshot.
 * @param {string} [mountPath="/"]
 * @returns {{ timestamp: number, cpu: { percent: number }, memory: { usedMb: number, totalMb: number, percent: number }, disk: { usedGb: number, totalGb: number, percent: number }, network: { rxKbps: number, txKbps: number, totalKbps: number } }}
 */
export function collectSystemMetrics(mountPath = "/") {
  return {
    timestamp: Date.now(),
    cpu: { percent: collectCpuUsage() },
    memory: collectMemoryUsage(),
    disk: collectDiskUsage(mountPath),
    network: collectNetworkUsage(),
  };
}

/**
 * Validates threshold options.
 * @param {object} thresholds
 * @returns {object}
 */
export function validateThresholds(thresholds = {}) {
  const result = { ...DEFAULT_THRESHOLDS };
  if (!thresholds || typeof thresholds !== "object") {
    return result;
  }

  if (typeof thresholds.cpu === "number" && thresholds.cpu >= 0 && thresholds.cpu <= 100) {
    result.cpu = thresholds.cpu;
  }
  if (typeof thresholds.memory === "number" && thresholds.memory >= 0 && thresholds.memory <= 100) {
    result.memory = thresholds.memory;
  }
  if (typeof thresholds.disk === "number" && thresholds.disk >= 0 && thresholds.disk <= 100) {
    result.disk = thresholds.disk;
  }
  if (typeof thresholds.network === "number" && thresholds.network >= 0) {
    result.network = thresholds.network;
  }

  return result;
}

/**
 * Converts metric history samples into CSV string format.
 * @param {object[]} history
 * @returns {string}
 */
export function exportToCSV(history = []) {
  const headers = [
    "timestamp",
    "cpu_percent",
    "memory_used_mb",
    "memory_total_mb",
    "memory_percent",
    "disk_used_gb",
    "disk_total_gb",
    "disk_percent",
    "net_rx_kbps",
    "net_tx_kbps",
  ];

  const rows = [headers.join(",")];

  if (Array.isArray(history)) {
    history.forEach((sample) => {
      if (!sample || typeof sample !== "object") return;
      const ts = new Date(sample.timestamp || Date.now()).toISOString();
      const cpu = sample.cpu?.percent ?? 0;
      const memUsed = sample.memory?.usedMb ?? 0;
      const memTotal = sample.memory?.totalMb ?? 0;
      const memPct = sample.memory?.percent ?? 0;
      const diskUsed = sample.disk?.usedGb ?? 0;
      const diskTotal = sample.disk?.totalGb ?? 0;
      const diskPct = sample.disk?.percent ?? 0;
      const netRx = sample.network?.rxKbps ?? 0;
      const netTx = sample.network?.txKbps ?? 0;

      rows.push(
        `${ts},${cpu},${memUsed},${memTotal},${memPct},${diskUsed},${diskTotal},${diskPct},${netRx},${netTx}`
      );
    });
  }

  return rows.join("\n");
}

/**
 * SystemMonitor class managing resource metric history, threshold alerts, notifications, and export.
 */
export class SystemMonitor {
  /**
   * @param {object} [options]
   * @param {number} [options.maxHistory=20]
   * @param {object} [options.thresholds]
   * @param {number} [options.notificationCooldownMs=60000]
   */
  constructor(options = {}) {
    this.maxHistory = options.maxHistory || 20;
    this.thresholds = validateThresholds(options.thresholds);
    this.notificationCooldownMs = options.notificationCooldownMs || 60000;
    this.history = [];
    this.lastNotificationTime = {
      cpu: 0,
      memory: 0,
      disk: 0,
      network: 0,
    };
  }

  /**
   * Updates configurable thresholds.
   * @param {object} newThresholds
   */
  setThresholds(newThresholds) {
    this.thresholds = validateThresholds({ ...this.thresholds, ...newThresholds });
    return this.thresholds;
  }

  /**
   * Gets current threshold settings.
   * @returns {object}
   */
  getThresholds() {
    return { ...this.thresholds };
  }

  /**
   * Records a metric sample in history.
   * @param {object} sample
   * @returns {object}
   */
  recordSample(sample) {
    if (!sample || typeof sample !== "object") {
      sample = collectSystemMetrics();
    }
    this.history.push(sample);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    return sample;
  }

  /**
   * Gets recorded history copy.
   * @returns {object[]}
   */
  getHistory() {
    return [...this.history];
  }

  /**
   * Clears metric history.
   */
  clearHistory() {
    this.history = [];
  }

  /**
   * Gets latest metric sample or null.
   * @returns {object|null}
   */
  getLatestSample() {
    if (this.history.length === 0) return null;
    return this.history[this.history.length - 1];
  }

  /**
   * Checks a sample against configured thresholds and returns active alerts.
   * @param {object} [sample]
   * @param {object} [customThresholds]
   * @returns {object[]}
   */
  checkThresholds(sample = this.getLatestSample(), customThresholds = this.thresholds) {
    if (!sample) return [];
    const thresholds = validateThresholds(customThresholds);
    const alerts = [];

    // CPU Check
    if (sample.cpu && typeof sample.cpu.percent === "number") {
      if (sample.cpu.percent >= thresholds.cpu) {
        alerts.push({
          resource: "cpu",
          value: sample.cpu.percent,
          threshold: thresholds.cpu,
          unit: "%",
          level: sample.cpu.percent >= 95 ? "critical" : "warning",
          message: `High CPU Usage: ${sample.cpu.percent}% (Threshold: ${thresholds.cpu}%)`,
        });
      }
    }

    // Memory Check
    if (sample.memory && typeof sample.memory.percent === "number") {
      if (sample.memory.percent >= thresholds.memory) {
        alerts.push({
          resource: "memory",
          value: sample.memory.percent,
          threshold: thresholds.memory,
          unit: "%",
          level: sample.memory.percent >= 95 ? "critical" : "warning",
          message: `High Memory Usage: ${sample.memory.percent}% (${sample.memory.usedMb} MB / ${sample.memory.totalMb} MB, Threshold: ${thresholds.memory}%)`,
        });
      }
    }

    // Disk Check
    if (sample.disk && typeof sample.disk.percent === "number") {
      if (sample.disk.percent >= thresholds.disk) {
        alerts.push({
          resource: "disk",
          value: sample.disk.percent,
          threshold: thresholds.disk,
          unit: "%",
          level: sample.disk.percent >= 95 ? "critical" : "warning",
          message: `High Disk Usage: ${sample.disk.percent}% (${sample.disk.usedGb} GB / ${sample.disk.totalGb} GB, Threshold: ${thresholds.disk}%)`,
        });
      }
    }

    // Network Check
    if (sample.network && typeof sample.network.totalKbps === "number") {
      if (sample.network.totalKbps >= thresholds.network) {
        alerts.push({
          resource: "network",
          value: sample.network.totalKbps,
          threshold: thresholds.network,
          unit: "KB/s",
          level: "warning",
          message: `High Network Traffic: ${sample.network.totalKbps} KB/s (Threshold: ${thresholds.network} KB/s)`,
        });
      }
    }

    return alerts;
  }

  /**
   * Checks thresholds and invokes notifyCallback for new alert triggers exceeding cooldown.
   * @param {object} [sample]
   * @param {function} [notifyCallback]
   * @param {number} [nowMs=Date.now()]
   * @returns {object[]}
   */
  checkAndNotify(sample = this.getLatestSample(), notifyCallback = null, nowMs = Date.now()) {
    const alerts = this.checkThresholds(sample);
    const triggered = [];

    alerts.forEach((alert) => {
      const lastTime = this.lastNotificationTime[alert.resource] || 0;
      if (nowMs - lastTime >= this.notificationCooldownMs) {
        this.lastNotificationTime[alert.resource] = nowMs;
        triggered.push(alert);
        if (typeof notifyCallback === "function") {
          const title = `CmdBar Alert: ${alert.resource.toUpperCase()} High Usage`;
          notifyCallback(title, alert.message, alert);
        }
      }
    });

    return triggered;
  }

  /**
   * Formats a mini graph string for specified resource metric.
   * @param {string} resource ('cpu'|'memory'|'disk'|'network')
   * @param {object} [sample]
   * @param {object[]} [history=this.history]
   * @returns {string}
   */
  formatMetricMiniGraph(resource, sample = this.getLatestSample(), history = this.history) {
    if (!sample) return `${resource.toUpperCase()}: N/A`;

    const res = resource.toLowerCase();
    if (res === "cpu") {
      const values = history.map((s) => s.cpu?.percent ?? 0);
      const sparkline = generateSparkline(values, 0, 100);
      return `CPU [${sparkline}] ${sample.cpu?.percent ?? 0}%`;
    } else if (res === "memory") {
      const values = history.map((s) => s.memory?.percent ?? 0);
      const sparkline = generateSparkline(values, 0, 100);
      const mem = sample.memory || { usedMb: 0, totalMb: 0, percent: 0 };
      return `RAM [${sparkline}] ${mem.percent}% (${mem.usedMb} / ${mem.totalMb} MB)`;
    } else if (res === "disk") {
      const values = history.map((s) => s.disk?.percent ?? 0);
      const sparkline = generateSparkline(values, 0, 100);
      const disk = sample.disk || { usedGb: 0, totalGb: 0, percent: 0 };
      return `Disk [${sparkline}] ${disk.percent}% (${disk.usedGb} / ${disk.totalGb} GB)`;
    } else if (res === "network") {
      const values = history.map((s) => s.network?.totalKbps ?? 0);
      const maxNet = Math.max(100, ...values);
      const sparkline = generateSparkline(values, 0, maxNet);
      const net = sample.network || { rxKbps: 0, txKbps: 0, totalKbps: 0 };
      return `Net [${sparkline}] ↓${net.rxKbps} KB/s ↑${net.txKbps} KB/s`;
    }

    return `${resource}: Unknown`;
  }

  /**
   * Formats complete menu summary string containing mini graphs for all resources.
   * @param {object} [sample]
   * @param {object[]} [history=this.history]
   * @returns {string}
   */
  formatMenuSummary(sample = this.getLatestSample(), history = this.history) {
    if (!sample) return "System Monitor: Sampling...";
    const cpuStr = this.formatMetricMiniGraph("cpu", sample, history);
    const memStr = this.formatMetricMiniGraph("memory", sample, history);
    const diskStr = this.formatMetricMiniGraph("disk", sample, history);
    const netStr = this.formatMetricMiniGraph("network", sample, history);

    return `${cpuStr}\n${memStr}\n${diskStr}\n${netStr}`;
  }

  /**
   * Formats recorded metric history into CSV string.
   * @returns {string}
   */
  exportToCSV() {
    return exportToCSV(this.history);
  }

  /**
   * Exports recorded history to CSV file asynchronously or synchronously.
   * @param {string} filePath
   * @returns {Promise<boolean>}
   */
  async exportToCSVFile(filePath) {
    if (!filePath) return false;
    const csvData = this.exportToCSV();

    if (isNode) {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, csvData, "utf8");
      return true;
    }

    if (Gio) {
      try {
        const file = Gio.File.new_for_path(filePath);
        const parent = file.get_parent();
        if (parent && !parent.query_exists(null)) {
          parent.make_directory_with_parents(null);
        }
        file.replace_contents(
          new TextEncoder().encode(csvData),
          null,
          false,
          Gio.FileCreateFlags.REPLACE_DESTINATION,
          null
        );
        return true;
      } catch (e) {
        console.error(`exportToCSVFile GJS error: ${e.message}`);
        return false;
      }
    }

    return false;
  }
}
