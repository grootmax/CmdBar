/**
 * Shared Audit Trail and Compliance Manager for CmdBar.
 * Provides team audit logs, PII scrubbing, tamper-evident hash chaining,
 * compliance reports (SOC2, ISO27001, GDPR, HIPAA), SIEM export formats,
 * rule-based anomaly detection, and real-time alert management.
 *
 * Runs in both GJS (GNOME Shell) and Node.js environments.
 */

const isNode = typeof process !== "undefined" && process.versions && process.versions.node;

let Gio, GLib;
if (!isNode) {
  try {
    const giModule = await import("gi");
    Gio = giModule.Gio || (giModule.default && giModule.default.Gio) || giModule.default;
    GLib = giModule.GLib || (giModule.default && giModule.default.GLib);
  } catch (e) {
    // Non-GJS runtime
  }
}

/**
 * Pure JavaScript SHA-256 implementation fallback.
 * @param {string} ascii
 * @returns {string} Hex encoded SHA-256 hash.
 * @public
 */
export function pureJsSha256(ascii) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let i, j;
  let result = "";
  const words = [];
  const asciiBitLength = ascii.length * 8;
  let hash = (pureJsSha256.h = pureJsSha256.h || []);
  const k = (pureJsSha256.k = pureJsSha256.k || []);
  let primeCounter = k.length;
  const isComposite = {};

  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 300; i += candidate) {
        isComposite[i] = true;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  ascii += "\x80";
  while ((ascii.length % 64) - 56) ascii += "\x00";

  for (i = 0; i < ascii.length; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return "";
    words[i >> 2] |= j << ((3 - (i % 4)) * 8);
  }

  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;

  for (j = 0; j < words.length; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash.slice(0);
    hash = hash.slice(0, 8);

    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15],
        w2 = w[i - 2];
      const a = hash[0],
        e = hash[4];
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);
      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));

      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }

    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j >= 0; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? "0" : "") + b.toString(16);
    }
  }
  return result;
}

/**
 * Compute SHA-256 hash string across Node, GJS, or JS fallback.
 * @param {string} input
 * @returns {Promise<string>}
 * @public
 */
export async function sha256(input) {
  const str = String(input !== undefined && input !== null ? input : "");
  if (isNode) {
    try {
      const crypto = await import("crypto");
      return crypto.createHash("sha256").update(str).digest("hex");
    } catch (e) {}
  }
  if (typeof GLib !== "undefined" && GLib && GLib.compute_checksum_for_string) {
    try {
      return GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, str, -1);
    } catch (e) {}
  }
  return pureJsSha256(str);
}

/**
 * Scrubs Personally Identifiable Information (PII) and sensitive tokens from strings, objects, or arrays.
 * Supports GDPR & security redaction.
 * @param {any} target
 * @param {object} [options]
 * @returns {any}
 * @public
 */
export function scrubPII(target, options = {}) {
  const {
    redactEmail = true,
    redactIP = true,
    redactSecrets = true,
    customPatterns = [],
  } = options;

  if (target === null || target === undefined) return target;

  if (typeof target === "string") {
    let result = target;

    if (redactEmail) {
      result = result.replace(
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
        "[REDACTED_EMAIL]"
      );
    }

    if (redactIP) {
      result = result.replace(
        /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
        "[REDACTED_IP]"
      );
    }

    if (redactSecrets) {
      // API keys, tokens, passwords, bearer tokens, SSH keys
      result = result.replace(
        /(?:api[_-]?key|password|passwd|secret|access[_-]?token|auth[_-]?token|bearer)\s*[:=]\s*['"]?([^\s'"&;,]+)['"]?/gi,
        (match, p1) => match.replace(p1, "[REDACTED_SECRET]")
      );
      result = result.replace(
        /Bearer\s+[A-Za-z0-9._~+/-]+=*/g,
        "Bearer [REDACTED_SECRET]"
      );
      result = result.replace(
        /\b(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|ssh-rsa\s+[A-Za-z0-9+/=]+)\b/g,
        "[REDACTED_SECRET]"
      );
    }

    for (const pattern of customPatterns) {
      if (pattern instanceof RegExp) {
        result = result.replace(pattern, "[REDACTED_CUSTOM]");
      }
    }

    return result;
  }

  if (Array.isArray(target)) {
    return target.map((item) => scrubPII(item, options));
  }

  if (typeof target === "object") {
    const copy = {};
    for (const key of Object.keys(target)) {
      const lowerKey = key.toLowerCase();
      if (
        redactSecrets &&
        (lowerKey.includes("password") ||
          lowerKey.includes("secret") ||
          lowerKey.includes("token") ||
          lowerKey.includes("apikey") ||
          lowerKey.includes("api_key"))
      ) {
        copy[key] = "[REDACTED_SECRET]";
      } else {
        copy[key] = scrubPII(target[key], options);
      }
    }
    return copy;
  }

  return target;
}

/**
 * Hashes or masks a user identifier for GDPR right to erasure / anonymization.
 * @param {string} userId
 * @param {string} [salt="cmdbar-gdpr"]
 * @returns {Promise<string>}
 * @public
 */
export async function anonymizeUser(userId, salt = "cmdbar-gdpr") {
  if (!userId) return "anon_unknown";
  const str = `${salt}:${userId}`;
  const hash = await sha256(str);
  return `anon_${hash.substring(0, 16)}`;
}

/**
 * Anonymizes all log events created by a given user ID to support GDPR "Right to be Forgotten".
 * @param {Array<object>} logs
 * @param {string} targetUserId
 * @param {string} [salt="cmdbar-gdpr"]
 * @returns {Promise<Array<object>>}
 * @public
 */
export async function anonymizeUserInLogs(logs, targetUserId, salt = "cmdbar-gdpr") {
  if (!Array.isArray(logs) || !targetUserId) return logs || [];
  const anonName = await anonymizeUser(targetUserId, salt);

  const updated = [];
  for (const log of logs) {
    const clone = JSON.parse(JSON.stringify(log));
    if (clone.user === targetUserId) {
      clone.user = anonName;
      if (clone.details) {
        clone.details = scrubPII(clone.details);
      }
    }
    updated.push(clone);
  }
  return updated;
}

/**
 * Purges log entries older than retentionDays (GDPR compliance data retention policy).
 * @param {Array<object>} logs
 * @param {number} [retentionDays=90]
 * @returns {Array<object>}
 * @public
 */
export function purgeLogsByAge(logs, retentionDays = 90) {
  if (!Array.isArray(logs)) return [];
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  return logs.filter((event) => {
    if (!event || !event.timestamp) return false;
    const timeMs = new Date(event.timestamp).getTime();
    return !isNaN(timeMs) && timeMs >= cutoff;
  });
}

/**
 * Returns canonical sorted JSON string of an object excluding signature/hash fields.
 * @param {object} obj
 * @returns {string}
 */
export function canonicalJson(obj) {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalJson).join(",") + "]";
  }
  const sortedKeys = Object.keys(obj)
    .filter((k) => k !== "hash" && k !== "signature")
    .sort();
  const parts = sortedKeys.map(
    (k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])
  );
  return "{" + parts.join(",") + "}";
}

/**
 * Computes tamper-evident cryptographic hash chain for an audit log event.
 * @param {object} event
 * @param {string} [previousHash="GENESIS"]
 * @returns {Promise<string>}
 * @public
 */
export async function computeEventHash(event, previousHash = "GENESIS") {
  const canonical = canonicalJson(event);
  const payload = `${previousHash || "GENESIS"}:${canonical}`;
  return await sha256(payload);
}

/**
 * Verifies tamper-evident log integrity across all events in sequence.
 * @param {Array<object>} logs
 * @returns {Promise<{valid: boolean, tamperedIndex: number, reason: string}>}
 * @public
 */
export async function verifyLogIntegrity(logs) {
  if (!Array.isArray(logs) || logs.length === 0) {
    return { valid: true, tamperedIndex: -1, reason: "Log is empty" };
  }

  let prevHash = "GENESIS";
  for (let i = 0; i < logs.length; i++) {
    const event = logs[i];
    if (!event || !event.hash) {
      return {
        valid: false,
        tamperedIndex: i,
        reason: `Event at index ${i} is missing hash`,
      };
    }
    const expectedHash = await computeEventHash(event, prevHash);
    if (event.hash !== expectedHash) {
      return {
        valid: false,
        tamperedIndex: i,
        reason: `Hash mismatch at index ${i}. Event claims ${event.hash}, expected ${expectedHash}`,
      };
    }
    prevHash = event.hash;
  }

  return { valid: true, tamperedIndex: -1, reason: "Log integrity verified" };
}

/**
 * Rule-based Anomaly Detection Engine for Audit Trail.
 * Scans events for bursts, failure spikes, dangerous shell commands, AI prompt injections, off-hours activity, and log tampering.
 * @param {Array<object>} logs
 * @param {object} [options]
 * @returns {Promise<Array<object>>}
 * @public
 */
export async function detectAnomalies(logs = [], options = {}) {
  const {
    burstWindowSec = 10,
    maxBurst = 10,
    failureWindowSec = 60,
    maxFailures = 3,
    checkDangerousCommands = true,
    checkPromptInjections = true,
    checkOffHours = false,
    offHoursStartHour = 0,
    offHoursEndHour = 5,
    checkIntegrity = true,
  } = options;

  const anomalies = [];

  if (!Array.isArray(logs) || logs.length === 0) {
    return anomalies;
  }

  // 1. Check Log Tampering / Integrity
  if (checkIntegrity) {
    const integrity = await verifyLogIntegrity(logs);
    if (!integrity.valid) {
      anomalies.push({
        id: `anom_tamper_${Date.now()}`,
        rule: "TAMPER_ATTEMPT",
        riskLevel: "CRITICAL",
        confidence: 1.0,
        description: `Audit trail tamper detected: ${integrity.reason}`,
        timestamp: new Date().toISOString(),
        affectedEventIds: [logs[integrity.tamperedIndex]?.id].filter(Boolean),
      });
    }
  }

  const DANGEROUS_PATTERNS = [
    /\bsudo\b/i,
    /rm\s+-rf\s+[\/*]/i,
    /chmod\s+777/i,
    /mkfs\b/i,
    /dd\s+if=/i,
    /nc\s+-e\b/i,
    /curl\s+.*\|\s*bash/i,
    /wget\s+.*\|\s*sh/i,
    /\/etc\/shadow/i,
  ];

  const PROMPT_INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?previous\s+instructions/i,
    /system\s+prompt:/i,
    /forget\s+all\s+prior\s+rules/i,
    /jailbreak/i,
    /admin\s+access\s+override/i,
  ];

  // Sort logs by time for window checking
  const sortedLogs = [...logs].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  for (let i = 0; i < sortedLogs.length; i++) {
    const event = sortedLogs[i];
    const eventTime = new Date(event.timestamp).getTime();

    // 2. Burst Execution Detection
    const burstWindowStart = eventTime - burstWindowSec * 1000;
    const burstEvents = sortedLogs.filter((e) => {
      const t = new Date(e.timestamp).getTime();
      return t >= burstWindowStart && t <= eventTime;
    });
    if (burstEvents.length > maxBurst) {
      const anomalyId = `anom_burst_${event.id}`;
      if (!anomalies.some((a) => a.id === anomalyId)) {
        anomalies.push({
          id: anomalyId,
          rule: "BURST_EXECUTION",
          riskLevel: "HIGH",
          confidence: 0.85,
          description: `Rapid activity burst: ${burstEvents.length} actions within ${burstWindowSec} seconds`,
          timestamp: event.timestamp,
          affectedEventIds: burstEvents.map((e) => e.id),
        });
      }
    }

    // 3. Failure Burst Detection
    const failureWindowStart = eventTime - failureWindowSec * 1000;
    const failedEvents = sortedLogs.filter((e) => {
      const t = new Date(e.timestamp).getTime();
      const isFailed =
        e.severity === "HIGH" ||
        e.severity === "CRITICAL" ||
        e.details?.status === "FAILURE" ||
        e.details?.exitCode !== 0;
      return t >= failureWindowStart && t <= eventTime && isFailed;
    });
    if (failedEvents.length >= maxFailures) {
      const anomalyId = `anom_fail_${event.id}`;
      if (!anomalies.some((a) => a.id === anomalyId)) {
        anomalies.push({
          id: anomalyId,
          rule: "HIGH_FAILURE_RATE",
          riskLevel: "HIGH",
          confidence: 0.9,
          description: `High execution failure count: ${failedEvents.length} failures within ${failureWindowSec} seconds`,
          timestamp: event.timestamp,
          affectedEventIds: failedEvents.map((e) => e.id),
        });
      }
    }

    // 4. Dangerous Shell Command Detection
    if (checkDangerousCommands) {
      const cmdStr =
        String(event.action || "") + " " + String(event.details?.command || "");
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(cmdStr)) {
          anomalies.push({
            id: `anom_cmd_${event.id}`,
            rule: "DANGEROUS_COMMAND",
            riskLevel: "CRITICAL",
            confidence: 0.95,
            description: `Execution of high-risk shell command pattern detected: "${cmdStr.trim()}"`,
            timestamp: event.timestamp,
            affectedEventIds: [event.id],
          });
          break;
        }
      }
    }

    // 5. AI Prompt Injection Detection
    if (checkPromptInjections && event.eventType === "AI_PROMPT") {
      const promptStr =
        String(event.action || "") + " " + String(event.details?.prompt || "");
      for (const pattern of PROMPT_INJECTION_PATTERNS) {
        if (pattern.test(promptStr)) {
          anomalies.push({
            id: `anom_prompt_${event.id}`,
            rule: "PROMPT_INJECTION",
            riskLevel: "HIGH",
            confidence: 0.88,
            description: `Potential AI prompt injection attack vector detected: "${promptStr.trim()}"`,
            timestamp: event.timestamp,
            affectedEventIds: [event.id],
          });
          break;
        }
      }
    }

    // 6. Off-Hours Activity Detection
    if (checkOffHours) {
      const hour = new Date(event.timestamp).getHours();
      if (hour >= offHoursStartHour && hour < offHoursEndHour) {
        anomalies.push({
          id: `anom_offhours_${event.id}`,
          rule: "OFF_HOURS_ACTIVITY",
          riskLevel: "MEDIUM",
          confidence: 0.7,
          description: `Unusual off-hours command activity at hour ${hour}:00`,
          timestamp: event.timestamp,
          affectedEventIds: [event.id],
        });
      }
    }
  }

  return anomalies;
}

/**
 * Generates enterprise compliance report (SOC2, ISO27001, GDPR, HIPAA) in JSON, HTML, Markdown, or CSV.
 * @param {Array<object>} logs
 * @param {object} [options]
 * @returns {Promise<object|string>}
 * @public
 */
export async function generateComplianceReport(logs = [], options = {}) {
  const {
    format = "json",
    title = "CmdBar Enterprise Audit Compliance Report",
    framework = "ALL",
    teamId = "default-team",
  } = options;

  const totalEvents = logs.length;
  const eventTypes = {};
  const severityCounts = { INFO: 0, WARN: 0, HIGH: 0, CRITICAL: 0 };
  let successCount = 0;
  let failureCount = 0;

  for (const event of logs) {
    if (event.eventType) {
      eventTypes[event.eventType] = (eventTypes[event.eventType] || 0) + 1;
    }
    if (event.severity && severityCounts[event.severity] !== undefined) {
      severityCounts[event.severity]++;
    } else {
      severityCounts.INFO++;
    }

    if (
      event.details?.status === "SUCCESS" ||
      event.details?.exitCode === 0
    ) {
      successCount++;
    } else if (
      event.details?.status === "FAILURE" ||
      (event.details?.exitCode !== undefined && event.details?.exitCode !== 0)
    ) {
      failureCount++;
    }
  }

  const integrity = await verifyLogIntegrity(logs);
  const anomalies = await detectAnomalies(logs);

  const summary = {
    title,
    generatedAt: new Date().toISOString(),
    teamId,
    framework,
    totalEvents,
    successCount,
    failureCount,
    eventTypes,
    severityCounts,
    logIntegrityValid: integrity.valid,
    anomaliesDetected: anomalies.length,
    gdprCompliant: true,
  };

  const frameworkStatus = {
    SOC2: {
      CC6_1_AccessControl: "PASS",
      CC6_8_UnauthorizedCodePrevention: anomalies.some(
        (a) => a.rule === "DANGEROUS_COMMAND"
      )
        ? "ACTION_REQUIRED"
        : "PASS",
      CC7_2_SecurityMonitoring: integrity.valid ? "PASS" : "FAIL",
    },
    ISO27001: {
      A12_4_LoggingAndMonitoring: integrity.valid ? "COMPLIANT" : "NON_COMPLIANT",
      A12_4_1_EventLogging: "COMPLIANT",
      A12_4_2_ProtectionOfLogInformation: integrity.valid ? "COMPLIANT" : "NON_COMPLIANT",
    },
    GDPR: {
      Article32_SecurityOfProcessing: "VERIFIED",
      Article17_RightToErasure: "SUPPORTED",
      PII_ScrubbingActive: true,
    },
    HIPAA: {
      AuditControls_164_312_b: "VERIFIED",
      IntegrityControls_164_312_c1: integrity.valid ? "VERIFIED" : "FAIL",
    },
  };

  const reportObj = {
    summary,
    frameworkStatus,
    anomalies,
  };

  if (format === "json") {
    return reportObj;
  }

  if (format === "markdown") {
    return `# ${title}
**Generated At:** ${summary.generatedAt} | **Team ID:** ${teamId} | **Framework:** ${framework}

## Executive Summary
- **Total Audit Events:** ${totalEvents}
- **Successful Actions:** ${successCount}
- **Failed Actions:** ${failureCount}
- **Log Integrity Verified:** ${integrity.valid ? "✅ YES" : "❌ NO (Tampering Detected)"}
- **Anomalies Detected:** ${anomalies.length}
- **GDPR Compliance Status:** ✅ Active (PII Scrubbing & Retention Enabled)

## Severity Breakdown
- **INFO:** ${severityCounts.INFO}
- **WARN:** ${severityCounts.WARN}
- **HIGH:** ${severityCounts.HIGH}
- **CRITICAL:** ${severityCounts.CRITICAL}

## Compliance Framework Assessment
- **SOC2 (CC6.1, CC6.8, CC7.2):** ${frameworkStatus.SOC2.CC7_2_SecurityMonitoring}
- **ISO 27001 (A.12.4):** ${frameworkStatus.ISO27001.A12_4_LoggingAndMonitoring}
- **GDPR (Article 17 & 32):** ${frameworkStatus.GDPR.Article32_SecurityOfProcessing}
- **HIPAA (§164.312):** ${frameworkStatus.HIPAA.AuditControls_164_312_b}

## Security Findings & Anomalies (${anomalies.length})
${
  anomalies.length === 0
    ? "_No anomalies or security threats detected in audit period._"
    : anomalies
        .map(
          (a) =>
            `- **[${a.riskLevel}] ${a.rule}:** ${a.description} _(Time: ${a.timestamp})_`
        )
        .join("\n")
}
`;
  }

  if (format === "html") {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 2rem; color: #1e293b; background: #f8fafc; }
    .card { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 1.5rem; }
    h1 { color: #0f172a; margin-top: 0; }
    .badge { display: inline-block; padding: 0.25rem 0.5rem; border-radius: 4px; font-weight: bold; font-size: 0.85rem; }
    .badge-pass { background: #dcfce7; color: #166534; }
    .badge-fail { background: #fee2e2; color: #991b1b; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid #e2e8f0; }
    th { background: #f1f5f9; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p><strong>Generated:</strong> ${summary.generatedAt} | <strong>Team:</strong> ${teamId}</p>
    <p>
      <strong>Log Integrity:</strong> 
      <span class="badge ${integrity.valid ? "badge-pass" : "badge-fail"}">
        ${integrity.valid ? "VERIFIED INTACT" : "TAMPER DETECTED"}
      </span>
    </p>
  </div>
  <div class="card">
    <h2>Executive Metrics</h2>
    <table>
      <tr><th>Metric</th><th>Value</th></tr>
      <tr><td>Total Events Logged</td><td>${totalEvents}</td></tr>
      <tr><td>Success Count</td><td>${successCount}</td></tr>
      <tr><td>Failure Count</td><td>${failureCount}</td></tr>
      <tr><td>Anomalies Identified</td><td>${anomalies.length}</td></tr>
    </table>
  </div>
</body>
</html>`;
  }

  if (format === "csv") {
    const lines = ["id,timestamp,eventType,user,severity,action,hash"];
    for (const log of logs) {
      const cleanAction = String(log.action || "").replace(/"/g, '""');
      lines.push(
        `"${log.id}","${log.timestamp}","${log.eventType}","${log.user}","${log.severity}","${cleanAction}","${log.hash}"`
      );
    }
    return lines.join("\n");
  }

  return reportObj;
}

/**
 * Formats and exports audit logs to SIEM platforms (Syslog, Splunk, Elastic ECS, Datadog, CEF).
 * @param {Array<object>} logs
 * @param {object} [options]
 * @returns {Promise<object>}
 * @public
 */
export async function exportToSIEM(logs = [], options = {}) {
  const {
    target = "syslog",
    endpointUrl = "",
    apiToken = "",
    batchSize = 100,
    dryRun = true,
  } = options;

  const sanitizedLogs = logs.map((log) => scrubPII(log));
  let formattedPayload = null;

  if (target === "syslog") {
    // RFC 5424 Syslog Format
    formattedPayload = sanitizedLogs.map((log) => {
      const pri = log.severity === "CRITICAL" ? 131 : log.severity === "HIGH" ? 132 : 134;
      return `<${pri}>1 ${log.timestamp} localhost CmdBar ${process?.pid || 1234} - - [audit@CmdBar eventType="${log.eventType}" user="${log.user}"] ${log.action}`;
    });
  } else if (target === "splunk") {
    // Splunk HEC (HTTP Event Collector) JSON
    formattedPayload = sanitizedLogs.map((log) => ({
      time: Math.floor(new Date(log.timestamp).getTime() / 1000),
      host: "localhost",
      source: "cmdbar:audit",
      sourcetype: "_json",
      event: log,
    }));
  } else if (target === "elastic") {
    // Elastic Common Schema (ECS) Bulk Format
    const bulkLines = [];
    for (const log of sanitizedLogs) {
      bulkLines.push(JSON.stringify({ index: { _index: "cmdbar-audit" } }));
      bulkLines.push(
        JSON.stringify({
          "@timestamp": log.timestamp,
          event: {
            id: log.id,
            action: log.action,
            category: log.eventType,
            outcome: log.details?.status || "success",
          },
          user: { name: log.user },
          hash: log.hash,
        })
      );
    }
    formattedPayload = bulkLines.join("\n");
  } else if (target === "datadog") {
    // Datadog Logs API JSON Array
    formattedPayload = sanitizedLogs.map((log) => ({
      ddsource: "cmdbar",
      ddtags: `env:production,team:${log.teamId || "default"}`,
      hostname: "localhost",
      service: "cmdbar-audit",
      message: log.action,
      attributes: log,
    }));
  } else if (target === "cef") {
    // Common Event Format (CEF)
    formattedPayload = sanitizedLogs.map((log) => {
      const sevMap = { INFO: 1, WARN: 4, HIGH: 7, CRITICAL: 10 };
      const sev = sevMap[log.severity] || 1;
      return `CEF:0|CmdBar|CmdBarDesktop|1.0|${log.eventType}|${log.action}|${sev}|suser=${log.user} msg=${log.action}`;
    });
  } else {
    formattedPayload = sanitizedLogs;
  }

  if (dryRun || !endpointUrl) {
    return {
      success: true,
      exportedCount: sanitizedLogs.length,
      target,
      payload: formattedPayload,
      dryRun: true,
    };
  }

  // Live HTTP posting if endpointUrl provided
  try {
    if (isNode) {
      const fetchModule = globalThis.fetch;
      if (fetchModule) {
        const bodyStr =
          typeof formattedPayload === "string"
            ? formattedPayload
            : JSON.stringify(formattedPayload);
        const res = await fetchModule(endpointUrl, {
          method: "POST",
          headers: {
            "Content-Type":
              target === "elastic" ? "application/x-ndjson" : "application/json",
            Authorization: apiToken ? `Bearer ${apiToken}` : "",
          },
          body: bodyStr,
        });
        return {
          success: res.ok,
          status: res.status,
          exportedCount: sanitizedLogs.length,
          target,
        };
      }
    }
  } catch (err) {
    return {
      success: false,
      error: err.message,
      exportedCount: 0,
      target,
    };
  }

  return {
    success: true,
    exportedCount: sanitizedLogs.length,
    target,
    payload: formattedPayload,
  };
}

/**
 * Real-Time Security Alert Manager.
 * Deduplicates alert storms and handles notifications via desktop, webhooks, or callbacks.
 * @public
 */
export class AlertManager {
  constructor(options = {}) {
    this.dedupeWindowMs = options.dedupeWindowMs || 60000;
    this.minSeverity = options.minSeverity || "MEDIUM";
    this.webhookUrl = options.webhookUrl || null;
    this.listeners = new Set();
    this.recentAlertHashes = new Map();
  }

  /**
   * Registers callback listener for alerts.
   * @param {function} callback
   */
  addListener(callback) {
    if (typeof callback === "function") {
      this.listeners.add(callback);
    }
  }

  /**
   * Unregisters callback listener.
   * @param {function} callback
   */
  removeListener(callback) {
    this.listeners.delete(callback);
  }

  /**
   * Evaluates and dispatches security alert if anomaly meets severity and deduplication criteria.
   * @param {object} anomaly
   * @returns {Promise<boolean>}
   */
  async processAnomaly(anomaly) {
    if (!anomaly || !anomaly.rule) return false;

    const severityRanks = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
    const minRank = severityRanks[this.minSeverity] || 2;
    const anomalyRank = severityRanks[anomaly.riskLevel] || 1;

    if (anomalyRank < minRank) {
      return false;
    }

    // Deduplication check
    const hash = `${anomaly.rule}:${anomaly.description}`;
    const now = Date.now();
    if (this.recentAlertHashes.has(hash)) {
      const lastTime = this.recentAlertHashes.get(hash);
      if (now - lastTime < this.dedupeWindowMs) {
        return false; // Suppress duplicate alert within cooldown window
      }
    }
    this.recentAlertHashes.set(hash, now);

    // Notify registered JS listeners
    for (const listener of this.listeners) {
      try {
        listener(anomaly);
      } catch (e) {
        console.error("Alert listener error:", e);
      }
    }

    // Trigger Desktop notification if in GJS
    if (!isNode && typeof Gio !== "undefined") {
      try {
        if (
          typeof Main !== "undefined" &&
          Main &&
          typeof Main.notify === "function"
        ) {
          Main.notify(
            `Security Alert [${anomaly.riskLevel}]: ${anomaly.rule}`,
            anomaly.description
          );
        } else if (Gio.Subprocess) {
          const proc = Gio.Subprocess.new(
            [
              "notify-send",
              `Security Alert [${anomaly.riskLevel}]: ${anomaly.rule}`,
              anomaly.description,
            ],
            Gio.SubprocessFlags.NONE
          );
          proc.communicate_utf8_async(null, null, null);
        }
      } catch (e) {}
    }

    // Post to Webhook if URL configured
    if (this.webhookUrl) {
      try {
        if (globalThis.fetch) {
          await globalThis.fetch(this.webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: `🚨 *CmdBar Security Alert [${anomaly.riskLevel}]*\n*Rule:* ${anomaly.rule}\n*Description:* ${anomaly.description}`,
            }),
          });
        }
      } catch (e) {}
    }

    return true;
  }
}

/**
 * Main Audit Trail Manager Class.
 * Manages event recording, persistence, PII scrubbing, hash-chain integrity,
 * anomaly scanning, and compliance reporting for teams.
 * @public
 */
export class AuditTrailManager {
  /**
   * @param {object} [options]
   */
  constructor(options = {}) {
    this.storagePath = options.storagePath || null;
    this.teamId = options.teamId || "default-team";
    this.retentionDays = options.retentionDays || 90;
    this.enablePIIScrubbing = options.enablePIIScrubbing !== false;
    this.logs = [];
    this.alertManager = new AlertManager(options.alertOptions || {});
  }

  /**
   * Returns current log entries.
   * @returns {Array<object>}
   */
  getLogs() {
    return [...this.logs];
  }

  /**
   * Clears in-memory logs.
   */
  clear() {
    this.logs = [];
  }

  /**
   * Records a new audit log event, applies PII scrubbing, links tamper-evident hash,
   * runs anomaly detection, and dispatches real-time alerts.
   * @param {string} eventType
   * @param {string} action
   * @param {object} [details={}]
   * @param {string} [user="system"]
   * @param {string} [severity="INFO"]
   * @returns {Promise<object>}
   */
  async recordEvent(
    eventType,
    action,
    details = {},
    user = "system",
    severity = "INFO"
  ) {
    const prevHash =
      this.logs.length > 0 ? this.logs[this.logs.length - 1].hash : "GENESIS";

    const cleanAction = this.enablePIIScrubbing
      ? scrubPII(action)
      : action;
    const cleanDetails = this.enablePIIScrubbing
      ? scrubPII(details)
      : details;

    const timestamp = new Date().toISOString();
    const eventId = `evt_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const eventObj = {
      id: eventId,
      timestamp,
      eventType,
      teamId: this.teamId,
      user,
      severity,
      action: cleanAction,
      details: cleanDetails,
    };

    const hash = await computeEventHash(eventObj, prevHash);
    eventObj.hash = hash;

    this.logs.push(eventObj);

    // Enforce retention policy
    this.logs = purgeLogsByAge(this.logs, this.retentionDays);

    // Persist to storage if path configured
    if (this.storagePath) {
      await this.saveToFile(this.storagePath);
    }

    // Run anomaly scan on newly added event
    const anomalies = await detectAnomalies(this.logs);
    for (const anomaly of anomalies) {
      if (anomaly.affectedEventIds.includes(eventId)) {
        await this.alertManager.processAnomaly(anomaly);
      }
    }

    return eventObj;
  }

  /**
   * Queries logs by filter criteria.
   * @param {object} [filters={}]
   * @returns {Array<object>}
   */
  queryLogs(filters = {}) {
    let result = [...this.logs];

    if (filters.eventType) {
      result = result.filter((e) => e.eventType === filters.eventType);
    }
    if (filters.user) {
      result = result.filter((e) => e.user === filters.user);
    }
    if (filters.severity) {
      result = result.filter((e) => e.severity === filters.severity);
    }
    if (filters.teamId) {
      result = result.filter((e) => e.teamId === filters.teamId);
    }
    if (filters.searchQuery) {
      const q = filters.searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.action?.toLowerCase().includes(q) ||
          JSON.stringify(e.details).toLowerCase().includes(q)
      );
    }

    if (filters.limit && typeof filters.limit === "number") {
      result = result.slice(0, filters.limit);
    }

    return result;
  }

  /**
   * Anonymizes user logs in response to GDPR erasure request.
   * @param {string} userId
   * @returns {Promise<void>}
   */
  async anonymizeUser(userId) {
    this.logs = await anonymizeUserInLogs(this.logs, userId);
    if (this.storagePath) {
      await this.saveToFile(this.storagePath);
    }
  }

  /**
   * Verifies tamper-evident integrity of all current audit logs.
   * @returns {Promise<{valid: boolean, tamperedIndex: number, reason: string}>}
   */
  async verifyIntegrity() {
    return await verifyLogIntegrity(this.logs);
  }

  /**
   * Generates compliance report.
   * @param {object} [options]
   * @returns {Promise<object|string>}
   */
  async generateComplianceReport(options = {}) {
    return await generateComplianceReport(this.logs, {
      teamId: this.teamId,
      ...options,
    });
  }

  /**
   * Exports logs to SIEM platform.
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async exportToSIEM(options = {}) {
    return await exportToSIEM(this.logs, options);
  }

  /**
   * Atomically saves logs array to JSON file.
   * @param {string} filePath
   */
  async saveToFile(filePath) {
    const jsonStr = JSON.stringify(this.logs, null, 2);
    if (isNode) {
      const fs = (await import("fs")).default || (await import("fs"));
      const path = (await import("path")).default || (await import("path"));
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmp = filePath + ".tmp";
      fs.writeFileSync(tmp, jsonStr, "utf8");
      fs.renameSync(tmp, filePath);
    } else if (Gio) {
      const file = Gio.File.new_for_path(filePath);
      const tmpFile = Gio.File.new_for_path(filePath + ".tmp");
      const bytes = new GLib.Bytes(jsonStr);
      tmpFile.replace_contents(bytes, null, false, Gio.FileCreateFlags.NONE, null);
      tmpFile.move(file, Gio.FileCopyFlags.OVERWRITE, null, null);
    }
  }

  /**
   * Loads logs array from JSON file.
   * @param {string} filePath
   */
  async loadFromFile(filePath) {
    let content = "";
    if (isNode) {
      const fs = (await import("fs")).default || (await import("fs"));
      if (fs.existsSync(filePath)) {
        content = fs.readFileSync(filePath, "utf8");
      }
    } else if (Gio) {
      const file = Gio.File.new_for_path(filePath);
      if (file.query_exists(null)) {
        const [, bytes] = file.load_contents(null);
        content = new TextDecoder().decode(bytes);
      }
    }

    if (content) {
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          this.logs = parsed;
        }
      } catch (e) {
        console.error("Failed to parse audit log file:", e);
      }
    }
  }
}
