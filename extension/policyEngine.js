/**
 * Policy Enforcement Engine for CmdBar extension.
 * Supports:
 * - Multi-Factor Authentication (MFA) for sensitive operations
 * - Data Loss Prevention (DLP) for inputs and outputs (Credit Cards, SSN, API keys, Private keys)
 * - Geographic restrictions (Country code allow/deny lists, IP CIDR matching)
 * - Time-based access control (Allowed days, allowed hour ranges, timezone support)
 */

export const DEFAULT_DLP_PATTERNS = {
  credit_card: {
    name: "Credit Card Number",
    regex: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    redactLabel: "[REDACTED:CREDIT_CARD]",
    luhnCheck: true,
  },
  ssn: {
    name: "Social Security Number",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    redactLabel: "[REDACTED:SSN]",
  },
  aws_key: {
    name: "AWS Access Key",
    regex: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
    redactLabel: "[REDACTED:AWS_KEY]",
  },
  private_key: {
    name: "Private Key Header",
    regex: /-----BEGIN (?:RSA|OPENSSH|EC|DSA|PGP)? PRIVATE KEY-----[\s\S]*?-----END (?:RSA|OPENSSH|EC|DSA|PGP)? PRIVATE KEY-----/g,
    redactLabel: "[REDACTED:PRIVATE_KEY]",
  },
  api_token: {
    name: "API Token / Password",
    regex: /\b(?:bearer|api[-_]?key|secret|password|passwd|auth[-_]?token)\b\s*[:=]\s*["']?([A-Za-z0-9_\-\.\~]{12,})["']?/gi,
    redactLabel: "[REDACTED:API_TOKEN]",
  },
};

export const DEFAULT_SENSITIVE_COMMAND_PATTERNS = [
  "*deploy*",
  "*rm -rf*",
  "*sudo*",
  "*aws ecs*",
  "*db:drop*",
  "*db:migrate*",
  "*pkill*",
];

/**
 * Validates a number string using the Luhn Algorithm.
 * @param {string} numStr
 * @returns {boolean}
 */
export function validateLuhn(numStr) {
  const clean = numStr.replace(/\D/g, "");
  if (clean.length < 11 || clean.length > 19) return false;

  let sum = 0;
  let shouldDouble = false;
  for (let i = clean.length - 1; i >= 0; i--) {
    let digit = parseInt(clean.charAt(i), 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

/**
 * Simple IPv4 in CIDR range checker.
 * @param {string} ip
 * @param {string} cidr
 * @returns {boolean}
 */
export function isIpInCidr(ip, cidr) {
  if (!ip || !cidr) return false;
  if (ip === cidr) return true;

  if (!cidr.includes("/")) {
    return ip === cidr;
  }

  const [rangeIp, prefixStr] = cidr.split("/");
  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

  const ipNum = ipToLong(ip);
  const rangeNum = ipToLong(rangeIp);

  if (ipNum === null || rangeNum === null) return false;

  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipNum & mask) === (rangeNum & mask);
}

function ipToLong(ip) {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let num = 0;
  for (let i = 0; i < 4; i++) {
    const part = parseInt(parts[i], 10);
    if (isNaN(part) || part < 0 || part > 255) return null;
    num = (num << 8) + part;
  }
  return num >>> 0;
}

export class PolicyEngine {
  /**
   * @param {object} [policyConfig]
   */
  constructor(policyConfig = {}) {
    this.mfaSession = {
      verified: false,
      timestamp: 0,
      token: null,
    };

    this.configure(policyConfig);
  }

  /**
   * Updates or replaces the policy engine configuration.
   * @param {object} policyConfig
   */
  configure(policyConfig = {}) {
    this.mfaConfig = {
      enabled: policyConfig.mfa?.enabled ?? false,
      sensitiveCommands: policyConfig.mfa?.sensitiveCommands || [
        ...DEFAULT_SENSITIVE_COMMAND_PATTERNS,
      ],
      mfaSecret: policyConfig.mfa?.mfaSecret || "123456",
      sessionDurationMs: policyConfig.mfa?.sessionDurationMs || 300000, // 5 minutes default
    };

    this.dlpConfig = {
      enabled: policyConfig.dlp?.enabled ?? true,
      action: policyConfig.dlp?.action || "redact", // "redact", "block", or "warn"
      customPatterns: policyConfig.dlp?.customPatterns || {},
    };

    this.geoConfig = {
      enabled: policyConfig.geo?.enabled ?? false,
      allowedCountries: policyConfig.geo?.allowedCountries || [],
      blockedCountries: policyConfig.geo?.blockedCountries || [],
      allowedIpRanges: policyConfig.geo?.allowedIpRanges || [],
      blockedIpRanges: policyConfig.geo?.blockedIpRanges || [],
    };

    this.timeConfig = {
      enabled: policyConfig.time?.enabled ?? false,
      allowedDays: policyConfig.time?.allowedDays || [
        "Mon",
        "Tue",
        "Wed",
        "Thu",
        "Fri",
      ],
      allowedHours: policyConfig.time?.allowedHours || {
        start: "00:00",
        end: "23:59",
      },
      timezone: policyConfig.time?.timezone || "UTC",
    };
  }

  /**
   * Checks if an MFA session is currently active and valid.
   * @param {number} [nowTimestamp]
   * @returns {boolean}
   */
  isMfaSessionValid(nowTimestamp = Date.now()) {
    if (!this.mfaSession.verified) return false;
    const elapsed = nowTimestamp - this.mfaSession.timestamp;
    return elapsed >= 0 && elapsed <= this.mfaConfig.sessionDurationMs;
  }

  /**
   * Verifies an MFA token against secret or validator.
   * @param {string} token
   * @param {number} [nowTimestamp]
   * @returns {boolean}
   */
  verifyMfaToken(token, nowTimestamp = Date.now()) {
    if (!token) return false;
    const cleanToken = String(token).trim();
    if (cleanToken === String(this.mfaConfig.mfaSecret).trim()) {
      this.mfaSession = {
        verified: true,
        timestamp: nowTimestamp,
        token: cleanToken,
      };
      return true;
    }
    return false;
  }

  /**
   * Clears active MFA session.
   */
  clearMfaSession() {
    this.mfaSession = {
      verified: false,
      timestamp: 0,
      token: null,
    };
  }

  /**
   * Determines if a command or operation is considered sensitive and requires MFA.
   * @param {object|string} commandObj
   * @returns {boolean}
   */
  isSensitiveOperation(commandObj) {
    if (!commandObj) return false;

    let cmdStr = "";
    let isExplicitSensitive = false;

    if (typeof commandObj === "string") {
      cmdStr = commandObj;
    } else if (typeof commandObj === "object") {
      cmdStr = commandObj.command || commandObj.name || "";
      if (commandObj.sensitive || commandObj.require_mfa) {
        isExplicitSensitive = true;
      }
    }

    if (isExplicitSensitive) return true;

    const lowerCmd = cmdStr.toLowerCase().trim();
    for (const pattern of this.mfaConfig.sensitiveCommands) {
      const p = pattern.toLowerCase();
      if (p.startsWith("*") && p.endsWith("*")) {
        const sub = p.slice(1, -1);
        if (lowerCmd.includes(sub)) return true;
      } else if (p.startsWith("*")) {
        const sub = p.slice(1);
        if (lowerCmd.endsWith(sub)) return true;
      } else if (p.endsWith("*")) {
        const sub = p.slice(0, -1);
        if (lowerCmd.startsWith(sub)) return true;
      } else if (lowerCmd === p) {
        return true;
      }
    }

    return false;
  }

  /**
   * Scans text for sensitive data loss patterns (DLP).
   * @param {string} text
   * @returns {{ matches: Array<{ rule: string, value: string }>, redactedText: string }}
   */
  scanDlp(text) {
    if (!text || typeof text !== "string") {
      return { matches: [], redactedText: text || "" };
    }

    const matches = [];
    let redactedText = text;

    const allPatterns = {
      ...DEFAULT_DLP_PATTERNS,
      ...this.dlpConfig.customPatterns,
    };

    for (const [ruleKey, rule] of Object.entries(allPatterns)) {
      const regex = new RegExp(rule.regex.source, rule.regex.flags || "g");
      let match;
      while ((match = regex.exec(text)) !== null) {
        const val = match[0];
        if (rule.luhnCheck) {
          if (!validateLuhn(val)) continue;
        }

        matches.push({
          rule: ruleKey,
          name: rule.name || ruleKey,
          value: val,
        });

        redactedText = redactedText.replace(
          val,
          rule.redactLabel || "[DLP REDACTED]",
        );
      }
    }

    return { matches, redactedText };
  }

  /**
   * Evaluates geographic restrictions based on user location context.
   * @param {object} geoContext
   * @returns {{ allowed: boolean, reason: string|null }}
   */
  evaluateGeo(geoContext = {}) {
    if (!this.geoConfig.enabled) {
      return { allowed: true, reason: null };
    }

    const country = (geoContext.countryCode || geoContext.country || "").toUpperCase().trim();
    const ip = (geoContext.ip || "").trim();

    // 1. Country code check
    if (country) {
      if (
        this.geoConfig.blockedCountries.length > 0 &&
        this.geoConfig.blockedCountries.map((c) => c.toUpperCase()).includes(country)
      ) {
        return {
          allowed: false,
          reason: `Geographic Restriction: Country '${country}' is blocked.`,
        };
      }

      if (
        this.geoConfig.allowedCountries.length > 0 &&
        !this.geoConfig.allowedCountries.map((c) => c.toUpperCase()).includes(country)
      ) {
        return {
          allowed: false,
          reason: `Geographic Restriction: Country '${country}' is not in allowed list.`,
        };
      }
    }

    // 2. IP Range check
    if (ip) {
      if (this.geoConfig.blockedIpRanges.length > 0) {
        for (const cidr of this.geoConfig.blockedIpRanges) {
          if (isIpInCidr(ip, cidr)) {
            return {
              allowed: false,
              reason: `Geographic Restriction: IP address '${ip}' matches blocked range '${cidr}'.`,
            };
          }
        }
      }

      if (this.geoConfig.allowedIpRanges.length > 0) {
        let matched = false;
        for (const cidr of this.geoConfig.allowedIpRanges) {
          if (isIpInCidr(ip, cidr)) {
            matched = true;
            break;
          }
        }
        if (!matched) {
          return {
            allowed: false,
            reason: `Geographic Restriction: IP address '${ip}' is not in allowed IP ranges.`,
          };
        }
      }
    }

    return { allowed: true, reason: null };
  }

  /**
   * Evaluates time-based access control against execution timestamp.
   * @param {Date|number|string} [timeContext]
   * @returns {{ allowed: boolean, reason: string|null }}
   */
  evaluateTime(timeContext) {
    if (!this.timeConfig.enabled) {
      return { allowed: true, reason: null };
    }

    const dateObj = timeContext ? new Date(timeContext) : new Date();
    if (isNaN(dateObj.getTime())) {
      return { allowed: true, reason: null };
    }

    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const currentDay = dayNames[dateObj.getUTCDay()];

    if (
      this.timeConfig.allowedDays &&
      this.timeConfig.allowedDays.length > 0
    ) {
      const allowedDaysUpper = this.timeConfig.allowedDays.map((d) =>
        String(d).toUpperCase().slice(0, 3),
      );
      if (!allowedDaysUpper.includes(currentDay.toUpperCase())) {
        return {
          allowed: false,
          reason: `Time Restriction: Access not allowed on ${currentDay}. Allowed days: ${this.timeConfig.allowedDays.join(
            ", ",
          )}.`,
        };
      }
    }

    if (this.timeConfig.allowedHours) {
      const startStr = this.timeConfig.allowedHours.start || "00:00";
      const endStr = this.timeConfig.allowedHours.end || "23:59";

      const [startH, startM] = startStr.split(":").map((v) => parseInt(v, 10) || 0);
      const [endH, endM] = endStr.split(":").map((v) => parseInt(v, 10) || 0);

      const currentMinutes = dateObj.getUTCHours() * 60 + dateObj.getUTCMinutes();
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      if (currentMinutes < startMinutes || currentMinutes > endMinutes) {
        const timeStr = `${String(dateObj.getUTCHours()).padStart(2, "0")}:${String(
          dateObj.getUTCMinutes(),
        ).padStart(2, "0")}`;
        return {
          allowed: false,
          reason: `Time Restriction: Access not allowed at ${timeStr} UTC. Allowed hours: ${startStr} - ${endStr}.`,
        };
      }
    }

    return { allowed: true, reason: null };
  }

  /**
   * Main evaluation entry point for command execution contexts.
   * @param {object} evalContext
   * @param {object|string} evalContext.command
   * @param {object} [evalContext.parameters]
   * @param {string} [evalContext.mfaToken]
   * @param {object} [evalContext.geo]
   * @param {Date|number|string} [evalContext.timestamp]
   * @returns {object} Evaluation results
   */
  evaluate(evalContext = {}) {
    const reasons = [];
    let allowed = true;

    const now = evalContext.timestamp
      ? new Date(evalContext.timestamp).getTime()
      : Date.now();

    // 1. Geographic Check
    const geoRes = this.evaluateGeo(evalContext.geo || {});
    if (!geoRes.allowed) {
      allowed = false;
      reasons.push(geoRes.reason);
    }

    // 2. Time Check
    const timeRes = this.evaluateTime(evalContext.timestamp);
    if (!timeRes.allowed) {
      allowed = false;
      reasons.push(timeRes.reason);
    }

    // 3. MFA Check for Sensitive Operations
    const isSensitive = this.isSensitiveOperation(evalContext.command);
    let mfaRequired = false;
    let mfaVerified = false;

    if (this.mfaConfig.enabled && isSensitive) {
      mfaRequired = true;
      if (evalContext.mfaToken) {
        this.verifyMfaToken(evalContext.mfaToken, now);
      }
      mfaVerified = this.isMfaSessionValid(now);

      if (!mfaVerified) {
        allowed = false;
        reasons.push("MFA Authentication Required: Sensitive operation requires verified MFA token.");
      }
    }

    // 4. DLP Scan on Inputs
    let redactedCommand =
      typeof evalContext.command === "string"
        ? evalContext.command
        : evalContext.command?.command || "";
    let redactedParameters = { ...(evalContext.parameters || {}) };
    let dlpMatches = [];

    if (this.dlpConfig.enabled) {
      const cmdScan = this.scanDlp(redactedCommand);
      dlpMatches.push(...cmdScan.matches);
      redactedCommand = cmdScan.redactedText;

      for (const [key, val] of Object.entries(redactedParameters)) {
        if (typeof val === "string") {
          const paramScan = this.scanDlp(val);
          dlpMatches.push(...paramScan.matches);
          redactedParameters[key] = paramScan.redactedText;
        }
      }

      if (dlpMatches.length > 0) {
        if (this.dlpConfig.action === "block") {
          allowed = false;
          reasons.push(`DLP Violation: Blocked due to sensitive data detection (${dlpMatches.map((m) => m.name).join(", ")}).`);
        } else if (this.dlpConfig.action === "warn") {
          reasons.push(`DLP Warning: Sensitive data detected (${dlpMatches.map((m) => m.name).join(", ")}).`);
        }
      }
    }

    return {
      allowed,
      mfaRequired,
      mfaVerified,
      reasons,
      dlpMatches,
      redactedCommand,
      redactedParameters,
      redactOutput: (outputStr) => {
        if (!this.dlpConfig.enabled || !outputStr) return outputStr;
        const scan = this.scanDlp(outputStr);
        return scan.redactedText;
      },
    };
  }
}

export function createPolicyEngine(config = {}) {
  return new PolicyEngine(config);
}
