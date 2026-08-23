import {
  PolicyEngine,
  createPolicyEngine,
  DEFAULT_DLP_PATTERNS,
  DEFAULT_SENSITIVE_COMMAND_PATTERNS,
  validateLuhn,
  isIpInCidr,
} from "../extension/policyEngine.js";

describe("Policy Enforcement Engine - JS Unit & Integration Tests", () => {
  describe("Luhn Algorithm & IP CIDR Helpers", () => {
    test("validateLuhn correctly validates credit card numbers", () => {
      expect(validateLuhn("49927398716")).toBe(true);
      expect(validateLuhn("49927398717")).toBe(false);
      expect(validateLuhn("1234567812345670")).toBe(true);
      expect(validateLuhn("1234567812345678")).toBe(false);
    });

    test("isIpInCidr checks IPv4 addresses in subnets", () => {
      expect(isIpInCidr("192.168.1.50", "192.168.1.0/24")).toBe(true);
      expect(isIpInCidr("192.168.2.50", "192.168.1.0/24")).toBe(false);
      expect(isIpInCidr("10.0.0.1", "10.0.0.0/8")).toBe(true);
      expect(isIpInCidr("127.0.0.1", "127.0.0.1")).toBe(true);
      expect(isIpInCidr("10.0.0.1", "")).toBe(false);
    });
  });

  describe("Multi-Factor Authentication (MFA) Enforcement", () => {
    let engine;

    beforeEach(() => {
      engine = createPolicyEngine({
        mfa: {
          enabled: true,
          mfaSecret: "654321",
          sessionDurationMs: 1000, // 1 second for test
          sensitiveCommands: ["*deploy*", "*rm -rf*", "*sudo*"],
        },
      });
    });

    test("identifies sensitive operations correctly", () => {
      expect(engine.isSensitiveOperation("make deploy-staging")).toBe(true);
      expect(engine.isSensitiveOperation("sudo systemctl restart")).toBe(true);
      expect(engine.isSensitiveOperation("echo hello")).toBe(false);
      expect(engine.isSensitiveOperation({ name: "Drop Table", sensitive: true })).toBe(true);
      expect(engine.isSensitiveOperation({ command: "aws ecs update", require_mfa: true })).toBe(true);
    });

    test("requires MFA token for sensitive operations when session is not verified", () => {
      const res = engine.evaluate({ command: "make deploy-staging" });
      expect(res.allowed).toBe(false);
      expect(res.mfaRequired).toBe(true);
      expect(res.mfaVerified).toBe(false);
      expect(res.reasons.join(" ")).toContain("MFA Authentication Required");
    });

    test("allows non-sensitive operations without MFA", () => {
      const res = engine.evaluate({ command: "echo hello" });
      expect(res.allowed).toBe(true);
      expect(res.mfaRequired).toBe(false);
    });

    test("verifies valid MFA token and permits sensitive operation", () => {
      const res = engine.evaluate({
        command: "make deploy-staging",
        mfaToken: "654321",
      });
      expect(res.allowed).toBe(true);
      expect(res.mfaRequired).toBe(true);
      expect(res.mfaVerified).toBe(true);
    });

    test("rejects invalid MFA token", () => {
      const res = engine.evaluate({
        command: "make deploy-staging",
        mfaToken: "000000",
      });
      expect(res.allowed).toBe(false);
      expect(res.mfaVerified).toBe(false);
    });

    test("MFA session expires after sessionDurationMs", async () => {
      const now = Date.now();
      engine.verifyMfaToken("654321", now);
      expect(engine.isMfaSessionValid(now + 500)).toBe(true);
      expect(engine.isMfaSessionValid(now + 1500)).toBe(false);
    });
  });

  describe("Data Loss Prevention (DLP) Scanning & Redaction", () => {
    let engine;

    beforeEach(() => {
      engine = createPolicyEngine({
        dlp: {
          enabled: true,
          action: "redact",
        },
      });
    });

    test("scans and redacts Credit Cards, SSN, and AWS keys from input commands & parameters", () => {
      const evalRes = engine.evaluate({
        command: "echo My credit card is 4532015112830366 and SSN is 123-45-6789",
        parameters: {
          key: "AKIAIOSFODNN7EXAMPLE",
          secret: "api_key = 1234567890abcdef12345",
        },
      });

      expect(evalRes.allowed).toBe(true);
      expect(evalRes.dlpMatches.length).toBeGreaterThan(0);
      expect(evalRes.redactedCommand).toContain("[REDACTED:CREDIT_CARD]");
      expect(evalRes.redactedCommand).toContain("[REDACTED:SSN]");
      expect(evalRes.redactedParameters.key).toContain("[REDACTED:AWS_KEY]");
    });

    test("redacts sensitive data from command execution stdout/stderr output", () => {
      const output = "Output: AWS Key AKIAIOSFODNN7EXAMPLE generated. Private Key:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEogIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----";
      const redacted = engine.evaluate().redactOutput(output);

      expect(redacted).toContain("[REDACTED:AWS_KEY]");
      expect(redacted).toContain("[REDACTED:PRIVATE_KEY]");
      expect(redacted).not.toContain("AKIAIOSFODNN7EXAMPLE");
    });

    test("blocks execution when DLP action is set to 'block'", () => {
      engine.configure({ dlp: { enabled: true, action: "block" } });
      const evalRes = engine.evaluate({
        command: "aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE",
      });

      expect(evalRes.allowed).toBe(false);
      expect(evalRes.reasons.join(" ")).toContain("DLP Violation: Blocked");
    });

    test("issues warning when DLP action is set to 'warn'", () => {
      engine.configure({ dlp: { enabled: true, action: "warn" } });
      const evalRes = engine.evaluate({
        command: "aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE",
      });

      expect(evalRes.allowed).toBe(true);
      expect(evalRes.reasons.join(" ")).toContain("DLP Warning");
    });
  });

  describe("Geographic Restrictions", () => {
    test("blocks requests from blocked countries or outside allowed countries", () => {
      const engine = createPolicyEngine({
        geo: {
          enabled: true,
          allowedCountries: ["US", "CA"],
          blockedCountries: ["RU", "CN"],
        },
      });

      expect(engine.evaluateGeo({ countryCode: "US" }).allowed).toBe(true);
      expect(engine.evaluateGeo({ countryCode: "DE" }).allowed).toBe(false);
      expect(engine.evaluateGeo({ countryCode: "RU" }).allowed).toBe(false);
    });

    test("blocks requests matching blocked IP ranges or outside allowed IP ranges", () => {
      const engine = createPolicyEngine({
        geo: {
          enabled: true,
          allowedIpRanges: ["10.0.0.0/8", "192.168.1.0/24"],
          blockedIpRanges: ["10.100.0.0/16"],
        },
      });

      expect(engine.evaluateGeo({ ip: "192.168.1.10" }).allowed).toBe(true);
      expect(engine.evaluateGeo({ ip: "10.100.5.1" }).allowed).toBe(false);
      expect(engine.evaluateGeo({ ip: "8.8.8.8" }).allowed).toBe(false);
    });
  });

  describe("Time-Based Access Control", () => {
    test("restricts access based on allowed days and time windows", () => {
      const engine = createPolicyEngine({
        time: {
          enabled: true,
          allowedDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
          allowedHours: { start: "09:00", end: "17:00" },
        },
      });

      // Wednesday 10:30 UTC
      const wedWorkHour = new Date("2026-08-26T10:30:00Z");
      expect(engine.evaluateTime(wedWorkHour).allowed).toBe(true);

      // Wednesday 20:00 UTC (after hours)
      const wedAfterHours = new Date("2026-08-26T20:00:00Z");
      expect(engine.evaluateTime(wedAfterHours).allowed).toBe(false);

      // Sunday 12:00 UTC (weekend)
      const sunday = new Date("2026-08-23T12:00:00Z");
      expect(engine.evaluateTime(sunday).allowed).toBe(false);
    });
  });

  describe("Performance Benchmarks", () => {
    test("evaluates full policy chain in less than 5ms", () => {
      const engine = createPolicyEngine({
        mfa: { enabled: true, sensitiveCommands: ["*deploy*"] },
        dlp: { enabled: true, action: "redact" },
        geo: { enabled: true, allowedCountries: ["US", "CA"], allowedIpRanges: ["10.0.0.0/8"] },
        time: { enabled: true, allowedDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], allowedHours: { start: "00:00", end: "23:59" } },
      });

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        engine.evaluate({
          command: "deploy --key AKIAIOSFODNN7EXAMPLE",
          parameters: { host: "10.1.2.3" },
          mfaToken: "123456",
          geo: { countryCode: "US", ip: "10.1.2.3" },
        });
      }
      const duration = performance.now() - start;
      const avgMs = duration / 100;

      expect(avgMs).toBeLessThan(5);
    });
  });
});
