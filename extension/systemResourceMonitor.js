/**
 * System Resource Monitor module for CmdBar extension.
 * Handles live monitoring of CPU, Memory, Disk, and Network performance metrics,
 * rendering mini sparkline graphs, checking configurable thresholds,
 * firing high usage alerts/notifications, and exporting history metrics to CSV.
 */

import fs from "fs";

/**
 * Maps an array of numeric values (0 - 100%) to Unicode sparkline characters.
 * Bar characters: [' ', '▂', '▃', '▄', '▅', '▆', '▇', '█']
 *
 * @param {number[]} historyArray - Array of metric values
 * @param {number} [length=8] - Target length of the sparkline
 * @param {number} [maxVal=100] - Maximum scale value
 * @returns {string} Sparkline string
 */
export function renderSparkline(historyArray, length = 8, maxVal = 100) {
  if (!Array.isArray(historyArray) || historyArray.length === 0) {
    return " ".repeat(length);
  }

  const bars = [" ", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  let data = [...historyArray];

  if (data.length > length) {
    data = data.slice(data.length - length);
  }

  // If shorter than target length, pad left with empty space
  const padLength = length - data.length;
  const padding = " ".repeat(padLength);

  const effectiveMax = maxVal > 0 ? maxVal : 100;

  const renderedData = data
    .map((val) => {
      const num = typeof val === "number" && !isNaN(val) ? val : 0;
      const clamped = Math.max(0, Math.min(num, effectiveMax));
      const ratio = clamped / effectiveMax;
      const index = Math.min(
        bars.length - 1,
        Math.floor(ratio * bars.length)
      );
      return bars[index];
    })
    .join("");

  return padding + renderedData;
}

/**
 * Formats bytes to human-readable string (B, KB, MB, GB).
 * @param {number} bytes
 * @param {number} [decimals=1]
 * @returns {string}
 */
export function formatBytes(bytes, decimals = 1) {
  if (bytes === null || bytes === undefined || isNaN(bytes) || bytes <= 0) {
    return "0 B";
  }
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const idx = Math.min(sizes.length - 1, i);
  return parseFloat((bytes / Math.pow(k, idx)).toFixed(dm)) + " " + sizes[idx];
}

/**
 * Formats rate in bytes per second to human-readable string (e.g. "1.2 MB/s").
 * @param {number} bytesPerSec
 * @param {number} [decimals=1]
 * @returns {string}
 */
export function formatRate(bytesPerSec, decimals = 1) {
  return `${formatBytes(bytesPerSec, decimals)}/s`;
}

/**
 * Converts metric history samples array into CSV text.
 * @param {Array<Object>} history
 * @returns {string} CSV formatted string
 */
export function exportToCSVString(history) {
  const headers = [
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
  ];

  const rows = [headers.join(",")];

  if (Array.isArray(history)) {
    history.forEach((sample) => {
      const ts = sample.timestamp || new Date().toISOString();
      const cpu = sample.cpu ? sample.cpu.usagePercent.toFixed(1) : "0.0";
      const memUsed = sample.memory ? sample.memory.usedMB.toFixed(1) : "0.0";
      const memTotal = sample.memory ? sample.memory.totalMB.toFixed(1) : "0.0";
      const memPct = sample.memory ? sample.memory.usagePercent.toFixed(1) : "0.0";
      const diskUsed = sample.disk ? sample.disk.usedGB.toFixed(2) : "0.00";
      const diskTotal = sample.disk ? sample.disk.totalGB.toFixed(2) : "0.00";
      const diskPct = sample.disk ? sample.disk.usagePercent.toFixed(1) : "0.0";
      const netRx = sample.network ? sample.network.rxRateKBps.toFixed(1) : "0.0";
      const netTx = sample.network ? sample.network.txRateKBps.toFixed(1) : "0.0";

      rows.push(
        `"${ts}",${cpu},${memUsed},${memTotal},${memPct},${diskUsed},${diskTotal},${diskPct},${netRx},${netTx}`
      );
    });
  }

  return rows.join("\n");
}

export class SystemResourceMonitor {
  /**
   * @param {Object} [config={}]
   * @param {Object} [systemReader=null] - Optional injected system metrics reader
   */
  constructor(config = {}, systemReader = null) {
    this.config = {
      pollingInterval: 2000,
      maxHistoryLength: 20,
      cpuThreshold: 80,
      memoryThreshold: 85,
      diskThreshold: 90,
      networkThreshold: 5000, // KB/s total rate threshold
      notificationCooldown: 30000,
      onNotification: null,
      ...config,
    };

    this.systemReader = systemReader;
    this.history = [];
    this.lastNotified = {
      cpu: 0,
      memory: 0,
      disk: 0,
      network: 0,
    };

    this.prevCpuStat = null;
    this.prevNetStat = null;
    this.timerId = null;
    this.isPolling = false;
  }

  /**
   * Update configuration parameters dynamically.
   * @param {Object} newConfig
   */
  updateConfig(newConfig = {}) {
    this.config = {
      ...this.config,
      ...newConfig,
    };

    if (this.isPolling && newConfig.pollingInterval) {
      this.stop();
      this.start(this.config.pollingInterval);
    }
  }

  /**
   * Sets custom system metrics reader.
   * @param {Object} reader
   */
  setSystemReader(reader) {
    this.systemReader = reader;
  }

  /**
   * Starts periodic polling of system metrics.
   * @param {number} [intervalMs]
   */
  start(intervalMs) {
    if (intervalMs) {
      this.config.pollingInterval = intervalMs;
    }

    if (this.isPolling) {
      this.stop();
    }

    this.isPolling = true;
    // Initial immediate sample
    this.sampleMetrics();

    this.timerId = setInterval(() => {
      this.sampleMetrics();
    }, this.config.pollingInterval);
  }

  /**
   * Stops periodic polling.
   */
  stop() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.isPolling = false;
  }

  /**
   * Reads CPU usage percentage based on delta since last reading.
   * @returns {number} CPU usage percentage (0-100)
   */
  readCPUUsage() {
    if (this.systemReader && typeof this.systemReader.readCPU === "function") {
      return this.systemReader.readCPU();
    }

    try {
      if (fs.existsSync("/proc/stat")) {
        const statStr = fs.readFileSync("/proc/stat", "utf8");
        const cpuLine = statStr.split("\n")[0];
        if (cpuLine && cpuLine.startsWith("cpu ")) {
          const parts = cpuLine.trim().split(/\s+/).slice(1).map(Number);
          const user = parts[0] || 0;
          const nice = parts[1] || 0;
          const system = parts[2] || 0;
          const idle = parts[3] || 0;
          const iowait = parts[4] || 0;
          const irq = parts[5] || 0;
          const softirq = parts[6] || 0;
          const steal = parts[7] || 0;

          const currentIdle = idle + iowait;
          const currentTotal = user + nice + system + idle + iowait + irq + softirq + steal;

          if (this.prevCpuStat) {
            const idleDelta = currentIdle - this.prevCpuStat.idle;
            const totalDelta = currentTotal - this.prevCpuStat.total;

            this.prevCpuStat = { idle: currentIdle, total: currentTotal };

            if (totalDelta > 0) {
              const usage = (1 - idleDelta / totalDelta) * 100;
              return parseFloat(Math.max(0, Math.min(100, usage)).toFixed(1));
            }
          } else {
            this.prevCpuStat = { idle: currentIdle, total: currentTotal };
            return 0.0;
          }
        }
      }
    } catch (e) {}

    return 0.0;
  }

  /**
   * Reads memory total, used, free, and percentage usage.
   * @returns {Object} { totalMB, usedMB, freeMB, usagePercent }
   */
  readMemoryUsage() {
    if (this.systemReader && typeof this.systemReader.readMemory === "function") {
      return this.systemReader.readMemory();
    }

    try {
      if (fs.existsSync("/proc/meminfo")) {
        const memStr = fs.readFileSync("/proc/meminfo", "utf8");
        let totalKB = 0;
        let freeKB = 0;
        let availKB = 0;
        let buffersKB = 0;
        let cachedKB = 0;

        memStr.split("\n").forEach((line) => {
          if (line.startsWith("MemTotal:")) {
            totalKB = parseInt(line.replace(/[^0-9]/g, ""), 10) || 0;
          } else if (line.startsWith("MemFree:")) {
            freeKB = parseInt(line.replace(/[^0-9]/g, ""), 10) || 0;
          } else if (line.startsWith("MemAvailable:")) {
            availKB = parseInt(line.replace(/[^0-9]/g, ""), 10) || 0;
          } else if (line.startsWith("Buffers:")) {
            buffersKB = parseInt(line.replace(/[^0-9]/g, ""), 10) || 0;
          } else if (line.startsWith("Cached:")) {
            cachedKB = parseInt(line.replace(/[^0-9]/g, ""), 10) || 0;
          }
        });

        if (totalKB > 0) {
          const usedKB = availKB > 0
            ? totalKB - availKB
            : totalKB - freeKB - buffersKB - cachedKB;

          const totalMB = totalKB / 1024;
          const usedMB = usedKB / 1024;
          const freeMB = (availKB > 0 ? availKB : freeKB) / 1024;
          const usagePercent = parseFloat(((usedKB / totalKB) * 100).toFixed(1));

          return { totalMB, usedMB, freeMB, usagePercent };
        }
      }
    } catch (e) {}

    return { totalMB: 8192, usedMB: 2048, freeMB: 6144, usagePercent: 25.0 };
  }

  /**
   * Reads disk space totals and percentage usage for root or given path.
   * @param {string} [mountPath="/"]
   * @returns {Object} { totalGB, usedGB, freeGB, usagePercent }
   */
  readDiskUsage(mountPath = "/") {
    if (this.systemReader && typeof this.systemReader.readDisk === "function") {
      return this.systemReader.readDisk(mountPath);
    }

    try {
      if (typeof fs.statfsSync === "function") {
        const stats = fs.statfsSync(mountPath);
        const total = stats.bsize * stats.blocks;
        const free = stats.bsize * stats.bfree;
        const used = total - free;

        if (total > 0) {
          const totalGB = total / (1024 * 1024 * 1024);
          const usedGB = used / (1024 * 1024 * 1024);
          const freeGB = free / (1024 * 1024 * 1024);
          const usagePercent = parseFloat(((used / total) * 100).toFixed(1));

          return { totalGB, usedGB, freeGB, usagePercent };
        }
      }
    } catch (e) {}

    return { totalGB: 250.0, usedGB: 100.0, freeGB: 150.0, usagePercent: 40.0 };
  }

  /**
   * Reads network Rx and Tx rates in KB/s.
   * @returns {Object} { rxBytes, txBytes, rxRateKBps, txRateKBps, totalRateKBps }
   */
  readNetworkUsage() {
    if (this.systemReader && typeof this.systemReader.readNetwork === "function") {
      return this.systemReader.readNetwork();
    }

    const now = Date.now();

    try {
      if (fs.existsSync("/proc/net/dev")) {
        const devStr = fs.readFileSync("/proc/net/dev", "utf8");
        const lines = devStr.split("\n");
        let totalRx = 0;
        let totalTx = 0;

        lines.forEach((line) => {
          if (!line.includes(":") || line.trim().startsWith("lo:")) return;
          const parts = line.split(":")[1].trim().split(/\s+/);
          if (parts.length >= 9) {
            const rx = parseInt(parts[0], 10) || 0;
            const tx = parseInt(parts[8], 10) || 0;
            totalRx += rx;
            totalTx += tx;
          }
        });

        if (this.prevNetStat) {
          const timeDeltaSec = (now - this.prevNetStat.timestamp) / 1000;
          if (timeDeltaSec > 0) {
            const rxDeltaBytes = Math.max(0, totalRx - this.prevNetStat.rxBytes);
            const txDeltaBytes = Math.max(0, totalTx - this.prevNetStat.txBytes);

            const rxRateKBps = parseFloat(((rxDeltaBytes / 1024) / timeDeltaSec).toFixed(1));
            const txRateKBps = parseFloat(((txDeltaBytes / 1024) / timeDeltaSec).toFixed(1));
            const totalRateKBps = parseFloat((rxRateKBps + txRateKBps).toFixed(1));

            this.prevNetStat = { rxBytes: totalRx, txBytes: totalTx, timestamp: now };

            return {
              rxBytes: totalRx,
              txBytes: totalTx,
              rxRateKBps,
              txRateKBps,
              totalRateKBps,
            };
          }
        }

        this.prevNetStat = { rxBytes: totalRx, txBytes: totalTx, timestamp: now };
        return {
          rxBytes: totalRx,
          txBytes: totalTx,
          rxRateKBps: 0.0,
          txRateKBps: 0.0,
          totalRateKBps: 0.0,
        };
      }
    } catch (e) {}

    return {
      rxBytes: 0,
      txBytes: 0,
      rxRateKBps: 0.0,
      txRateKBps: 0.0,
      totalRateKBps: 0.0,
    };
  }

  /**
   * Collects current system resource snapshot and updates history buffer.
   * Checks usage against configured alert thresholds.
   * @returns {Object} Sample object
   */
  sampleMetrics() {
    const cpuUsage = this.readCPUUsage();
    const memUsage = this.readMemoryUsage();
    const diskUsage = this.readDiskUsage();
    const netUsage = this.readNetworkUsage();

    const sample = {
      timestamp: new Date().toISOString(),
      cpu: { usagePercent: cpuUsage },
      memory: memUsage,
      disk: diskUsage,
      network: netUsage,
    };

    this.history.push(sample);
    if (this.history.length > this.config.maxHistoryLength) {
      this.history.shift();
    }

    this.checkThresholds(sample);

    return sample;
  }

  /**
   * Checks resource usage against configured thresholds and fires notifications.
   * @param {Object} sample
   * @returns {Array<Object>} List of triggered alert objects
   */
  checkThresholds(sample) {
    if (!sample) return [];

    const now = Date.now();
    const alerts = [];

    // 1. CPU Threshold Check
    if (
      typeof sample.cpu?.usagePercent === "number" &&
      sample.cpu.usagePercent >= this.config.cpuThreshold
    ) {
      if (now - this.lastNotified.cpu >= this.config.notificationCooldown) {
        this.lastNotified.cpu = now;
        alerts.push({
          metric: "cpu",
          value: sample.cpu.usagePercent,
          threshold: this.config.cpuThreshold,
          title: "High CPU Usage Alert",
          message: `CPU usage reached ${sample.cpu.usagePercent}% (Threshold: ${this.config.cpuThreshold}%)`,
          timestamp: sample.timestamp,
        });
      }
    }

    // 2. Memory Threshold Check
    if (
      typeof sample.memory?.usagePercent === "number" &&
      sample.memory.usagePercent >= this.config.memoryThreshold
    ) {
      if (now - this.lastNotified.memory >= this.config.notificationCooldown) {
        this.lastNotified.memory = now;
        alerts.push({
          metric: "memory",
          value: sample.memory.usagePercent,
          threshold: this.config.memoryThreshold,
          title: "High Memory Usage Alert",
          message: `Memory usage reached ${sample.memory.usagePercent}% (Threshold: ${this.config.memoryThreshold}%)`,
          timestamp: sample.timestamp,
        });
      }
    }

    // 3. Disk Threshold Check
    if (
      typeof sample.disk?.usagePercent === "number" &&
      sample.disk.usagePercent >= this.config.diskThreshold
    ) {
      if (now - this.lastNotified.disk >= this.config.notificationCooldown) {
        this.lastNotified.disk = now;
        alerts.push({
          metric: "disk",
          value: sample.disk.usagePercent,
          threshold: this.config.diskThreshold,
          title: "High Disk Usage Alert",
          message: `Disk usage reached ${sample.disk.usagePercent}% (Threshold: ${this.config.diskThreshold}%)`,
          timestamp: sample.timestamp,
        });
      }
    }

    // 4. Network Threshold Check
    const netRate = sample.network?.totalRateKBps || 0;
    if (netRate >= this.config.networkThreshold) {
      if (now - this.lastNotified.network >= this.config.notificationCooldown) {
        this.lastNotified.network = now;
        alerts.push({
          metric: "network",
          value: netRate,
          threshold: this.config.networkThreshold,
          title: "High Network Activity Alert",
          message: `Network transfer rate reached ${netRate} KB/s (Threshold: ${this.config.networkThreshold} KB/s)`,
          timestamp: sample.timestamp,
        });
      }
    }

    // Dispatch alerts via callback
    if (alerts.length > 0 && typeof this.config.onNotification === "function") {
      alerts.forEach((alert) => {
        try {
          this.config.onNotification(alert);
        } catch (e) {
          console.error(`CmdBar SystemResourceMonitor alert notification callback error: ${e.message}`);
        }
      });
    }

    return alerts;
  }

  /**
   * Generates sparkline mini graph string for specified metric.
   * @param {'cpu'|'memory'|'disk'|'networkRx'|'networkTx'|'networkTotal'} metricName
   * @param {number} [length=8]
   * @returns {string} Sparkline string
   */
  getSparkline(metricName, length = 8) {
    let data = [];
    let maxVal = 100;

    switch (metricName) {
      case "cpu":
        data = this.history.map((s) => s.cpu?.usagePercent || 0);
        maxVal = 100;
        break;
      case "memory":
        data = this.history.map((s) => s.memory?.usagePercent || 0);
        maxVal = 100;
        break;
      case "disk":
        data = this.history.map((s) => s.disk?.usagePercent || 0);
        maxVal = 100;
        break;
      case "networkRx":
        data = this.history.map((s) => s.network?.rxRateKBps || 0);
        maxVal = Math.max(...data, this.config.networkThreshold || 1000, 10);
        break;
      case "networkTx":
        data = this.history.map((s) => s.network?.txRateKBps || 0);
        maxVal = Math.max(...data, this.config.networkThreshold || 1000, 10);
        break;
      case "networkTotal":
        data = this.history.map((s) => s.network?.totalRateKBps || 0);
        maxVal = Math.max(...data, this.config.networkThreshold || 1000, 10);
        break;
      default:
        data = [];
    }

    return renderSparkline(data, length, maxVal);
  }

  /**
   * Returns latest metric sample or null if no samples available.
   * @returns {Object|null}
   */
  getLatestMetrics() {
    if (this.history.length === 0) return null;
    return this.history[this.history.length - 1];
  }

  /**
   * Returns full history buffer.
   * @returns {Array<Object>}
   */
  getHistory() {
    return this.history;
  }

  /**
   * Exports history records to CSV formatted string.
   * @param {Array<Object>} [customHistory=null]
   * @returns {string} CSV content
   */
  exportToCSV(customHistory = null) {
    const dataToExport = customHistory || this.history;
    return exportToCSVString(dataToExport);
  }

  /**
   * Exports history records to a file on disk.
   * @param {string} filePath
   * @param {Array<Object>} [customHistory=null]
   * @returns {boolean} True if write succeeded
   */
  exportToCSVFile(filePath, customHistory = null) {
    if (!filePath) return false;
    try {
      const csvContent = this.exportToCSV(customHistory);
      fs.writeFileSync(filePath, csvContent, "utf8");
      return true;
    } catch (e) {
      console.error(`Failed to export metrics to CSV file ${filePath}: ${e.message}`);
      return false;
    }
  }
}
