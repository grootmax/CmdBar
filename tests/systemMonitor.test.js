import fs from "fs";
import path from "path";
import os from "os";

import {
  DEFAULT_THRESHOLDS,
  generateSparkline,
  renderProgressBar,
  collectCpuUsage,
  collectMemoryUsage,
  collectDiskUsage,
  collectNetworkUsage,
  collectSystemMetrics,
  validateThresholds,
  exportToCSV,
  SystemMonitor,
} from "../extension/systemMonitor.js";

import { CmdBarDBusService } from "../extension/dbusService.js";

describe("System Resource Monitors Module Tests", () => {
  describe("Sparklines & Mini Graphs Generation", () => {
    test("should handle empty or invalid arrays in generateSparkline", () => {
      expect(generateSparkline([])).toBe("");
      expect(generateSparkline(null)).toBe("");
      expect(generateSparkline(undefined)).toBe("");
    });

    test("should generate correct sparkline characters across value ranges", () => {
      const values = [0, 25, 50, 75, 100];
      const sparkline = generateSparkline(values, 0, 100);
      expect(sparkline.length).toBe(5);
      expect(sparkline[0]).toBe(" ");
      expect(sparkline[4]).toBe("█");
    });

    test("should handle custom min and max bounds for network traffic", () => {
      const values = [0, 500, 1000];
      const sparkline = generateSparkline(values, 0, 1000);
      expect(sparkline.length).toBe(3);
      expect(sparkline[0]).toBe(" ");
      expect(sparkline[2]).toBe("█");
    });

    test("should render formatted progress bar", () => {
      const bar0 = renderProgressBar(0, 10);
      expect(bar0).toBe("[░░░░░░░░░░] 0.0%");

      const bar50 = renderProgressBar(50, 10);
      expect(bar50).toBe("[█████░░░░░] 50.0%");

      const bar100 = renderProgressBar(100, 10);
      expect(bar100).toBe("[██████████] 100.0%");
    });
  });

  describe("Metric Collection", () => {
    test("should collect CPU usage percentage", () => {
      const cpu = collectCpuUsage();
      expect(typeof cpu).toBe("number");
      expect(cpu).toBeGreaterThanOrEqual(0);
      expect(cpu).toBeLessThanOrEqual(100);
    });

    test("should collect Memory usage stats", () => {
      const mem = collectMemoryUsage();
      expect(typeof mem.usedMb).toBe("number");
      expect(typeof mem.totalMb).toBe("number");
      expect(typeof mem.percent).toBe("number");
      expect(mem.percent).toBeGreaterThanOrEqual(0);
      expect(mem.percent).toBeLessThanOrEqual(100);
    });

    test("should collect Disk usage stats", () => {
      const disk = collectDiskUsage("/");
      expect(typeof disk.usedGb).toBe("number");
      expect(typeof disk.totalGb).toBe("number");
      expect(typeof disk.percent).toBe("number");
      expect(disk.percent).toBeGreaterThanOrEqual(0);
      expect(disk.percent).toBeLessThanOrEqual(100);
    });

    test("should collect Network usage stats", () => {
      const net = collectNetworkUsage();
      expect(typeof net.rxKbps).toBe("number");
      expect(typeof net.txKbps).toBe("number");
      expect(typeof net.totalKbps).toBe("number");
    });

    test("should collect full system metrics snapshot", () => {
      const metrics = collectSystemMetrics();
      expect(metrics).toHaveProperty("timestamp");
      expect(metrics).toHaveProperty("cpu");
      expect(metrics).toHaveProperty("memory");
      expect(metrics).toHaveProperty("disk");
      expect(metrics).toHaveProperty("network");
    });
  });

  describe("Threshold Validation", () => {
    test("should return default thresholds for invalid or empty inputs", () => {
      const defaults = validateThresholds(null);
      expect(defaults).toEqual(DEFAULT_THRESHOLDS);
    });

    test("should validate and override threshold settings", () => {
      const custom = validateThresholds({ cpu: 90, memory: 70, disk: 95, network: 20480 });
      expect(custom.cpu).toBe(90);
      expect(custom.memory).toBe(70);
      expect(custom.disk).toBe(95);
      expect(custom.network).toBe(20480);
    });

    test("should ignore invalid out-of-range thresholds", () => {
      const invalid = validateThresholds({ cpu: 150, memory: -10, disk: "invalid" });
      expect(invalid.cpu).toBe(DEFAULT_THRESHOLDS.cpu);
      expect(invalid.memory).toBe(DEFAULT_THRESHOLDS.memory);
      expect(invalid.disk).toBe(DEFAULT_THRESHOLDS.disk);
    });
  });

  describe("SystemMonitor Class & History Management", () => {
    let monitor;

    beforeEach(() => {
      monitor = new SystemMonitor({ maxHistory: 5, notificationCooldownMs: 1000 });
    });

    test("should record samples and maintain max history limit", () => {
      for (let i = 0; i < 10; i++) {
        monitor.recordSample({
          timestamp: Date.now() + i * 1000,
          cpu: { percent: 10 * i },
          memory: { usedMb: 1000, totalMb: 8000, percent: 12.5 },
          disk: { usedGb: 50, totalGb: 500, percent: 10.0 },
          network: { rxKbps: 100, txKbps: 50, totalKbps: 150 },
        });
      }

      const history = monitor.getHistory();
      expect(history.length).toBe(5);
      expect(history[history.length - 1].cpu.percent).toBe(90);
    });

    test("should clear history", () => {
      monitor.recordSample();
      expect(monitor.getHistory().length).toBe(1);

      monitor.clearHistory();
      expect(monitor.getHistory().length).toBe(0);
      expect(monitor.getLatestSample()).toBeNull();
    });

    test("should detect high resource usage alerts when threshold exceeded", () => {
      const highSample = {
        timestamp: Date.now(),
        cpu: { percent: 85 },     // Exceeds default 80%
        memory: { usedMb: 7500, totalMb: 8000, percent: 93.75 }, // Exceeds default 80%
        disk: { usedGb: 480, totalGb: 500, percent: 96 },        // Exceeds default 85%
        network: { rxKbps: 8000, txKbps: 4000, totalKbps: 12000 }, // Exceeds default 10240
      };

      const alerts = monitor.checkThresholds(highSample);
      expect(alerts.length).toBe(4);
      expect(alerts.map((a) => a.resource)).toEqual(["cpu", "memory", "disk", "network"]);
      expect(alerts.find((a) => a.resource === "disk").level).toBe("critical");
    });

    test("should handle notification callbacks and cooldown period", () => {
      let callCount = 0;
      const notifyFn = (title, message, alert) => {
        callCount++;
      };
      const highSample = {
        timestamp: Date.now(),
        cpu: { percent: 90 },
        memory: { usedMb: 1000, totalMb: 8000, percent: 12.5 },
        disk: { usedGb: 50, totalGb: 500, percent: 10.0 },
        network: { rxKbps: 0, txKbps: 0, totalKbps: 0 },
      };

      const t0 = 100000;
      const triggered1 = monitor.checkAndNotify(highSample, notifyFn, t0);
      expect(triggered1.length).toBe(1);
      expect(callCount).toBe(1);

      // Call again within cooldown window (t0 + 500ms < t0 + 1000ms)
      const triggered2 = monitor.checkAndNotify(highSample, notifyFn, t0 + 500);
      expect(triggered2.length).toBe(0);
      expect(callCount).toBe(1);

      // Call after cooldown window expired (t0 + 1500ms > t0 + 1000ms)
      const triggered3 = monitor.checkAndNotify(highSample, notifyFn, t0 + 1500);
      expect(triggered3.length).toBe(1);
      expect(callCount).toBe(2);
    });

    test("should format metric mini graph and summary strings", () => {
      const sample = {
        timestamp: Date.now(),
        cpu: { percent: 45.2 },
        memory: { usedMb: 4096, totalMb: 16384, percent: 25.0 },
        disk: { usedGb: 250, totalGb: 1000, percent: 25.0 },
        network: { rxKbps: 120.5, txKbps: 45.0, totalKbps: 165.5 },
      };

      monitor.recordSample(sample);

      const cpuGraph = monitor.formatMetricMiniGraph("cpu", sample);
      expect(cpuGraph).toContain("CPU [");
      expect(cpuGraph).toContain("45.2%");

      const memGraph = monitor.formatMetricMiniGraph("memory", sample);
      expect(memGraph).toContain("RAM [");
      expect(memGraph).toContain("25% (4096 / 16384 MB)");

      const summary = monitor.formatMenuSummary(sample);
      expect(summary).toContain("CPU [");
      expect(summary).toContain("RAM [");
      expect(summary).toContain("Disk [");
      expect(summary).toContain("Net [");
    });
  });

  describe("CSV Export Functionality", () => {
    test("should export metric history to CSV format string", () => {
      const history = [
        {
          timestamp: 1700000000000,
          cpu: { percent: 12.5 },
          memory: { usedMb: 2048, totalMb: 8192, percent: 25.0 },
          disk: { usedGb: 100, totalGb: 500, percent: 20.0 },
          network: { rxKbps: 50.0, txKbps: 20.0, totalKbps: 70.0 },
        },
      ];

      const csv = exportToCSV(history);
      expect(csv).toContain("timestamp,cpu_percent,memory_used_mb,memory_total_mb,memory_percent");
      expect(csv).toContain("12.5,2048,8192,25,100,500,20,50,20");
    });

    test("should export metric history to file asynchronously", async () => {
      const tempDir = path.join(os.tmpdir(), `cmdbar-sysmon-test-${Date.now()}`);
      const filePath = path.join(tempDir, "metrics.csv");

      const monitor = new SystemMonitor();
      monitor.recordSample({
        timestamp: Date.now(),
        cpu: { percent: 33.3 },
        memory: { usedMb: 1000, totalMb: 4000, percent: 25.0 },
        disk: { usedGb: 50, totalGb: 200, percent: 25.0 },
        network: { rxKbps: 10, txKbps: 5, totalKbps: 15 },
      });

      const success = await monitor.exportToCSVFile(filePath);
      expect(success).toBe(true);
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, "utf8");
      expect(content).toContain("timestamp,cpu_percent");
      expect(content).toContain("33.3");

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe("D-Bus API System Resource Monitors Integration", () => {
    test("should respond to GetSystemMetrics, GetResourceMonitorCSV, and SetResourceThresholds D-Bus methods", async () => {
      const service = new CmdBarDBusService(null);

      const metricsJson = await service.GetSystemMetrics();
      const parsedMetrics = JSON.parse(metricsJson);
      expect(parsedMetrics).toHaveProperty("current");
      expect(parsedMetrics).toHaveProperty("summary");
      expect(parsedMetrics).toHaveProperty("history");

      const csv = await service.GetResourceMonitorCSV();
      expect(csv).toContain("timestamp,cpu_percent");

      const setSuccess = await service.SetResourceThresholds(JSON.stringify({ cpu: 92 }));
      expect(setSuccess).toBe(true);
      expect(service._systemMonitor.getThresholds().cpu).toBe(92);
    });
  });
});
