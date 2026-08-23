import fs from "fs";
import path from "path";
import os from "os";
import {
  SharedAuditTrail,
  maskPII,
  computeHMAC,
  generateId,
} from "../extension/sharedAuditTrail.js";

describe("SharedAuditTrail Unit and Integration Tests", () => {
  let tempLogPath;
  let auditTrail;

  beforeEach(() => {
    tempLogPath = path.join(
      os.tmpdir(),
      `cmdbar-audit-test-${Date.now()}-${Math.random().toString(36).substring(2)}.json`
    );
    auditTrail = new SharedAuditTrail({
      teamId: "team-alpha",
      workspaceId: "workspace-123",
      userId: "user-alice",
      logPath: tempLogPath,
      hmacKey: "secret-test-key",
      retentionDays: 30,
    });
  });

  afterEach(() => {
    if (fs.existsSync(tempLogPath)) {
      try {
        fs.unlinkSync(tempLogPath);
      } catch (e) {}
    }
  });

  describe("PII Masking and Sanitization", () => {
    test("maskPII redacts passwords, tokens, emails, IPs, and SSNs in strings", () => {
      const rawText =
        "Exec postgres -p mysecretpassword with email user@company.com at ip 192.168.1.50 token Bearer eyJhbGciOiJIUzI1NiJ9 and ssn 123-45-6789";
      const masked = maskPII(rawText);

      expect(masked).not.toContain("mysecretpassword");
      expect(masked).not.toContain("user@company.com");
      expect(masked).not.toContain("192.168.1.50");
      expect(masked).not.toContain("123-45-6789");
      expect(masked).toContain("[REDACTED_PASSWORD]");
      expect(masked).toContain("[REDACTED_EMAIL]");
      expect(masked).toContain("[REDACTED_IP]");
      expect(masked).toContain("[REDACTED_SSN]");
      expect(masked).toContain("[REDACTED_TOKEN]");
    });

    test("maskPII redacts sensitive object keys recursively", () => {
      const inputObj = {
        username: "alice",
        password: "supersecretpassword",
        api_key: "ak_live_987654321",
        details: {
          ipAddress: "10.0.0.1",
          email: "alice@example.com",
        },
      };

      const masked = maskPII(inputObj);
      expect(masked.password).toBe("[REDACTED_SENSITIVE]");
      expect(masked.api_key).toBe("[REDACTED_SENSITIVE]");
      expect(masked.details.email).toBe("[REDACTED_EMAIL]");
      expect(masked.details.ipAddress).toBe("[REDACTED_IP]");
    });
  });

  describe("Audit Event Creation and Hash Chain Verification", () => {
    test("logEvent creates structured audit entry with HMAC signature", async () => {
      const entry = await auditTrail.logEvent({
        action: "command.execute",
        resource: "aws ecs update-service --cluster prod",
        status: "SUCCESS",
        severity: "INFO",
        metadata: { env: "production" },
      });

      expect(entry.id).toBeDefined();
      expect(entry.timestamp).toBeDefined();
      expect(entry.userId).toBe("user-alice");
      expect(entry.teamId).toBe("team-alpha");
      expect(entry.action).toBe("command.execute");
      expect(entry.status).toBe("SUCCESS");
      expect(entry.signature).toBeDefined();
      expect(entry.signature.length).toBe(64);
    });

    test("verifyIntegrity confirms valid HMAC signature chain", async () => {
      await auditTrail.logEvent({ action: "user.login", resource: "auth" });
      await auditTrail.logEvent({ action: "config.update", resource: "settings" });
      await auditTrail.logEvent({ action: "deploy.service", resource: "prod-api" });

      const integrity = auditTrail.verifyIntegrity();
      expect(integrity.valid).toBe(true);
      expect(integrity.totalVerified).toBe(3);
      expect(integrity.errors).toHaveLength(0);
    });

    test("verifyIntegrity detects tampered records in audit log", async () => {
      await auditTrail.logEvent({ action: "user.login", resource: "auth" });
      await auditTrail.logEvent({ action: "config.update", resource: "settings" });

      // Tamper with second record
      auditTrail.logs[1].resource = "HACKED_RESOURCE";

      const integrity = auditTrail.verifyIntegrity();
      expect(integrity.valid).toBe(false);
      expect(integrity.errors.length).toBeGreaterThan(0);
    });
  });

  describe("Privacy Mode Settings", () => {
    test("privacyMode omits command arguments and IP addresses", async () => {
      auditTrail.setPrivacyMode(true);
      const entry = await auditTrail.logEvent({
        action: "command.execute",
        resource: "kubectl delete pod --all",
        ipAddress: "192.168.1.100",
      });

      expect(entry.resource).toContain("[ARGS_OMITTED_PRIVACY_MODE]");
      expect(entry.ipAddress).toBe("[PRIVACY_MODE_OMITTED]");
      expect(entry.metadata.privacyMode).toBe(true);
    });
  });

  describe("Team Log Sync and Query Filtering", () => {
    test("syncTeamLogs merges external team audit records and sorts chronologically", async () => {
      await auditTrail.logEvent({
        action: "local.event",
        timestamp: "2026-08-23T10:00:00.000Z",
      });

      const externalLogs = [
        {
          id: "ext-1",
          timestamp: "2026-08-23T09:00:00.000Z",
          userId: "user-bob",
          teamId: "team-alpha",
          action: "remote.deploy",
          resource: "k8s-cluster",
          status: "SUCCESS",
          severity: "INFO",
          signature: "ext-sig-1",
        },
      ];

      const mergedCount = auditTrail.syncTeamLogs(externalLogs);
      expect(mergedCount).toBe(1);
      expect(auditTrail.logs).toHaveLength(2);
      expect(auditTrail.logs[0].id).toBe("ext-1");
    });

    test("queryLogs filters by team, user, status, severity, and keyword", async () => {
      await auditTrail.logEvent({
        userId: "alice",
        action: "db.query",
        status: "SUCCESS",
        severity: "INFO",
      });
      await auditTrail.logEvent({
        userId: "bob",
        action: "auth.login",
        status: "DENIED",
        severity: "HIGH",
      });
      await auditTrail.logEvent({
        userId: "alice",
        action: "server.restart",
        status: "FAILURE",
        severity: "CRITICAL",
      });

      const deniedLogs = auditTrail.queryLogs({ status: "DENIED" });
      expect(deniedLogs).toHaveLength(1);
      expect(deniedLogs[0].userId).toBe("bob");

      const aliceLogs = auditTrail.queryLogs({ userId: "alice" });
      expect(aliceLogs).toHaveLength(2);

      const keywordLogs = auditTrail.queryLogs({ searchKeyword: "restart" });
      expect(keywordLogs).toHaveLength(1);
      expect(keywordLogs[0].action).toBe("server.restart");
    });
  });

  describe("GDPR Erasure and Retention Policy", () => {
    test("purgeUserData pseudonymizes user data and preserves signature integrity", async () => {
      await auditTrail.logEvent({
        userId: "target-user",
        action: "user.login",
        ipAddress: "192.168.1.1",
        resource: "login page",
      });
      await auditTrail.logEvent({
        userId: "other-user",
        action: "view.dashboard",
      });

      const purgeResult = await auditTrail.purgeUserData("target-user");
      expect(purgeResult.success).toBe(true);
      expect(purgeResult.purgedCount).toBe(1);

      const targetLogs = auditTrail.logs.filter((l) => l.action === "user.login");
      expect(targetLogs[0].userId).toContain("ANONYMIZED_");
      expect(targetLogs[0].ipAddress).toBe("[GDPR_PURGED_IP]");

      const integrity = auditTrail.verifyIntegrity();
      expect(integrity.valid).toBe(true);
    });

    test("applyRetentionPolicy removes records older than retention threshold", async () => {
      const oldTimestamp = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
      await auditTrail.logEvent({
        action: "old.action",
        timestamp: oldTimestamp,
      });
      await auditTrail.logEvent({ action: "recent.action" });

      const retentionResult = await auditTrail.applyRetentionPolicy(30);
      expect(retentionResult.prunedCount).toBe(1);
      expect(retentionResult.remainingCount).toBe(1);
      expect(auditTrail.logs[0].action).toBe("recent.action");
    });
  });

  describe("Compliance Reports and SIEM Export", () => {
    test("generateComplianceReport produces structured report for frameworks", async () => {
      await auditTrail.logEvent({ action: "test.action", status: "SUCCESS" });

      const report = auditTrail.generateComplianceReport("SOC2");
      expect(report.framework).toBe("SOC2");
      expect(report.summary.complianceScorePct).toBeGreaterThan(0);
      expect(report.controls).toBeDefined();
      expect(report.controls.length).toBeGreaterThan(0);
    });

    test("exportComplianceReport outputs JSON, CSV, HTML, and Markdown formats", async () => {
      await auditTrail.logEvent({ action: "test.action" });
      const report = auditTrail.generateComplianceReport("ISO27001");

      const jsonOut = auditTrail.exportComplianceReport(report, "JSON");
      const csvOut = auditTrail.exportComplianceReport(report, "CSV");
      const htmlOut = auditTrail.exportComplianceReport(report, "HTML");
      const mdOut = auditTrail.exportComplianceReport(report, "MARKDOWN");

      expect(jsonOut).toContain("ISO27001");
      expect(csvOut).toContain("ControlID,Title,Status,Details");
      expect(htmlOut).toContain("<!DOCTYPE html>");
      expect(mdOut).toContain("# ISO27001 Compliance Audit Report");
    });

    test("exportToSIEM converts audit events to CEF, LEEF, SYSLOG, SPLUNK, and JSON", async () => {
      await auditTrail.logEvent({
        action: "firewall.block",
        resource: "port 443",
        severity: "HIGH",
        status: "DENIED",
      });

      const cef = auditTrail.exportToSIEM(null, "CEF");
      const leef = auditTrail.exportToSIEM(null, "LEEF");
      const syslog = auditTrail.exportToSIEM(null, "SYSLOG");
      const splunk = auditTrail.exportToSIEM(null, "SPLUNK");
      const jsonFmt = auditTrail.exportToSIEM(null, "JSON");

      expect(cef).toContain("CEF:0|CmdBar|SharedAuditTrail|1.0|firewall.block");
      expect(leef).toContain("LEEF:2.0|CmdBar|SharedAuditTrail|1.0|firewall.block");
      expect(syslog).toContain("CmdBarSharedAudit");
      expect(splunk).toContain('"source":"cmdbar:audit"');
      expect(jsonFmt).toContain('"event.action": "firewall.block"');
    });

    test("sendToSIEMEndpoint dispatches payload to webhook endpoint", async () => {
      await auditTrail.logEvent({ action: "test.event" });
      const res = await auditTrail.sendToSIEMEndpoint({
        url: "https://siem.example.com/webhook",
        format: "CEF",
      });

      expect(res.count).toBe(1);
      expect(res.url).toBe("https://siem.example.com/webhook");
    });
  });

  describe("Anomaly Detection and Real-Time Alerts", () => {
    test("detectAnomalies identifies failure spikes and unauthorized privilege attempts", async () => {
      // Trigger failure spike for user-malicious
      for (let i = 0; i < 6; i++) {
        await auditTrail.logEvent({
          userId: "user-malicious",
          action: "sudo.access",
          status: "DENIED",
          severity: "HIGH",
        });
      }

      const anomalies = auditTrail.detectAnomalies();
      expect(anomalies.length).toBeGreaterThan(0);

      const failureSpikes = anomalies.filter((a) => a.ruleId === "FAILURE_SPIKE");
      expect(failureSpikes.length).toBeGreaterThan(0);
      expect(failureSpikes[0].affectedUser).toBe("user-malicious");
    });

    test("registerAlertHandler triggers real-time callbacks on high severity events", async () => {
      const receivedAlerts = [];
      auditTrail.registerAlertHandler((alert) => receivedAlerts.push(alert));

      await auditTrail.logEvent({
        userId: "user-attacker",
        action: "unauthorized.root",
        status: "DENIED",
        severity: "CRITICAL",
      });

      expect(receivedAlerts).toHaveLength(1);
      const alertData = receivedAlerts[0];
      expect(alertData.severity).toBe("CRITICAL");
      expect(alertData.event.userId).toBe("user-attacker");
    });
  });
});
