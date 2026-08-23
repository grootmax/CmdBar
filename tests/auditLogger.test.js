import fs from "fs";
import path from "path";
import os from "os";
import {
  getAuditLogPath,
  getCurrentUser,
  isSensitiveCommand,
  rotateLogIfNeeded,
  logCommand,
  readAuditLogs,
  clearAuditLog,
} from "../extension/auditLogger.js";

describe("Command Audit Logger Unit Tests", () => {
  let tempDir;
  let customLogPath;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmdbar-audit-test-"));
    customLogPath = path.join(tempDir, "audit.log");
    process.env.CMDBAR_AUDIT_LOG_PATH = customLogPath;
  });

  afterEach(() => {
    delete process.env.CMDBAR_AUDIT_LOG_PATH;
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("should resolve custom audit log path from environment variable", () => {
    expect(getAuditLogPath()).toBe(customLogPath);
  });

  test("should retrieve current system username", () => {
    const user = getCurrentUser();
    expect(typeof user).toBe("string");
    expect(user.length).toBeGreaterThan(0);
  });

  test("should identify sensitive commands containing password or secret keywords", () => {
    expect(isSensitiveCommand("echo mypassword123")).toBe(true);
    expect(isSensitiveCommand("curl -H 'Authorization: Bearer mytoken'")).toBe(true);
    expect(isSensitiveCommand("sudo rm -rf /tmp/test")).toBe(true);
    expect(isSensitiveCommand("ls -la")).toBe(false);
  });

  test("should identify sensitive commands marked with secure flag in schema", () => {
    const cmdObj = { name: "Secret Cmd", secure: true };
    expect(isSensitiveCommand("do-something", cmdObj)).toBe(true);

    const cmdObjParams = {
      parameters: { key: { secure: true } },
    };
    expect(isSensitiveCommand("do-something", cmdObjParams)).toBe(true);
  });

  test("should write log entry with ISO timestamp, command, exit code, duration, and user", async () => {
    const success = await logCommand({
      command: "make build",
      exitCode: 0,
      durationMs: 150,
      user: "testuser",
      config: { audit: { enabled: true, privacy_mode: false } },
    });

    expect(success).toBe(true);
    expect(fs.existsSync(customLogPath)).toBe(true);

    const entries = await readAuditLogs(customLogPath);
    expect(entries.length).toBe(1);

    const entry = entries[0];
    expect(entry.command).toBe("make build");
    expect(entry.exit_code).toBe(0);
    expect(entry.duration_ms).toBe(150);
    expect(entry.duration).toBe("150ms");
    expect(entry.user).toBe("testuser");
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp
  });

  test("should respect privacy mode and exclude sensitive commands from log", async () => {
    const config = { audit: { enabled: true, privacy_mode: true } };

    const result = await logCommand({
      command: "mysql -p mypassword123",
      exitCode: 0,
      durationMs: 20,
      config,
    });

    expect(result).toBe(false);
    expect(fs.existsSync(customLogPath)).toBe(false);

    const safeResult = await logCommand({
      command: "git status",
      exitCode: 0,
      durationMs: 10,
      config,
    });

    expect(safeResult).toBe(true);
    const entries = await readAuditLogs(customLogPath);
    expect(entries.length).toBe(1);
    expect(entries[0].command).toBe("git status");
  });

  test("should not write log entry when audit logging is disabled", async () => {
    const config = { audit: { enabled: false } };

    const result = await logCommand({
      command: "ping -c 3 google.com",
      exitCode: 0,
      durationMs: 40,
      config,
    });

    expect(result).toBe(false);
    expect(fs.existsSync(customLogPath)).toBe(false);
  });

  test("should rotate audit log when file date is from a previous day", async () => {
    // Write an initial log entry
    fs.writeFileSync(
      customLogPath,
      JSON.stringify({
        timestamp: "2026-08-01T10:00:00.000Z",
        user: "test",
        command: "old cmd",
        exit_code: 0,
        duration_ms: 5,
      }) + "\n",
      "utf8"
    );

    // Set file mtime to yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    fs.utimesSync(customLogPath, yesterday, yesterday);

    const yesterdayStr = yesterday.toISOString().split("T")[0];

    // Trigger rotate log
    await rotateLogIfNeeded(customLogPath);

    const rotatedPath = `${customLogPath}.${yesterdayStr}`;
    expect(fs.existsSync(rotatedPath)).toBe(true);
    expect(fs.existsSync(customLogPath)).toBe(false);
  });

  test("should clear audit log file", async () => {
    await logCommand({ command: "echo test", exitCode: 0, durationMs: 5 });
    expect(fs.existsSync(customLogPath)).toBe(true);

    await clearAuditLog(customLogPath);
    expect(fs.existsSync(customLogPath)).toBe(false);
  });
});
