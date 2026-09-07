import fs from "fs";
import path from "path";
import { jest } from "@jest/globals";

// Mock GNOME Shell ES modules
jest.unstable_mockModule("resource:///org/gnome/shell/extensions/extension.js", () => ({
  Extension: class {
    getSettings() {
      return {
        get_boolean: () => true,
        get_string: () => "test",
        get_strv: () => ["<Super>space"],
        connect: () => 1,
        disconnect: () => {},
      };
    }
  },
}), { virtual: true });

jest.unstable_mockModule("resource:///org/gnome/shell/ui/main.js", () => ({
  notify: jest.fn(),
  wm: {
    addKeybinding: jest.fn(),
    removeKeybinding: jest.fn(),
  },
}), { virtual: true });

jest.unstable_mockModule("resource:///org/gnome/shell/ui/panelMenu.js", () => ({
  Button: class {
    constructor() {
      this.menu = {
        addMenuItem: jest.fn(),
        removeAll: jest.fn(),
        toggle: jest.fn(),
      };
    }
    add_child() {}
    destroy() {}
  },
}), { virtual: true });

jest.unstable_mockModule("resource:///org/gnome/shell/ui/popupMenu.js", () => ({
  PopupMenuItem: class {
    constructor(label, opts) {
      this.label = { text: label };
      this.opts = opts;
    }
    connect(signal, callback) {
      this._activateCb = callback;
    }
  },
  PopupSeparatorMenuItem: class {},
  PopupBaseMenuItem: class {},
}), { virtual: true });

jest.unstable_mockModule("resource:///org/gnome/shell/ui/modalDialog.js", () => ({
  ModalDialog: class {
    open() {}
    close() {}
    addButton() {}
  },
}), { virtual: true });

jest.unstable_mockModule("gi", () => ({
  St: {
    BoxLayout: class { add_child() {} },
    Icon: class {},
    Label: class {},
  },
  Clutter: { ActorAlign: { CENTER: 1 }, KEY_Escape: 27 },
  Gio: {
    DBusNodeInfo: { new_for_xml: () => ({ interfaces: [{}] }) },
    DBusExportedObject: { wrapJSObject: () => ({ export: () => {}, unexport: () => {} }) },
    DBus: { session: {} },
    bus_own_name: () => 1,
    bus_unown_name: () => {},
    File: { new_for_path: () => ({ monitor_file: () => ({ connect: () => 1, cancel: () => {} }) }) },
    FileMonitorFlags: { NONE: 0 },
    FileMonitorEvent: { CHANGES_DONE_HINT: 1 },
  },
  GLib: {
    build_filenamev: (parts) => parts.join("/"),
    get_user_config_dir: () => "/tmp",
    Source: { remove: () => {} },
    timeout_add: () => 1,
    SOURCE_REMOVE: true,
  },
  GObject: {
    registerClass: (cls) => cls,
  },
  Meta: { KeyBindingFlags: { NONE: 0 } },
  Shell: { ActionMode: { ALL: 1 } },
}), { virtual: true });

const {
  renderSparkline,
  formatBytes,
  formatRate,
  exportToCSVString,
  SystemResourceMonitor,
} = await import("../extension/systemResourceMonitor.js");

const { CmdBarDBusService } = await import("../extension/dbusService.js");

describe("System Resource Monitor Tests", () => {
  describe("Sparkline Renderer", () => {
    test("renderSparkline formats numeric array to unicode bar characters", () => {
      const history = [0, 20, 40, 60, 80, 100];
      const spark = renderSparkline(history, 6, 100);
      expect(spark).toHaveLength(6);
      expect(spark).toBe(" ▂▄▅▇█");
    });

    test("renderSparkline pads short arrays with spaces", () => {
      const history = [50, 100];
      const spark = renderSparkline(history, 5, 100);
      expect(spark).toHaveLength(5);
      expect(spark.startsWith("   ")).toBe(true);
    });

    test("renderSparkline handles empty and invalid inputs gracefully", () => {
      expect(renderSparkline([], 4)).toBe("    ");
      expect(renderSparkline(null, 4)).toBe("    ");
      expect(renderSparkline([NaN, undefined, null], 3)).toBe("   ");
    });
  });

  describe("Bytes & Rate Formatting", () => {
    test("formatBytes converts raw byte counts to human readable strings", () => {
      expect(formatBytes(0)).toBe("0 B");
      expect(formatBytes(1024)).toBe("1 KB");
      expect(formatBytes(1048576)).toBe("1 MB");
      expect(formatBytes(1073741824)).toBe("1 GB");
    });

    test("formatRate appends per-second unit to formatted bytes", () => {
      expect(formatRate(5242880)).toBe("5 MB/s");
      expect(formatRate(1024)).toBe("1 KB/s");
    });
  });

  describe("CSV Export Functionality", () => {
    test("exportToCSVString generates valid CSV header and formatted data rows", () => {
      const sampleHistory = [
        {
          timestamp: "2026-08-23T12:00:00.000Z",
          cpu: { usagePercent: 45.2 },
          memory: { totalMB: 16000, usedMB: 8000, freeMB: 8000, usagePercent: 50.0 },
          disk: { totalGB: 500, usedGB: 200, freeGB: 300, usagePercent: 40.0 },
          network: { rxRateKBps: 120.5, txRateKBps: 30.2, totalRateKBps: 150.7 },
        },
      ];

      const csv = exportToCSVString(sampleHistory);
      const lines = csv.split("\n");
      expect(lines.length).toBe(2);
      expect(lines[0]).toContain("Timestamp,CPU (%),Memory Used (MB)");
      expect(lines[1]).toContain('"2026-08-23T12:00:00.000Z",45.2,8000.0,16000.0,50.0,200.00,500.00,40.0,120.5,30.2');
    });
  });

  describe("SystemResourceMonitor Core Class", () => {
    let mockReader;

    beforeEach(() => {
      mockReader = {
        readCPU: jest.fn().mockReturnValue(75.5),
        readMemory: jest.fn().mockReturnValue({
          totalMB: 16384,
          usedMB: 8192,
          freeMB: 8192,
          usagePercent: 50.0,
        }),
        readDisk: jest.fn().mockReturnValue({
          totalGB: 256.0,
          usedGB: 128.0,
          freeGB: 128.0,
          usagePercent: 50.0,
        }),
        readNetwork: jest.fn().mockReturnValue({
          rxBytes: 1000000,
          txBytes: 500000,
          rxRateKBps: 100.0,
          txRateKBps: 50.0,
          totalRateKBps: 150.0,
        }),
      };
    });

    test("sampleMetrics collects snapshot and pushes to history ring buffer", () => {
      const monitor = new SystemResourceMonitor(
        { maxHistoryLength: 3 },
        mockReader
      );

      const sample1 = monitor.sampleMetrics();
      expect(sample1.cpu.usagePercent).toBe(75.5);
      expect(sample1.memory.usagePercent).toBe(50.0);
      expect(monitor.getHistory()).toHaveLength(1);

      monitor.sampleMetrics();
      monitor.sampleMetrics();
      monitor.sampleMetrics();

      expect(monitor.getHistory()).toHaveLength(3);
      expect(monitor.getLatestMetrics()).not.toBeNull();
    });

    test("checkThresholds triggers notification callbacks on high usage", () => {
      const onAlert = jest.fn();
      const monitor = new SystemResourceMonitor(
        {
          cpuThreshold: 80,
          memoryThreshold: 80,
          notificationCooldown: 1000,
          onNotification: onAlert,
        },
        mockReader
      );

      // CPU at 95% triggers alert
      mockReader.readCPU.mockReturnValue(95.0);
      const sample = monitor.sampleMetrics();

      expect(onAlert).toHaveBeenCalledTimes(1);
      const alertCall = onAlert.mock.calls[0][0];
      expect(alertCall.metric).toBe("cpu");
      expect(alertCall.value).toBe(95.0);

      // Immediate second check within cooldown window should not re-trigger notification
      const secondAlerts = monitor.checkThresholds(sample);
      expect(secondAlerts).toHaveLength(0);
      expect(onAlert).toHaveBeenCalledTimes(1);
    });

    test("updateConfig updates thresholds and polling parameters", () => {
      const monitor = new SystemResourceMonitor({ cpuThreshold: 80 }, mockReader);
      expect(monitor.config.cpuThreshold).toBe(80);

      monitor.updateConfig({ cpuThreshold: 90, pollingInterval: 1000 });
      expect(monitor.config.cpuThreshold).toBe(90);
      expect(monitor.config.pollingInterval).toBe(1000);
    });

    test("start and stop polling control interval timer", () => {
      jest.useFakeTimers();
      const monitor = new SystemResourceMonitor({}, mockReader);

      monitor.start(1000);
      expect(monitor.isPolling).toBe(true);

      jest.advanceTimersByTime(2500);
      expect(mockReader.readCPU).toHaveBeenCalled();

      monitor.stop();
      expect(monitor.isPolling).toBe(false);
      jest.useRealTimers();
    });

    test("getSparkline generates sparklines for cpu, memory, disk, and network", () => {
      const monitor = new SystemResourceMonitor({}, mockReader);
      monitor.sampleMetrics();
      monitor.sampleMetrics();

      const cpuSpark = monitor.getSparkline("cpu", 5);
      const memSpark = monitor.getSparkline("memory", 5);
      const diskSpark = monitor.getSparkline("disk", 5);
      const netSpark = monitor.getSparkline("networkTotal", 5);

      expect(cpuSpark).toHaveLength(5);
      expect(memSpark).toHaveLength(5);
      expect(diskSpark).toHaveLength(5);
      expect(netSpark).toHaveLength(5);
    });

    test("exportToCSVFile writes CSV content to disk file", () => {
      const testFilePath = path.join("/tmp", `test_metrics_${Date.now()}.csv`);
      const monitor = new SystemResourceMonitor({}, mockReader);
      monitor.sampleMetrics();

      const success = monitor.exportToCSVFile(testFilePath);
      expect(success).toBe(true);
      expect(fs.existsSync(testFilePath)).toBe(true);

      const content = fs.readFileSync(testFilePath, "utf8");
      expect(content).toContain("CPU (%)");

      // Cleanup
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
    });
  });

  describe("D-Bus API GetResourceMetrics Integration", () => {
    test("CmdBarDBusService GetResourceMetrics returns JSON payload with metrics and sparklines", async () => {
      const mockMonitor = {
        getLatestMetrics: () => ({
          cpu: { usagePercent: 42.0 },
          memory: { totalMB: 16000, usedMB: 4000, freeMB: 12000, usagePercent: 25.0 },
          disk: { totalGB: 500, usedGB: 100, freeGB: 400, usagePercent: 20.0 },
          network: { rxBytes: 1000, txBytes: 500, rxRateKBps: 10.0, txRateKBps: 5.0, totalRateKBps: 15.0 },
        }),
        getSparkline: (m) => `spark_${m}`,
        getHistory: () => [],
      };

      const mockIndicator = {
        _resourceMonitor: mockMonitor,
      };

      const dbusService = new CmdBarDBusService(mockIndicator);
      const jsonRes = await dbusService.GetResourceMetrics();
      expect(typeof jsonRes).toBe("string");

      const parsed = JSON.parse(jsonRes);
      expect(parsed.cpu.usagePercent).toBe(42.0);
      expect(parsed.memory.usagePercent).toBe(25.0);
      expect(parsed.sparklines.cpu).toBe("spark_cpu");
      expect(parsed.sparklines.network).toBe("spark_networkTotal");
    });
  });
});
