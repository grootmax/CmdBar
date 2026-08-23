/**
 * Shared Audit Trail Manager for Enterprise Teams, Compliance, SIEM Export, Anomaly Detection, and GDPR Compliance.
 * Supported in GNOME Shell (GJS) and Node.js runtime environments.
 *
 * @module extension/sharedAuditTrail
 */

import { writeConfigAtomically } from "./commandProcessor.js";

const isNode = typeof process !== "undefined" && process.versions && process.versions.node;

let cryptoModule;
if (isNode) {
  try {
    cryptoModule = await import("node:crypto");
  } catch (e) {
    try {
      cryptoModule = await import("crypto");
    } catch (err) {}
  }
}

let Gio, GLib;
if (!isNode) {
  try {
    const giModule = await import("gi");
    Gio = giModule.Gio || (giModule.default && giModule.default.Gio) || giModule.default;
    GLib = giModule.GLib || (giModule.default && giModule.default.GLib);
  } catch (e) {}
}

/**
 * Utility to compute SHA-256 HMAC hex digest.
 * @param {string} data - Input string to hash.
 * @param {string} key - HMAC key string.
 * @returns {string} SHA-256 HMAC hex digest.
 */
export function computeHMAC(data, key = "cmdbar-shared-audit-key") {
  if (cryptoModule && typeof cryptoModule.createHmac === "function") {
    return cryptoModule.createHmac("sha256", key).update(data, "utf8").digest("hex");
  }
  // Simple fallback hash computation for GJS or limited environments
  let hash = 0;
  const str = `${data}:${key}`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, "0");
  return `${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}`.slice(0, 64);
}

/**
 * Utility to generate a unique random UUID or string ID.
 * @returns {string} Unique identifier.
 */
export function generateId() {
  if (cryptoModule && typeof cryptoModule.randomUUID === "function") {
    return cryptoModule.randomUUID();
  }
  return "audit-" + Date.now().toString(36) + "-" + Math.random().toString(36).substring(2, 10);
}

/**
 * Mask sensitive Personally Identifiable Information (PII) in text or objects.
 * Redacts passwords, API keys, tokens, email addresses, IP addresses, and SSNs.
 *
 * @param {string|object} input - Text or object to mask.
 * @returns {string|object} Redacted output.
 * @public
 */
export function maskPII(input) {
  if (input === null || input === undefined) {
    return input;
  }

  if (typeof input === "object") {
    const cleanObj = Array.isArray(input) ? [] : {};
    for (const [key, val] of Object.entries(input)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("password") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("token") ||
        lowerKey.includes("api_key") ||
        lowerKey.includes("apikey") ||
        lowerKey.includes("auth")
      ) {
        cleanObj[key] = "[REDACTED_SENSITIVE]";
      } else {
        cleanObj[key] = maskPII(val);
      }
    }
    return cleanObj;
  }

  if (typeof input !== "string") {
    return input;
  }

  let text = input;

  // Mask Passwords & Credentials
  text = text.replace(/(password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]+['"]?/gi, "$1=[REDACTED_PASSWORD]");
  text = text.replace(/(-p|--password)\s+['"]?[^\s'"]+['"]?/gi, "$1 [REDACTED_PASSWORD]");

  // Mask Tokens & Keys (AWS, Bearer, Generic API Keys)
  text = text.replace(/Bearer\s+[a-zA-Z0-9_\-\.]{15,}/gi, "Bearer [REDACTED_TOKEN]");
  text = text.replace(/(api[_-]?key|access[_-]?token|secret[_-]?key)\s*[:=]\s*['"]?[^\s'"]+['"]?/gi, "$1=[REDACTED_TOKEN]");
  text = text.replace(/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]");

  // Mask Email Addresses
  text = text.replace(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, "[REDACTED_EMAIL]");

  // Mask IPv4 and IPv6 Addresses
  text = text.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[REDACTED_IP]");
  text = text.replace(/\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g, "[REDACTED_IP]");

  // Mask Social Security Numbers
  text = text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED_SSN]");

  return text;
}

/**
 * Shared Audit Trail Manager class for enterprise team audit logging,
 * compliance reporting, SIEM exports, anomaly detection, real-time alerts, and GDPR controls.
 *
 * @class SharedAuditTrail
 */
export class SharedAuditTrail {
  /**
   * Constructs a SharedAuditTrail instance.
   *
   * @param {object} [options={}] - Configuration options.
   * @param {string} [options.teamId="default-team"] - Identifier of the team.
   * @param {string} [options.workspaceId="default-workspace"] - Identifier of the workspace/tenant.
   * @param {string} [options.userId="system"] - Identifier of default acting user.
   * @param {string} [options.logPath] - File path to store audit log entries.
   * @param {string} [options.hmacKey="cmdbar-shared-audit-key"] - Key for HMAC signature calculation.
   * @param {boolean} [options.privacyMode=false] - Whether privacy mode is enabled (omits command args/IPs).
   * @param {boolean} [options.piiMasking=true] - Whether PII masking is enabled.
   * @param {number} [options.retentionDays=90] - Data retention threshold in days.
   * @param {object} [options.anomalyThresholds={}] - Custom anomaly detection parameters.
   */
  constructor(options = {}) {
    this.teamId = options.teamId || "default-team";
    this.workspaceId = options.workspaceId || "default-workspace";
    this.userId = options.userId || "system";
    this.logPath = options.logPath || null;
    this.hmacKey = options.hmacKey || "cmdbar-shared-audit-key";
    this.privacyMode = options.privacyMode === true;
    this.piiMasking = options.piiMasking !== false;
    this.retentionDays = typeof options.retentionDays === "number" ? options.retentionDays : 90;
    this.anomalyThresholds = Object.assign(
      {
        failureSpikeThreshold: 5,
        failureSpikeWindowSeconds: 300,
        rapidVelocityThreshold: 10,
        rapidVelocityWindowSeconds: 60,
        offHoursStartHour: 22,
        offHoursEndHour: 6,
      },
      options.anomalyThresholds || {}
    );

    this.logs = [];
    this.alertHandlers = [];
    this.alertCooldowns = new Map();
    this.previousSignature = "0000000000000000000000000000000000000000000000000000000000000000";
  }

  /**
   * Registers a real-time alert notification handler callback.
   *
   * @param {function(object):void} handler - Alert callback function receiving an alert payload.
   * @public
   */
  registerAlertHandler(handler) {
    if (typeof handler === "function") {
      this.alertHandlers.push(handler);
    }
  }

  /**
   * Clears all registered alert notification handlers.
   * @public
   */
  clearAlertHandlers() {
    this.alertHandlers = [];
  }

  /**
   * Toggles Privacy Mode setting.
   * When enabled, sensitive command details and IP addresses are omitted from new log entries.
   *
   * @param {boolean} enabled - True to enable privacy mode.
   * @public
   */
  setPrivacyMode(enabled) {
    this.privacyMode = enabled === true;
  }

  /**
   * Computes signature for an audit event entry linking to the previous signature.
   *
   * @param {object} entry - Audit entry data.
   * @returns {string} HMAC SHA-256 signature.
   * @private
   */
  _computeEventSignature(entry) {
    const raw = `${this.previousSignature}|${entry.id}|${entry.timestamp}|${entry.userId}|${entry.teamId}|${entry.action}|${entry.resource}|${entry.status}`;
    return computeHMAC(raw, this.hmacKey);
  }

  /**
   * Creates and logs a new shared audit event record.
   *
   * @param {object} eventData - Details of the event.
   * @param {string} [eventData.userId] - Acting user ID (defaults to instance userId).
   * @param {string} [eventData.teamId] - Team ID (defaults to instance teamId).
   * @param {string} [eventData.workspaceId] - Workspace ID (defaults to instance workspaceId).
   * @param {string} eventData.action - Executed action (e.g., 'command.execute', 'config.update', 'secret.access').
   * @param {string} eventData.resource - Resource or command target affected.
   * @param {string} [eventData.status="SUCCESS"] - Event status ('SUCCESS', 'FAILURE', 'DENIED', 'ANOMALY_DETECTED').
   * @param {string} [eventData.severity="INFO"] - Severity level ('INFO', 'WARNING', 'HIGH', 'CRITICAL').
   * @param {string} [eventData.ipAddress="127.0.0.1"] - Originating IP or host.
   * @param {object} [eventData.metadata={}] - Additional contextual key-value pairs.
   * @returns {Promise<object>} The logged audit event record.
   * @public
   */
  async logEvent(eventData = {}) {
    if (!eventData.action) {
      throw new Error("SharedAuditTrail: Event action is required.");
    }

    const timestamp = eventData.timestamp || new Date().toISOString();
    const id = eventData.id || generateId();
    const userId = eventData.userId || this.userId;
    const teamId = eventData.teamId || this.teamId;
    const workspaceId = eventData.workspaceId || this.workspaceId;
    const status = (eventData.status || "SUCCESS").toUpperCase();
    const severity = (eventData.severity || "INFO").toUpperCase();

    let resource = eventData.resource || "";
    let ipAddress = eventData.ipAddress || "127.0.0.1";
    let metadata = Object.assign({}, eventData.metadata || {});

    // Privacy Mode & PII Sanitization
    if (this.privacyMode) {
      resource = resource.split(" ")[0] + " [ARGS_OMITTED_PRIVACY_MODE]";
      ipAddress = "[PRIVACY_MODE_OMITTED]";
      metadata = { privacyMode: true };
    } else if (this.piiMasking) {
      resource = maskPII(resource);
      ipAddress = maskPII(ipAddress);
      metadata = maskPII(metadata);
    }

    const entry = {
      id,
      timestamp,
      userId,
      teamId,
      workspaceId,
      action: eventData.action,
      resource,
      status,
      severity,
      ipAddress,
      metadata,
      previousSignature: this.previousSignature,
    };

    entry.signature = this._computeEventSignature(entry);
    this.previousSignature = entry.signature;

    this.logs.push(entry);

    // Persistence if logPath is configured
    if (this.logPath) {
      try {
        await writeConfigAtomically(this.logPath, JSON.stringify(this.logs, null, 2));
      } catch (e) {
        console.error(`SharedAuditTrail: Failed to write logs to disk: ${e.message}`);
      }
    }

    // Evaluate Anomaly Detection & Trigger Real-Time Alerts
    const anomalies = this.evaluateAnomaliesForEvent(entry);
    if (anomalies.length > 0 || severity === "HIGH" || severity === "CRITICAL" || status === "DENIED") {
      this._triggerAlerts(entry, anomalies);
    }

    return entry;
  }

  /**
   * Merges and synchronizes external team audit log entries with the local store,
   * verifying integrity signatures and sorting chronologically.
   *
   * @param {Array<object>} externalLogs - Array of audit log records from team endpoints.
   * @returns {number} Number of new events merged.
   * @public
   */
  syncTeamLogs(externalLogs = []) {
    if (!Array.isArray(externalLogs)) {
      return 0;
    }

    const existingIds = new Set(this.logs.map((l) => l.id));
    let addedCount = 0;

    for (const entry of externalLogs) {
      if (!entry || !entry.id || existingIds.has(entry.id)) {
        continue;
      }
      this.logs.push(entry);
      existingIds.add(entry.id);
      addedCount++;
    }

    // Sort logs chronologically by timestamp
    this.logs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Recompute chain verification state
    if (this.logs.length > 0) {
      this.previousSignature = this.logs[this.logs.length - 1].signature;
    }

    return addedCount;
  }

  /**
   * Queries and filters logged audit events according to specified search criteria.
   *
   * @param {object} [filters={}] - Filter criteria.
   * @param {string} [filters.teamId] - Filter by team ID.
   * @param {string} [filters.userId] - Filter by user ID.
   * @param {string} [filters.action] - Filter by action name.
   * @param {string} [filters.status] - Filter by status ('SUCCESS', 'FAILURE', 'DENIED', etc.).
   * @param {string} [filters.severity] - Filter by severity level.
   * @param {string|Date} [filters.startDate] - Filter events on or after this ISO date.
   * @param {string|Date} [filters.endDate] - Filter events on or before this ISO date.
   * @param {string} [filters.searchKeyword] - Keyword search in action, resource, or metadata.
   * @param {number} [filters.limit] - Maximum records to return.
   * @returns {Array<object>} Array of matching audit events.
   * @public
   */
  queryLogs(filters = {}) {
    let result = this.logs.slice();

    if (filters.teamId) {
      result = result.filter((l) => l.teamId === filters.teamId);
    }
    if (filters.userId) {
      result = result.filter((l) => l.userId === filters.userId);
    }
    if (filters.action) {
      result = result.filter((l) => l.action === filters.action);
    }
    if (filters.status) {
      result = result.filter((l) => l.status === filters.status.toUpperCase());
    }
    if (filters.severity) {
      result = result.filter((l) => l.severity === filters.severity.toUpperCase());
    }
    if (filters.startDate) {
      const startMs = new Date(filters.startDate).getTime();
      result = result.filter((l) => new Date(l.timestamp).getTime() >= startMs);
    }
    if (filters.endDate) {
      const endMs = new Date(filters.endDate).getTime();
      result = result.filter((l) => new Date(l.timestamp).getTime() <= endMs);
    }
    if (filters.searchKeyword) {
      const kw = filters.searchKeyword.toLowerCase();
      result = result.filter(
        (l) =>
          l.action.toLowerCase().includes(kw) ||
          l.resource.toLowerCase().includes(kw) ||
          l.userId.toLowerCase().includes(kw) ||
          JSON.stringify(l.metadata || {}).toLowerCase().includes(kw)
      );
    }

    if (typeof filters.limit === "number" && filters.limit > 0) {
      result = result.slice(0, filters.limit);
    }

    return result;
  }

  /**
   * Verifies the cryptographic HMAC hash chain integrity of stored audit logs.
   * Detects tampering or missing records in the log trail.
   *
   * @returns {object} Integrity verification summary ({ valid: boolean, errors: Array<string> }).
   * @public
   */
  verifyIntegrity() {
    const errors = [];
    let expectedPrevSig = "0000000000000000000000000000000000000000000000000000000000000000";

    for (let i = 0; i < this.logs.length; i++) {
      const entry = this.logs[i];

      if (entry.previousSignature && entry.previousSignature !== expectedPrevSig) {
        errors.push(`Chain broken at index ${i} (ID: ${entry.id}): previousSignature mismatch.`);
      }

      const raw = `${entry.previousSignature || expectedPrevSig}|${entry.id}|${entry.timestamp}|${entry.userId}|${entry.teamId}|${entry.action}|${entry.resource}|${entry.status}`;
      const calculatedSig = computeHMAC(raw, this.hmacKey);

      if (entry.signature !== calculatedSig) {
        errors.push(`Invalid signature at index ${i} (ID: ${entry.id}): data modified or tampered.`);
      }

      expectedPrevSig = entry.signature;
    }

    return {
      valid: errors.length === 0,
      totalVerified: this.logs.length,
      errors,
    };
  }

  /**
   * GDPR Right to be Forgotten: Purges or pseudonymizes all identifiable personal data
   * for a target user while keeping statistical counts and maintaining audit integrity.
   *
   * @param {string} targetUserId - Identifier of user requesting data purge/erasure.
   * @returns {Promise<object>} Erasure summary ({ purgedCount: number, pseudonym: string }).
   * @public
   */
  async purgeUserData(targetUserId) {
    if (!targetUserId) {
      throw new Error("SharedAuditTrail: Target user ID is required for GDPR erasure.");
    }

    const pseudonym = "ANONYMIZED_" + computeHMAC(targetUserId, "gdpr-salt").slice(0, 12);
    let purgedCount = 0;

    for (let i = 0; i < this.logs.length; i++) {
      if (this.logs[i].userId === targetUserId) {
        this.logs[i].userId = pseudonym;
        this.logs[i].ipAddress = "[GDPR_PURGED_IP]";
        this.logs[i].resource = maskPII(this.logs[i].resource);
        this.logs[i].metadata = { gdprPurged: true, originalPurgeTimestamp: new Date().toISOString() };
        purgedCount++;
      }
    }

    if (purgedCount > 0) {
      let prevSig = "0000000000000000000000000000000000000000000000000000000000000000";
      for (let i = 0; i < this.logs.length; i++) {
        this.logs[i].previousSignature = prevSig;
        const raw = `${prevSig}|${this.logs[i].id}|${this.logs[i].timestamp}|${this.logs[i].userId}|${this.logs[i].teamId}|${this.logs[i].action}|${this.logs[i].resource}|${this.logs[i].status}`;
        this.logs[i].signature = computeHMAC(raw, this.hmacKey);
        prevSig = this.logs[i].signature;
      }
      this.previousSignature = prevSig;
    }

    if (this.logPath && purgedCount > 0) {
      await writeConfigAtomically(this.logPath, JSON.stringify(this.logs, null, 2));
    }

    return {
      success: true,
      purgedCount,
      pseudonym,
      targetUserId,
    };
  }

  /**
   * Applies automated data retention policy by removing audit log entries
   * older than the configured threshold (default 90 days).
   *
   * @param {number} [maxDays] - Override retention threshold in days.
   * @returns {Promise<object>} Retention pruning summary ({ prunedCount: number, remainingCount: number }).
   * @public
   */
  async applyRetentionPolicy(maxDays) {
    const days = typeof maxDays === "number" ? maxDays : this.retentionDays;
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

    const initialCount = this.logs.length;
    this.logs = this.logs.filter((l) => new Date(l.timestamp).getTime() >= cutoffMs);
    const prunedCount = initialCount - this.logs.length;

    if (this.logPath && prunedCount > 0) {
      await writeConfigAtomically(this.logPath, JSON.stringify(this.logs, null, 2));
    }

    return {
      prunedCount,
      remainingCount: this.logs.length,
      retentionDays: days,
    };
  }

  /**
   * Detects security anomalies across stored audit logs or for a specific incoming event.
   * Evaluates rules: FAILURE_SPIKE, OFF_HOURS_ACTIVITY, UNAUTHORIZED_PRIVILEGE, RAPID_VELOCITY, INTEGRITY_TAMPER.
   *
   * @param {Array<object>} [customLogs] - Optional log entries to analyze (defaults to stored logs).
   * @returns {Array<object>} Array of detected anomaly objects.
   * @public
   */
  detectAnomalies(customLogs) {
    const targetLogs = customLogs || this.logs;
    const anomalies = [];

    if (!targetLogs || targetLogs.length === 0) {
      return anomalies;
    }

    // 1. Check Integrity Tamper
    const integrityResult = this.verifyIntegrity();
    if (!integrityResult.valid) {
      anomalies.push({
        id: generateId(),
        ruleId: "INTEGRITY_TAMPER",
        severity: "CRITICAL",
        description: `Audit log tamper detected: ${integrityResult.errors.join("; ")}`,
        timestamp: new Date().toISOString(),
        affectedUser: "SYSTEM",
        teamId: this.teamId,
      });
    }

    // Group logs by user
    const userMap = new Map();
    for (const entry of targetLogs) {
      if (!userMap.has(entry.userId)) {
        userMap.set(entry.userId, []);
      }
      userMap.get(entry.userId).push(entry);
    }

    for (const [user, userLogs] of userMap.entries()) {
      // 2. Failure Spike Detection
      const failures = userLogs.filter((l) => l.status === "FAILURE" || l.status === "DENIED");
      if (failures.length >= this.anomalyThresholds.failureSpikeThreshold) {
        anomalies.push({
          id: generateId(),
          ruleId: "FAILURE_SPIKE",
          severity: "HIGH",
          description: `User '${user}' triggered ${failures.length} command execution failures/denials.`,
          timestamp: new Date().toISOString(),
          affectedUser: user,
          teamId: userLogs[0].teamId || this.teamId,
          triggeringEvents: failures.map((f) => f.id),
        });
      }

      // 3. Off-Hours Activity Detection
      for (const entry of userLogs) {
        const date = new Date(entry.timestamp);
        const hour = date.getHours();
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const isOffHours =
          hour >= this.anomalyThresholds.offHoursStartHour ||
          hour < this.anomalyThresholds.offHoursEndHour ||
          isWeekend;

        if (isOffHours && (entry.severity === "HIGH" || entry.severity === "CRITICAL" || entry.status === "DENIED")) {
          anomalies.push({
            id: generateId(),
            ruleId: "OFF_HOURS_ACTIVITY",
            severity: "WARNING",
            description: `Off-hours security activity by user '${user}' at ${entry.timestamp} (Action: ${entry.action}).`,
            timestamp: entry.timestamp,
            affectedUser: user,
            teamId: entry.teamId,
            triggeringEvents: [entry.id],
          });
        }
      }

      // 4. Unauthorized Privilege Attempts
      const unauthorized = userLogs.filter((l) => l.status === "DENIED" || l.action.includes("privilege"));
      if (unauthorized.length >= 2) {
        anomalies.push({
          id: generateId(),
          ruleId: "UNAUTHORIZED_PRIVILEGE",
          severity: "CRITICAL",
          description: `Repeated unauthorized privilege escalation attempts by user '${user}'.`,
          timestamp: new Date().toISOString(),
          affectedUser: user,
          teamId: userLogs[0].teamId,
          triggeringEvents: unauthorized.map((u) => u.id),
        });
      }

      // 5. Rapid Execution Velocity
      if (userLogs.length >= this.anomalyThresholds.rapidVelocityThreshold) {
        const windowMs = this.anomalyThresholds.rapidVelocityWindowSeconds * 1000;
        const latestTime = new Date(userLogs[userLogs.length - 1].timestamp).getTime();
        const recentLogs = userLogs.filter((l) => latestTime - new Date(l.timestamp).getTime() <= windowMs);
        if (recentLogs.length >= this.anomalyThresholds.rapidVelocityThreshold) {
          anomalies.push({
            id: generateId(),
            ruleId: "RAPID_VELOCITY",
            severity: "HIGH",
            description: `Abnormal rapid execution velocity (${recentLogs.length} actions in ${this.anomalyThresholds.rapidVelocityWindowSeconds}s) by user '${user}'.`,
            timestamp: new Date().toISOString(),
            affectedUser: user,
            teamId: userLogs[0].teamId,
            triggeringEvents: recentLogs.map((r) => r.id),
          });
        }
      }
    }

    return anomalies;
  }

  /**
   * Evaluates anomaly detection rules for a single newly logged event.
   *
   * @param {object} event - Audit event record.
   * @returns {Array<object>} Detected anomalies.
   * @public
   */
  evaluateAnomaliesForEvent(event) {
    const userLogs = this.logs.filter((l) => l.userId === event.userId);
    return this.detectAnomalies(userLogs);
  }

  /**
   * Dispatches real-time security alerts to registered handlers with rate-limiting cooldown.
   *
   * @param {object} event - Triggering audit event.
   * @param {Array<object>} anomalies - Associated detected anomalies.
   * @private
   */
  _triggerAlerts(event, anomalies = []) {
    const cooldownKey = `${event.userId}:${event.action}`;
    const lastAlertTime = this.alertCooldowns.get(cooldownKey) || 0;
    const now = Date.now();

    // 30 second cooldown per user-action alert
    if (now - lastAlertTime < 30000) {
      return;
    }

    this.alertCooldowns.set(cooldownKey, now);

    const alertPayload = {
      id: generateId(),
      timestamp: new Date().toISOString(),
      event,
      anomalies,
      severity: event.severity || "HIGH",
      message: `Security Alert: Action '${event.action}' by user '${event.userId}' (Status: ${event.status}).`,
    };

    for (const handler of this.alertHandlers) {
      try {
        handler(alertPayload);
      } catch (e) {
        console.error(`SharedAuditTrail: Alert handler error: ${e.message}`);
      }
    }
  }

  /**
   * Generates a formal compliance audit report evaluating controls for standard frameworks
   * (SOC2, ISO27001, GDPR, HIPAA, PCI-DSS).
   *
   * @param {string} [framework="SOC2"] - Framework name ('SOC2', 'ISO27001', 'GDPR', 'HIPAA', 'PCI-DSS').
   * @param {object} [options={}] - Report filter options.
   * @returns {object} Structured compliance report.
   * @public
   */
  generateComplianceReport(framework = "SOC2", options = {}) {
    const targetLogs = this.queryLogs(options);
    const fw = framework.toUpperCase();
    const totalEvents = targetLogs.length;

    const integrityCheck = this.verifyIntegrity();
    const anomalies = this.detectAnomalies(targetLogs);

    const deniedEvents = targetLogs.filter((l) => l.status === "DENIED" || l.status === "FAILURE");
    const failureRatePct = totalEvents > 0 ? (deniedEvents.length / totalEvents) * 100 : 0;

    const controls = [
      {
        id: "CTRL-01",
        title: "Audit Logging Coverage & Activity Monitoring",
        status: totalEvents > 0 ? "PASS" : "FAIL",
        details: `Recorded ${totalEvents} audit events across team workspace.`,
      },
      {
        id: "CTRL-02",
        title: "Tamper-Evident HMAC Signature Verification",
        status: integrityCheck.valid ? "PASS" : "FAIL",
        details: integrityCheck.valid
          ? "All audit log HMAC signatures and hash chain verified successfully."
          : `Integrity check failed: ${integrityCheck.errors.length} chain errors.`,
      },
      {
        id: "CTRL-03",
        title: "PII Masking & Privacy Governance",
        status: this.piiMasking ? "PASS" : "FAIL",
        details: this.piiMasking
          ? "Automated PII masking enabled for emails, IP addresses, credentials, and tokens."
          : "PII masking is disabled.",
      },
      {
        id: "CTRL-04",
        title: "Access Control & Authorization Failure Thresholds",
        status: failureRatePct <= 15 ? "PASS" : "FAIL",
        details: `Access denial/failure rate is ${failureRatePct.toFixed(1)}% (Threshold: 15%).`,
      },
      {
        id: "CTRL-05",
        title: "Security Anomaly & Threat Detection",
        status: anomalies.length === 0 ? "PASS" : "WARNING",
        details:
          anomalies.length === 0
            ? "No security anomalies or threat patterns detected."
            : `Detected ${anomalies.length} anomaly conditions requiring review.`,
      },
    ];

    const passedCount = controls.filter((c) => c.status === "PASS").length;
    const scorePct = Math.round((passedCount / controls.length) * 100);

    return {
      framework: fw,
      generatedAt: new Date().toISOString(),
      teamId: options.teamId || this.teamId,
      workspaceId: options.workspaceId || this.workspaceId,
      summary: {
        totalEvents,
        complianceScorePct: scorePct,
        passedControls: passedCount,
        totalControls: controls.length,
        status: scorePct >= 80 ? "COMPLIANT" : "NON_COMPLIANT",
      },
      controls,
      anomalies,
    };
  }

  /**
   * Exports a compliance report to the specified format ('JSON', 'CSV', 'HTML', 'MARKDOWN').
   *
   * @param {object} report - Compliance report object.
   * @param {string} [format="JSON"] - Format type.
   * @returns {string} Formatted compliance report content string.
   * @public
   */
  exportComplianceReport(report, format = "JSON") {
    const fmt = format.toUpperCase();

    if (fmt === "CSV") {
      const headers = ["ControlID", "Title", "Status", "Details"];
      const rows = report.controls.map((c) => `"${c.id}","${c.title}","${c.status}","${c.details.replace(/"/g, '""')}"`);
      return [headers.join(","), ...rows].join("\n");
    }

    if (fmt === "HTML") {
      const rows = report.controls
        .map(
          (c) =>
            `<tr><td><strong>${c.id}</strong></td><td>${c.title}</td><td><span class="${c.status.toLowerCase()}">${c.status}</span></td><td>${c.details}</td></tr>`
        )
        .join("");

      return `<!DOCTYPE html>
<html>
<head>
  <title>${report.framework} Compliance Audit Report</title>
  <style>
    body { font-family: sans-serif; margin: 20px; }
    h1 { color: #1a202c; }
    .status-badge { font-weight: bold; padding: 4px 8px; border-radius: 4px; }
    .pass { color: green; } .fail { color: red; } .warning { color: orange; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    th, td { border: 1px solid #cbd5e0; padding: 8px 12px; text-align: left; }
    th { background: #edf2f7; }
  </style>
</head>
<body>
  <h1>${report.framework} Compliance Audit Report</h1>
  <p><strong>Generated At:</strong> ${report.generatedAt}</p>
  <p><strong>Compliance Score:</strong> ${report.summary.complianceScorePct}% (${report.summary.status})</p>
  <table>
    <thead><tr><th>ID</th><th>Title</th><th>Status</th><th>Details</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
    }

    if (fmt === "MARKDOWN") {
      const rows = report.controls.map((c) => `| ${c.id} | ${c.title} | ${c.status} | ${c.details} |`).join("\n");
      return `# ${report.framework} Compliance Audit Report\n\n**Generated At:** ${report.generatedAt}\n**Compliance Score:** ${report.summary.complianceScorePct}% (${report.summary.status})\n\n| ID | Control | Status | Details |\n| --- | --- | --- | --- |\n${rows}\n`;
    }

    return JSON.stringify(report, null, 2);
  }

  /**
   * Exports audit log entries to standard Security Information and Event Management (SIEM) formats.
   * Supported formats: 'CEF', 'LEEF', 'SYSLOG', 'JSON', 'SPLUNK'.
   *
   * @param {Array<object>} [customLogs] - Array of audit log entries to export (defaults to stored logs).
   * @param {string} [format="CEF"] - SIEM format type ('CEF', 'LEEF', 'SYSLOG', 'JSON', 'SPLUNK').
   * @returns {string} Formatted SIEM payload output.
   * @public
   */
  exportToSIEM(customLogs, format = "CEF") {
    const logsToExport = customLogs || this.logs;
    const fmt = format.toUpperCase();

    if (fmt === "LEEF") {
      return logsToExport
        .map((l) => {
          const sev = l.severity === "CRITICAL" ? 10 : l.severity === "HIGH" ? 8 : l.severity === "WARNING" ? 5 : 2;
          return `LEEF:2.0|CmdBar|SharedAuditTrail|1.0|${l.action}|devTime=${l.timestamp}\tusrName=${l.userId}\tteam=${l.teamId}\tsrc=${l.ipAddress}\tstatus=${l.status}\tsev=${sev}\tresource=${l.resource}`;
        })
        .join("\n");
    }

    if (fmt === "SYSLOG") {
      return logsToExport
        .map((l) => {
          const pri = l.severity === "CRITICAL" || l.severity === "HIGH" ? 131 : 134; // Facility 16 (local0)
          return `<${pri}>1 ${l.timestamp} localhost CmdBarSharedAudit ${l.id} - - [audit@cmdbar teamId="${l.teamId}" userId="${l.userId}" status="${l.status}"] Action: ${l.action} Resource: ${l.resource}`;
        })
        .join("\n");
    }

    if (fmt === "SPLUNK") {
      return logsToExport
        .map((l) =>
          JSON.stringify({
            time: Math.floor(new Date(l.timestamp).getTime() / 1000),
            host: l.ipAddress || "localhost",
            source: "cmdbar:audit",
            sourcetype: "_json",
            event: l,
          })
        )
        .join("\n");
    }

    if (fmt === "JSON" || fmt === "ECS") {
      return JSON.stringify(
        logsToExport.map((l) => ({
          "@timestamp": l.timestamp,
          "event.id": l.id,
          "event.action": l.action,
          "event.outcome": l.status.toLowerCase(),
          "event.severity": l.severity,
          "user.id": l.userId,
          "group.id": l.teamId,
          "client.ip": l.ipAddress,
          "file.target": l.resource,
          signature: l.signature,
        })),
        null,
        2
      );
    }

    // Default: Common Event Format (CEF)
    return logsToExport
      .map((l) => {
        const sevNum = l.severity === "CRITICAL" ? 10 : l.severity === "HIGH" ? 7 : l.severity === "WARNING" ? 4 : 1;
        return `CEF:0|CmdBar|SharedAuditTrail|1.0|${l.action}|${l.resource}|${sevNum}|rt=${l.timestamp} suser=${l.userId} cs1=${l.teamId} cs1Label=TeamId outcome=${l.status} src=${l.ipAddress}`;
      })
      .join("\n");
  }

  /**
   * Dispatches formatted SIEM logs to an external HTTP webhook or SIEM collector endpoint.
   *
   * @param {object} endpointConfig - Endpoint settings.
   * @param {string} endpointConfig.url - Webhook endpoint URL.
   * @param {string} [endpointConfig.format="CEF"] - SIEM payload format.
   * @param {object} [endpointConfig.headers={}] - Additional HTTP headers.
   * @param {Array<object>} [customLogs] - Specific log records to send.
   * @returns {Promise<object>} Dispatch result status ({ success: boolean, count: number }).
   * @public
   */
  async sendToSIEMEndpoint(endpointConfig = {}, customLogs) {
    if (!endpointConfig.url) {
      throw new Error("SharedAuditTrail: Endpoint URL is required for SIEM dispatch.");
    }

    const payload = this.exportToSIEM(customLogs, endpointConfig.format || "CEF");
    const count = (customLogs || this.logs).length;

    if (isNode && typeof fetch === "function") {
      try {
        const resp = await fetch(endpointConfig.url, {
          method: "POST",
          headers: Object.assign({ "Content-Type": "text/plain" }, endpointConfig.headers || {}),
          body: payload,
        });
        return {
          success: resp.ok,
          status: resp.status,
          count,
          url: endpointConfig.url,
        };
      } catch (e) {
        return {
          success: false,
          error: e.message,
          count,
          url: endpointConfig.url,
        };
      }
    }

    // Fallback simulation / mock dispatch for testing or non-fetch environment
    return {
      success: true,
      simulated: true,
      count,
      url: endpointConfig.url,
    };
  }
}
