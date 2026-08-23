/**
 * Event-Based Triggers Engine for CmdBar
 * Supports File Watchers, Git Hooks, Webhooks (HTTP Listeners), System Events, and Conditional Logic.
 */

let cryptoModule;
try {
  if (typeof process !== "undefined" && process.versions && process.versions.node) {
    cryptoModule = await import("crypto");
  }
} catch (e) {}

/**
 * Gets a nested property value from an object using dot notation.
 * @param {Object} obj
 * @param {string} path
 * @returns {*}
 */
export function getNestedValue(obj, path) {
  if (!obj || typeof obj !== "object" || !path || typeof path !== "string") {
    return undefined;
  }
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

/**
 * Evaluates a single condition object against an event context.
 * Supported operators: equals, not_equals, contains, not_contains, starts_with, ends_with, regex, gt, lt, gte, lte, in, not_in, exists, not_exists.
 * @param {Object} condition
 * @param {Object} context
 * @returns {boolean}
 * @public
 */
export function evaluateCondition(condition, context) {
  if (!condition || typeof condition !== "object") {
    return true;
  }

  // Handle compound nested conditions if provided
  if (Array.isArray(condition.conditions)) {
    const logicalOp = (condition.logical_operator || "and").toLowerCase();
    if (logicalOp === "or") {
      return condition.conditions.some((c) => evaluateCondition(c, context));
    }
    return condition.conditions.every((c) => evaluateCondition(c, context));
  }

  const field = condition.field;
  if (!field) {
    return true;
  }

  const actualValue = getNestedValue(context, field);
  const targetValue = condition.value;
  const operator = (condition.operator || "equals").toLowerCase();

  switch (operator) {
    case "equals":
    case "==":
    case "eq":
      return String(actualValue) === String(targetValue);

    case "not_equals":
    case "!=":
    case "ne":
      return String(actualValue) !== String(targetValue);

    case "contains":
    case "includes":
      if (Array.isArray(actualValue)) {
        return actualValue.includes(targetValue);
      }
      return String(actualValue ?? "").includes(String(targetValue ?? ""));

    case "not_contains":
      if (Array.isArray(actualValue)) {
        return !actualValue.includes(targetValue);
      }
      return !String(actualValue ?? "").includes(String(targetValue ?? ""));

    case "starts_with":
      return String(actualValue ?? "").startsWith(String(targetValue ?? ""));

    case "ends_with":
      return String(actualValue ?? "").endsWith(String(targetValue ?? ""));

    case "regex":
    case "matches":
      try {
        const flags = condition.flags || "i";
        const re = new RegExp(String(targetValue), flags);
        return re.test(String(actualValue ?? ""));
      } catch (e) {
        return false;
      }

    case "gt":
    case "greater_than":
      return Number(actualValue) > Number(targetValue);

    case "lt":
    case "less_than":
      return Number(actualValue) < Number(targetValue);

    case "gte":
    case "greater_than_or_equal":
      return Number(actualValue) >= Number(targetValue);

    case "lte":
    case "less_than_or_equal":
      return Number(actualValue) <= Number(targetValue);

    case "in":
      if (Array.isArray(targetValue)) {
        return targetValue.includes(actualValue);
      }
      return String(targetValue ?? "").includes(String(actualValue ?? ""));

    case "not_in":
      if (Array.isArray(targetValue)) {
        return !targetValue.includes(actualValue);
      }
      return !String(targetValue ?? "").includes(String(actualValue ?? ""));

    case "exists":
      return actualValue !== undefined && actualValue !== null;

    case "not_exists":
      return actualValue === undefined || actualValue === null;

    default:
      return String(actualValue) === String(targetValue);
  }
}

/**
 * Evaluates an array of condition objects against an event context.
 * @param {Array<Object>} conditions
 * @param {Object} context
 * @param {string} [logicalOperator="and"]
 * @returns {boolean}
 * @public
 */
export function evaluateConditions(conditions, context, logicalOperator = "and") {
  if (!conditions || !Array.isArray(conditions) || conditions.length === 0) {
    return true;
  }
  const op = (logicalOperator || "and").toLowerCase();
  if (op === "or") {
    return conditions.some((cond) => evaluateCondition(cond, context));
  }
  return conditions.every((cond) => evaluateCondition(cond, context));
}

/**
 * Substitutes placeholders like {{field}} or <field> in a string or parameter map using event context.
 * @param {string|Object} template
 * @param {Object} context
 * @returns {string|Object}
 * @public
 */
export function substituteContext(template, context) {
  if (!context || typeof context !== "object") {
    return template;
  }

  if (typeof template === "object" && template !== null) {
    if (Array.isArray(template)) {
      return template.map((item) => substituteContext(item, context));
    }
    const result = {};
    for (const [k, v] of Object.entries(template)) {
      result[k] = substituteContext(v, context);
    }
    return result;
  }

  if (typeof template !== "string") {
    return template;
  }

  return template.replace(/\{\{([^}]+)\}\}|<([^>]+)>/g, (match, p1, p2) => {
    const key = (p1 || p2).trim();
    const val = getNestedValue(context, key);
    if (val === undefined || val === null) {
      return match;
    }
    if (typeof val === "object") {
      return JSON.stringify(val);
    }
    return String(val);
  });
}

/**
 * Computes HMAC-SHA256 signature for webhook payload verification.
 * @param {string} payload
 * @param {string} secret
 * @returns {string}
 * @public
 */
export function computeHmacSha256(payload, secret) {
  if (!secret) return "";
  if (cryptoModule && cryptoModule.createHmac) {
    return cryptoModule.createHmac("sha256", secret).update(payload).digest("hex");
  }
  // Fallback simple hash calculation if crypto is unavailable
  let hash = 0;
  const combined = secret + payload;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

/**
 * Manages file watching triggers.
 */
export class FileWatcherManager {
  constructor() {
    this.watchers = new Map();
  }

  addWatch(trigger) {
    if (!trigger || !trigger.id) return false;
    this.watchers.set(trigger.id, trigger);
    return true;
  }

  removeWatch(triggerId) {
    return this.watchers.delete(triggerId);
  }

  getWatch(triggerId) {
    return this.watchers.get(triggerId);
  }

  /**
   * Processes a file change event and finds matching triggers.
   * @param {string} filePath
   * @param {string} eventType - e.g. "create", "modify", "delete"
   * @returns {Array<{ trigger: Object, context: Object }>}
   */
  processFileEvent(filePath, eventType = "modify") {
    const matched = [];
    const fileName = filePath ? filePath.split("/").pop() : "";
    const dirPath = filePath ? filePath.substring(0, filePath.lastIndexOf("/")) : "";

    const context = {
      event_type: "file_watcher",
      file_path: filePath,
      file_name: fileName,
      dir_path: dirPath,
      file_event: eventType,
      timestamp: Date.now(),
    };

    for (const [id, trigger] of this.watchers.entries()) {
      if (!trigger.enabled) continue;
      const config = trigger.config || {};
      const targetPath = config.path;

      // Path matching check
      if (targetPath) {
        const isExact = filePath === targetPath;
        const isPrefix = config.recursive !== false && filePath.startsWith(targetPath.endsWith("/") ? targetPath : targetPath + "/");
        if (!isExact && !isPrefix) continue;
      }

      // Event type check
      if (Array.isArray(config.events) && config.events.length > 0) {
        if (!config.events.includes(eventType)) continue;
      }

      // Condition check
      if (evaluateConditions(trigger.conditions, context, trigger.logical_operator)) {
        matched.push({ trigger, context });
      }
    }

    return matched;
  }
}

/**
 * Manages Git Hook triggers.
 */
export class GitHookManager {
  constructor() {
    this.hooks = new Map();
  }

  addHook(trigger) {
    if (!trigger || !trigger.id) return false;
    this.hooks.set(trigger.id, trigger);
    return true;
  }

  removeHook(triggerId) {
    return this.hooks.delete(triggerId);
  }

  /**
   * Processes a Git hook invocation.
   * @param {string} hookName - e.g. "pre-commit", "post-commit", "post-merge", "pre-push"
   * @param {Object} details - { repo_path, branch, commit, ref, args }
   * @returns {Array<{ trigger: Object, context: Object }>}
   */
  processGitEvent(hookName, details = {}) {
    const matched = [];
    const context = {
      event_type: "git_hook",
      git_hook: hookName,
      git_event: hookName,
      git_repo: details.repo_path || "",
      git_branch: details.branch || "main",
      git_commit: details.commit || "",
      git_ref: details.ref || "",
      args: details.args || [],
      timestamp: Date.now(),
    };

    for (const [id, trigger] of this.hooks.entries()) {
      if (!trigger.enabled) continue;
      const config = trigger.config || {};

      if (config.hook && config.hook !== hookName) continue;
      if (config.repo_path && details.repo_path && config.repo_path !== details.repo_path) continue;
      if (config.branch && details.branch && config.branch !== details.branch) continue;

      if (evaluateConditions(trigger.conditions, context, trigger.logical_operator)) {
        matched.push({ trigger, context });
      }
    }

    return matched;
  }

  /**
   * Generates shell script content for installing into .git/hooks/
   * @param {string} hookName
   * @param {string} [dbusCommand="cmdbar-cli"]
   * @returns {string}
   * @public
   */
  generateHookScript(hookName, dbusCommand = "cmdbar-cli") {
    return `#!/bin/sh
# CmdBar Git Hook Trigger: ${hookName}
REPO_PATH="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
COMMIT="$(git rev-parse HEAD 2>/dev/null || echo '')"

${dbusCommand} trigger-git-event "${hookName}" --repo "$REPO_PATH" --branch "$BRANCH" --commit "$COMMIT" -- "$@"
`;
  }
}

/**
 * Manages Webhook / HTTP triggers.
 */
export class WebhookListener {
  constructor() {
    this.endpoints = new Map();
  }

  addEndpoint(trigger) {
    if (!trigger || !trigger.id) return false;
    this.endpoints.set(trigger.id, trigger);
    return true;
  }

  removeEndpoint(triggerId) {
    return this.endpoints.delete(triggerId);
  }

  /**
   * Processes an incoming HTTP request.
   * @param {string} method - "GET", "POST", etc.
   * @param {string} path - Endpoint path, e.g. "/webhook/deploy"
   * @param {Object} headers
   * @param {Object|string} body
   * @param {Object} query
   * @returns {Array<{ trigger: Object, context: Object }>}
   */
  processHttpRequest(method, path, headers = {}, body = {}, query = {}) {
    const matched = [];
    const rawBody = typeof body === "string" ? body : JSON.stringify(body);
    let parsedBody = body;
    if (typeof body === "string") {
      try {
        parsedBody = JSON.parse(body);
      } catch (e) {
        parsedBody = body;
      }
    }

    const context = {
      event_type: "webhook",
      http_method: method.toUpperCase(),
      http_path: path,
      http_headers: headers,
      http_body: parsedBody,
      http_query: query,
      timestamp: Date.now(),
    };

    for (const [id, trigger] of this.endpoints.entries()) {
      if (!trigger.enabled) continue;
      const config = trigger.config || {};

      // Path check
      if (config.path_pattern) {
        try {
          const re = new RegExp(config.path_pattern);
          if (!re.test(path)) continue;
        } catch (e) {
          if (config.path_pattern !== path) continue;
        }
      } else if (config.path && config.path !== path) {
        continue;
      }

      // Method check
      if (config.method && config.method.toUpperCase() !== method.toUpperCase()) {
        continue;
      }

      // Secret verification if defined
      if (config.secret) {
        const sigHeader = headers["x-hub-signature-256"] || headers["x-signature"] || headers["x-webhook-signature"];
        const tokenHeader = headers["x-webhook-token"] || headers["authorization"];
        let valid = false;

        if (tokenHeader && (tokenHeader === config.secret || tokenHeader === `Bearer ${config.secret}`)) {
          valid = true;
        } else if (sigHeader) {
          const expectedSig = computeHmacSha256(rawBody, config.secret);
          const cleanSig = sigHeader.replace(/^sha256=/, "");
          if (cleanSig === expectedSig) {
            valid = true;
          }
        } else if (query && query.secret === config.secret) {
          valid = true;
        }

        if (!valid) {
          continue;
        }
      }

      if (evaluateConditions(trigger.conditions, context, trigger.logical_operator)) {
        matched.push({ trigger, context });
      }
    }

    return matched;
  }
}

/**
 * Manages System Event triggers (timer, startup, network, suspend, resume).
 */
export class SystemEventManager {
  constructor() {
    this.triggers = new Map();
  }

  addTrigger(trigger) {
    if (!trigger || !trigger.id) return false;
    this.triggers.set(trigger.id, trigger);
    return true;
  }

  removeTrigger(triggerId) {
    return this.triggers.delete(triggerId);
  }

  /**
   * Processes a system event notification.
   * @param {string} eventName - "startup", "timer", "network", "suspend", "resume", "dbus"
   * @param {Object} details
   * @returns {Array<{ trigger: Object, context: Object }>}
   */
  processSystemEvent(eventName, details = {}) {
    const matched = [];
    const context = {
      event_type: "system_event",
      event_name: eventName,
      system_event: eventName,
      details,
      timestamp: Date.now(),
    };

    for (const [id, trigger] of this.triggers.entries()) {
      if (!trigger.enabled) continue;
      const config = trigger.config || {};

      if (config.event_name && config.event_name !== eventName) continue;

      if (evaluateConditions(trigger.conditions, context, trigger.logical_operator)) {
        matched.push({ trigger, context });
      }
    }

    return matched;
  }
}

/**
 * Main Event Trigger Manager for CmdBar.
 */
export class EventTriggerManager {
  constructor() {
    this.triggers = new Map();
    this.fileWatchers = new FileWatcherManager();
    this.gitHooks = new GitHookManager();
    this.webhooks = new WebhookListener();
    this.systemEvents = new SystemEventManager();
    this.history = [];
    this.maxHistorySize = 100;
  }

  /**
   * Loads trigger configurations into manager.
   * @param {Array<Object>} triggersList
   * @public
   */
  loadTriggers(triggersList) {
    this.clearAll();
    if (!Array.isArray(triggersList)) return;
    for (const trigger of triggersList) {
      this.addTrigger(trigger);
    }
  }

  /**
   * Adds or updates a trigger configuration.
   * @param {Object} trigger
   * @returns {boolean}
   * @public
   */
  addTrigger(trigger) {
    if (!trigger || typeof trigger !== "object") return false;
    const triggerId = trigger.id || `trigger_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const fullTrigger = {
      id: triggerId,
      name: trigger.name || "Unnamed Trigger",
      type: trigger.type || "system_event",
      enabled: trigger.enabled !== false,
      target_command: trigger.target_command || "",
      config: trigger.config || {},
      conditions: trigger.conditions || [],
      parameters: trigger.parameters || {},
      logical_operator: trigger.logical_operator || "and",
    };

    this.triggers.set(triggerId, fullTrigger);

    switch (fullTrigger.type) {
      case "file_watcher":
      case "file_change":
        this.fileWatchers.addWatch(fullTrigger);
        break;

      case "git_hook":
        this.gitHooks.addHook(fullTrigger);
        break;

      case "webhook":
      case "http_request":
        this.webhooks.addEndpoint(fullTrigger);
        break;

      case "system_event":
      case "timer":
        this.systemEvents.addTrigger(fullTrigger);
        break;

      default:
        this.systemEvents.addTrigger(fullTrigger);
        break;
    }

    return true;
  }

  /**
   * Removes a trigger by ID.
   * @param {string} triggerId
   * @returns {boolean}
   * @public
   */
  removeTrigger(triggerId) {
    const exists = this.triggers.has(triggerId);
    if (!exists) return false;

    this.triggers.delete(triggerId);
    this.fileWatchers.removeWatch(triggerId);
    this.gitHooks.removeHook(triggerId);
    this.webhooks.removeEndpoint(triggerId);
    this.systemEvents.removeTrigger(triggerId);
    return true;
  }

  /**
   * Enables or disables a trigger.
   * @param {string} triggerId
   * @param {boolean} enabled
   * @returns {boolean}
   * @public
   */
  enableTrigger(triggerId, enabled) {
    const trigger = this.triggers.get(triggerId);
    if (!trigger) return false;
    trigger.enabled = Boolean(enabled);
    return true;
  }

  /**
   * Gets a list of all registered triggers.
   * @returns {Array<Object>}
   * @public
   */
  getTriggers() {
    return Array.from(this.triggers.values());
  }

  /**
   * Gets a specific trigger by ID.
   * @param {string} triggerId
   * @returns {Object|null}
   * @public
   */
  getTrigger(triggerId) {
    return this.triggers.get(triggerId) || null;
  }

  /**
   * Clears all triggers.
   * @public
   */
  clearAll() {
    this.triggers.clear();
    this.fileWatchers = new FileWatcherManager();
    this.gitHooks = new GitHookManager();
    this.webhooks = new WebhookListener();
    this.systemEvents = new SystemEventManager();
  }

  /**
   * Dispatches an event to matching registered triggers and optionally executes target command callback.
   * @param {string} eventType - "file_watcher", "git_hook", "webhook", "system_event"
   * @param {Object} eventDetails - Event details specific to event type
   * @param {Function} [commandExecutor=null] - Optional async function (cmdNameOrTemplate, params) => result
   * @returns {Promise<Array<Object>>} Executed trigger results
   * @public
   */
  async processEvent(eventType, eventDetails = {}, commandExecutor = null) {
    let matches = [];

    switch (eventType) {
      case "file_watcher":
      case "file_change":
        matches = this.fileWatchers.processFileEvent(eventDetails.file_path, eventDetails.file_event || "modify");
        break;

      case "git_hook":
        matches = this.gitHooks.processGitEvent(eventDetails.git_hook || eventDetails.hook, eventDetails);
        break;

      case "webhook":
      case "http_request":
        matches = this.webhooks.processHttpRequest(
          eventDetails.http_method || eventDetails.method || "POST",
          eventDetails.http_path || eventDetails.path || "/",
          eventDetails.http_headers || eventDetails.headers || {},
          eventDetails.http_body || eventDetails.body || {},
          eventDetails.http_query || eventDetails.query || {}
        );
        break;

      case "system_event":
      case "timer":
        matches = this.systemEvents.processSystemEvent(eventDetails.event_name || eventDetails.name || "custom", eventDetails);
        break;

      default:
        matches = this.systemEvents.processSystemEvent(eventType, eventDetails);
        break;
    }

    const results = [];

    for (const { trigger, context } of matches) {
      const resolvedCommand = substituteContext(trigger.target_command, context);
      const resolvedParams = substituteContext(trigger.parameters || {}, context);

      let success = true;
      let error = null;
      let output = null;

      if (typeof commandExecutor === "function") {
        try {
          output = await commandExecutor(resolvedCommand, resolvedParams, context);
        } catch (e) {
          success = false;
          error = e.message || String(e);
        }
      }

      const executionRecord = {
        trigger_id: trigger.id,
        trigger_name: trigger.name,
        event_type: eventType,
        timestamp: Date.now(),
        command: resolvedCommand,
        parameters: resolvedParams,
        context,
        success,
        error,
        output,
      };

      this.recordHistory(executionRecord);
      results.push(executionRecord);
    }

    return results;
  }

  /**
   * Records an execution event in history log.
   * @param {Object} record
   */
  recordHistory(record) {
    this.history.unshift(record);
    if (this.history.length > this.maxHistorySize) {
      this.history.pop();
    }
  }

  /**
   * Returns recent event execution history.
   * @returns {Array<Object>}
   * @public
   */
  getHistory() {
    return [...this.history];
  }

  /**
   * Clears event execution history.
   * @public
   */
  clearHistory() {
    this.history = [];
  }

  /**
   * Runs performance benchmark for condition evaluation and context substitution.
   * @param {number} [count=1000]
   * @returns {{ count: number, totalTimeMs: number, avgTimeMs: number, opsPerSec: number }}
   * @public
   */
  benchmarkPerformance(count = 1000) {
    const testCondition = {
      conditions: [
        { field: "file_path", operator: "ends_with", value: ".js" },
        { field: "file_event", operator: "equals", value: "modify" },
      ],
      logical_operator: "and",
    };
    const testContext = {
      file_path: "/app/src/components/button.js",
      file_event: "modify",
      file_name: "button.js",
    };

    const startTime = Date.now();
    for (let i = 0; i < count; i++) {
      evaluateCondition(testCondition, testContext);
      substituteContext("make build FILE={{file_name}}", testContext);
    }
    const totalTimeMs = Math.max(1, Date.now() - startTime);
    const avgTimeMs = totalTimeMs / count;
    const opsPerSec = Math.round((count / totalTimeMs) * 1000);

    return {
      count,
      totalTimeMs,
      avgTimeMs,
      opsPerSec,
    };
  }
}
