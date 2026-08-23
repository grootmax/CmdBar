import {
  DEFAULT_POLICY_CONFIG,
  generateTOTP,
  verifyTOTP,
  isSensitiveCommand,
  base32ToBytes,
  ipInRange,
  checkGeo,
  checkTime,
  checkDLP,
  redactDLP,
  evaluatePolicy,
} from "../extension/policyEngine.js";

describe("Policy Enforcement Engine (JS Unit & Integration Tests)", () => {
  const TEST_SECRET = "JBSWY3DPEHPK3PXP"; // Base32 for "Hello!"

  describe("TOTP MFA Generation & Verification", () => {
    test("decodes base32 secret correctly", () => {
      const bytes = base32ToBytes(TEST_SECRET);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBe(10);
    });

    test("generates valid 6-digit TOTP token", () => {
      const token = generateTOTP(TEST_SECRET);
      expect(typeof token).toBe("string");
      expect(token).toMatch(/^\d{6}$/);
    });

    test("verifies valid TOTP token within current time window", () => {
      const token = generateTOTP(TEST_SECRET);
      const isValid = verifyTOTP(token, TEST_SECRET);
      expect(isValid).toBe(true);
    });

    test("verifies TOTP token within +/- 1 step window allowance", () => {
      const now = Math.floor(Date.now() / 1000);
      const pastToken = generateTOTP(TEST_SECRET, now - 30);
      const futureToken = generateTOTP(TEST_SECRET, now + 30);

      expect(verifyTOTP(pastToken, TEST_SECRET, 1, now)).toBe(true);
      expect(verifyTOTP(futureToken, TEST_SECRET, 1, now)).toBe(true);
    });

    test("rejects invalid TOTP tokens or empty strings", () => {
      expect(verifyTOTP("000000", TEST_SECRET)).toBe(false);
      expect(verifyTOTP("abcdef", TEST_SECRET)).toBe(false);
      expect(verifyTOTP("", TEST_SECRET)).toBe(false);
      expect(verifyTOTP(null, TEST_SECRET)).toBe(false);
    });
  });

  describe("Sensitive Operation Classification", () => {
    test("identifies explicitly tagged sensitive commands", () => {
      expect(isSensitiveCommand({ name: "Custom", sensitive: true })).toBe(
        true,
      );
      expect(isSensitiveCommand({ name: "Custom", mfa_required: true })).toBe(
        true,
      );
      expect(
        isSensitiveCommand({ name: "Custom", sensitivity_level: "high" }),
      ).toBe(true);
      expect(
        isSensitiveCommand({ name: "Custom", sensitivity_level: "critical" }),
      ).toBe(true);
    });

    test("identifies commands containing sensitive keywords", () => {
      expect(isSensitiveCommand("deploy latest to production")).toBe(true);
      expect(isSensitiveCommand("sudo rm -rf /tmp/test")).toBe(true);
      expect(isSensitiveCommand("aws kms decrypt --ciphertext")).toBe(true);
      expect(
        isSensitiveCommand({
          name: "Delete Database",
          command: "drop database text",
        }),
      ).toBe(true);
      expect(isSensitiveCommand("fetch iam credentials")).toBe(true);
    });

    test("allows non-sensitive standard commands", () => {
      expect(isSensitiveCommand("make build")).toBe(false);
      expect(isSensitiveCommand("ping -c 3 google.com")).toBe(false);
      expect(isSensitiveCommand("echo Hello World")).toBe(false);
      expect(isSensitiveCommand("git status")).toBe(false);
    });
  });

  describe("Geographic Restrictions & CIDR IP Matching", () => {
    test("correctly matches IPv4 addresses against CIDR ranges", () => {
      expect(ipInRange("192.168.1.100", "192.168.1.0/24")).toBe(true);
      expect(ipInRange("192.168.2.100", "192.168.1.0/24")).toBe(false);
      expect(ipInRange("10.0.0.5", "10.0.0.0/8")).toBe(true);
      expect(ipInRange("172.16.0.1", "10.0.0.0/8")).toBe(false);
      expect(ipInRange("127.0.0.1", "127.0.0.1")).toBe(true);
    });

    test("evaluates country code restrictions", () => {
      const geoPolicy = {
        enabled: true,
        allowed_countries: ["US", "CA"],
        blocked_countries: ["RU", "CN"],
        allowed_ip_ranges: [],
        blocked_ip_ranges: [],
      };

      expect(checkGeo({ country_code: "US" }, geoPolicy).allowed).toBe(true);
      expect(checkGeo({ country_code: "CA" }, geoPolicy).allowed).toBe(true);
      expect(checkGeo({ country_code: "FR" }, geoPolicy).allowed).toBe(false);
      expect(checkGeo({ country_code: "RU" }, geoPolicy).allowed).toBe(false);
    });

    test("evaluates IP range blocklists and allowlists", () => {
      const geoPolicy = {
        enabled: true,
        allowed_countries: [],
        blocked_countries: [],
        allowed_ip_ranges: ["192.168.1.0/24"],
        blocked_ip_ranges: ["192.168.1.50/32"],
      };

      expect(checkGeo({ ip_address: "192.168.1.10" }, geoPolicy).allowed).toBe(
        true,
      );
      expect(checkGeo({ ip_address: "192.168.1.50" }, geoPolicy).allowed).toBe(
        false,
      );
      expect(checkGeo({ ip_address: "10.0.0.1" }, geoPolicy).allowed).toBe(
        false,
      );
    });
  });

  describe("Time-Based Access Controls", () => {
    test("restricts access based on allowed days of week", () => {
      const mondayTimestamp = new Date("2026-08-24T10:00:00Z").getTime(); // Monday
      const sundayTimestamp = new Date("2026-08-23T10:00:00Z").getTime(); // Sunday

      const timePolicy = {
        enabled: true,
        allowed_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
        start_time: "00:00",
        end_time: "23:59",
      };

      expect(
        checkTime({ timestamp: mondayTimestamp }, timePolicy).allowed,
      ).toBe(true);
      expect(
        checkTime({ timestamp: sundayTimestamp }, timePolicy).allowed,
      ).toBe(false);
    });

    test("restricts access based on daily time windows", () => {
      const workHoursTimestamp = new Date("2026-08-24T10:00:00Z").getTime(); // 10:00 UTC
      const nightTimestamp = new Date("2026-08-24T03:00:00Z").getTime(); // 03:00 UTC

      const timePolicy = {
        enabled: true,
        allowed_days: ["Mon"],
        start_time: "08:00",
        end_time: "18:00",
      };

      expect(
        checkTime({ timestamp: workHoursTimestamp }, timePolicy).allowed,
      ).toBe(true);
      expect(checkTime({ timestamp: nightTimestamp }, timePolicy).allowed).toBe(
        false,
      );
    });
  });

  describe("Data Loss Prevention (DLP)", () => {
    const sampleTextWithSecrets =
      "Deploying with AWS Key AKIAIOSFODNN7EXAMPLE and SSN 123-45-6789";

    test("detects sensitive patterns in command strings", () => {
      const violations = checkDLP(
        sampleTextWithSecrets,
        DEFAULT_POLICY_CONFIG.dlp,
      );
      expect(violations.length).toBeGreaterThanOrEqual(2);
      expect(violations.some((v) => v.name === "AWS Access Key")).toBe(true);
      expect(violations.some((v) => v.name === "SSN")).toBe(true);
    });

    test("redacts sensitive DLP patterns correctly", () => {
      const redacted = redactDLP(
        sampleTextWithSecrets,
        DEFAULT_POLICY_CONFIG.dlp,
      );
      expect(redacted).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(redacted).not.toContain("123-45-6789");
      expect(redacted).toContain("[REDACTED_CREDENTIALS]");
      expect(redacted).toContain("[REDACTED_PII]");
    });
  });

  describe("Unified Policy Evaluation (`evaluatePolicy`)", () => {
    test("bypasses evaluation when policy is globally disabled", () => {
      const disabledPolicy = { enabled: false };
      const res = evaluatePolicy("deploy app", {}, {}, disabledPolicy);
      expect(res.allowed).toBe(true);
      expect(res.action).toBe("allow");
    });

    test("blocks non-MFA request for sensitive deployment command", () => {
      const res = evaluatePolicy("deploy app to production");
      expect(res.allowed).toBe(false);
      expect(res.action).toBe("mfa_required");
      expect(res.mfa_required).toBe(true);
      expect(res.mfa_verified).toBe(false);
    });

    test("allows sensitive command when valid TOTP token is provided", () => {
      const totp = generateTOTP(TEST_SECRET);
      const res = evaluatePolicy(
        "deploy app to production",
        {},
        { mfa_token: totp },
        DEFAULT_POLICY_CONFIG,
      );
      expect(res.allowed).toBe(true);
      expect(res.action).toBe("allow");
      expect(res.mfa_verified).toBe(true);
    });

    test("blocks execution when DLP pattern is detected and action is 'block'", () => {
      const secretCommand = "echo AKIAIOSFODNN7EXAMPLE";
      const res = evaluatePolicy(secretCommand, {}, {}, DEFAULT_POLICY_CONFIG);
      expect(res.allowed).toBe(false);
      expect(res.action).toBe("block");
      expect(res.dlp_violations.length).toBeGreaterThan(0);
    });

    test("redacts execution input when DLP action is set to 'redact'", () => {
      const redactPolicy = {
        ...DEFAULT_POLICY_CONFIG,
        dlp: {
          ...DEFAULT_POLICY_CONFIG.dlp,
          action: "redact",
        },
      };
      const secretCommand = "echo AKIAIOSFODNN7EXAMPLE";
      const res = evaluatePolicy(secretCommand, {}, {}, redactPolicy);
      expect(res.allowed).toBe(true);
      expect(res.action).toBe("redact");
      expect(res.sanitized_command).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(res.sanitized_command).toContain("[REDACTED_CREDENTIALS]");
    });
  });

  describe("Performance Benchmarks", () => {
    test("meets high-performance throughput requirement (>1,000 policy evaluations/sec)", () => {
      const start = Date.now();
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        evaluatePolicy(
          "make build",
          { host: "localhost" },
          { user: "developer" },
        );
      }

      const durationMs = Date.now() - start;
      expect(durationMs).toBeLessThan(500); // 1000 evaluations in < 500ms
    });
  });
});
