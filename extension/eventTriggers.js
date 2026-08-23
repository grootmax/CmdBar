/**
 * CmdBar Event-Based Triggers JS Engine
 * Operates in both Node.js (testing/companion) and GJS (GNOME Shell Extension) environments.
 */

import { substituteCommand } from "./commandProcessor.js";

const isNode =
  typeof process !== "undefined" && process.versions && process.versions.node;

let fs, pathModule, http, crypto, Gio, GLib;

if (isNode) {
  try {
    fs = await import("fs");
    pathModule = await import("path");
    http = await import("http");
    crypto = await import("crypto");
  } catch (e) {}
} else {
  try {
    const giModule = await import("gi");
    Gio = giModule.Gio || (giModule.default && giModule.default.Gio) || giModule.default;
    GLib = giModule.GLib || (giModule.default && giModule.default.GLib);
  } catch (e) {}
}

/**
 * Resolves nested dictionary fields using dot notation (e.g. 'payload.branch').
 */
export function resolveFieldValue(fieldPath, context) {
  if (!fieldPath || !context || typeof context !== "object") {
    return undefined;
  }
  const parts = String(fieldPath).split(".");
  let curr = context;
  for (const part of parts) {
    if (curr !== null && typeof curr === "object" && part in curr) {
      curr = curr[part];
    } else if (Array.isArray(curr) && !isNaN(Number(part))) {
      const idx = Number(part);
      if (idx >= 0 && idx < curr.length) {
        curr = curr[idx];
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }
  }
  return curr;
}

/**
 * Interpolates context values into command template placeholders like {key}, <key>, or {{key}}.
 */
export function interpolateParameters(template, context) {
  if (!template || typeof template !== "string") {
    return "";
  }
  if (!context || typeof context !== "object") {
    return template;
  }

  const pattern = /\{\{([^}]+)\}\}|<([^>]+)>|\{([^}]+)\}/g;
  return template.replace(pattern, (match, p1, p2, p3) => {
    const rawKey = (p1 || p2 || p3 || "").trim();
    if (!rawKey) return match;
    const val = resolveFieldValue(rawKey, context);
    if (val !== undefined && val !== null) {
      if (typeof val === "object") {
        return JSON.stringify(val);
      }
      return String(val);
    }
    return match;
  });
}

/**
 * Conditional logic evaluator.
 */
export class ConditionEvaluator {
  static evaluateRule(rule, context) {
    if (!rule || typeof rule !== "object") {
      return true;
    }

    if (Array.isArray(rule.all)) {
      return rule.all.every((r) => ConditionEvaluator.evaluateRule(r, context));
    }

    if (Array.isArray(rule.any)) {
      return rule.any.some((r) => ConditionEvaluator.evaluateRule(r, context));
    }

    if (rule.not) {
      return !ConditionEvaluator.evaluateRule(rule.not, context);
    }

    const field = rule.field;
    if (!field) {
      return true;
    }

    const op = String(rule.operator || "equals").toLowerCase();
    const target = rule.value;
    const actual = resolveFieldValue(field, context);

    switch (op) {
      case "equals":
      case "eq":
      case "==":
        return target !== undefined ? String(actual) === String(target) : actual === undefined;

      case "not_equals":
      case "neq":
      case "!=":
        return target !== undefined ? String(actual) !== String(target) : actual !== undefined;

      case "contains":
      case "includes":
        if (actual === undefined || actual === null) return false;
        if (Array.isArray(actual)) {
          return actual.includes(target) || actual.map(String).includes(String(target));
        }
        return String(actual).includes(String(target));

      case "not_contains":
      case "not_includes":
        if (actual === undefined || actual === null) return true;
        if (Array.isArray(actual)) {
          return !actual.includes(target) && !actual.map(String).includes(String(target));
        }
        return !String(actual).includes(String(target));

      case "matches_regex":
      case "regex":
        if (actual === undefined || actual === null || target === undefined) return false;
        try {
          const re = new RegExp(String(target));
          return re.test(String(actual));
        } catch (e) {
          return false;
        }

      case "greater_than":
      case "gt":
      case ">":
        return Number(actual) > Number(target);

      case "less_than":
      case "lt":
      case "<":
        return Number(actual) < Number(target);

      case "greater_equal":
      case "gte":
      case ">=":
        return Number(actual) >= Number(target);

      case "less_equal":
      case "lte":
      case "<=":
        return Number(actual) <= Number(target);

      case "in":
        if (actual === undefined || target === undefined) return false;
        if (Array.isArray(target)) {
          return target.includes(actual) || target.map(String).includes(String(actual));
        }
        return String(target).includes(String(actual));

      case "not_in":
        if (actual === undefined || target === undefined) return true;
        if (Array.isArray(target)) {
          return !target.includes(actual) && !target.map(String).includes(String(actual));
        }
        return !String(target).includes(String(actual));

      case "is_empty":
        if (actual === undefined || actual === null) return true;
        if (typeof actual === "string" || Array.isArray(actual)) return actual.length === 0;
        if (typeof actual === "object") return Object.keys(actual).length === 0;
        return false;

      case "is_not_empty":
        if (actual === undefined || actual === null) return false;
        if (typeof actual === "string" || Array.isArray(actual)) return actual.length > 0;
        if (typeof actual === "object") return Object.keys(actual).length > 0;
        return true;

      default:
        return false;
    }
  }
}

/**
 * Monitored File/Directory Watcher.
 */
export class FileWatcher {
  constructor(targetPath, callback, events = ["create", "modify", "delete"], recursive = false, debounceMs = 100) {
    this.targetPath = targetPath;
    this.callback = callback;
    this.events = events;
    this.recursive = recursive;
    this.debounceMs = debounceMs;
    this.watcher = null;
    this.debounceTimers = new Map();
  }

  start() {
    if (!isNode || !fs) return;
    try {
      if (!fs.existsSync(this.targetPath)) return;
      this.watcher = fs.watch(
        this.targetPath,
        { recursive: this.recursive },
        (eventType, filename) => {
          if (!filename) return;
          const fullPath = pathModule.join(this.targetPath, filename);
          const mappedEvent = eventType === "rename" ? (fs.existsSync(fullPath) ? "create" : "delete") : "modify";
          if (this.events.includes(mappedEvent) || this.events.includes("*")) {
            this._triggerDebounced(mappedEvent, fullPath, filename);
          }
        }
      );
    } catch (e) {
      console.error("FileWatcher error:", e);
    }
  }

  stop() {
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch (e) {}
      this.watcher = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  _triggerDebounced(action, fullPath, filename) {
    const key = `${action}:${fullPath}`;
    if (this.debounceTimers.has(key)) {
      clearTimeout(this.debounceTimers.get(key));
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      const ext = pathModule ? pathModule.extname(filename).replace(".", "") : "";
      const context = {
        event_type: "file_change",
        action,
        file_path: fullPath,
        file_name: filename,
        file_ext: ext,
        path: fullPath,
        timestamp: Date.now(),
      };
      if (typeof this.callback === "function") {
        this.callback(context);
      }
    }, this.debounceMs);

    this.debounceTimers.set(key, timer);
  }
}

/**
 * Git Hook Handler
 */
export class GitHookHandler {
  static getHooksDir(repoPath) {
    const resolvedPath = pathModule ? pathModule.resolve(repoPath) : repoPath;
    return pathModule ? pathModule.join(resolvedPath, ".git", "hooks") : `${resolvedPath}/.git/hooks`;
  }

  static installGitHook(repoPath, hookType, triggerId = "cmdbar") {
    if (!isNode || !fs) return false;
    try {
      const hooksDir = GitHookHandler.getHooksDir(repoPath);
      if (!fs.existsSync(hooksDir)) {
        fs.mkdirSync(hooksDir, { recursive: true });
      }
      const hookFile = pathModule.join(hooksDir, hookType);
      const scriptContent = `#!/bin/sh\n# CmdBar Git Hook Trigger [${triggerId}]\nnode -e "import('${pathModule.resolve("extension/eventTriggers.js")}').then(m => m.GitHookHandler.fireFromCLI('${pathModule.resolve(repoPath)}', '${hookType}'))" "$@"\n`;
      fs.writeFileSync(hookFile, scriptContent, { mode: 0o755 });
      return true;
    } catch (e) {
      return false;
    }
  }

  static uninstallGitHook(repoPath, hookType) {
    if (!isNode || !fs) return false;
    try {
      const hooksDir = GitHookHandler.getHooksDir(repoPath);
      const hookFile = pathModule.join(hooksDir, hookType);
      if (fs.existsSync(hookFile)) {
        fs.unlinkSync(hookFile);
        return true;
      }
    } catch (e) {}
    return false;
  }

  static buildEventContext(repoPath, hookType, args = []) {
    return {
      event_type: "git_hook",
      hook_type: hookType,
      repo_path: repoPath,
      payload: {
        hook_type: hookType,
        args,
      },
      timestamp: Date.now(),
    };
  }
}

/**
 * Webhook Server
 */
export class WebhookServer {
  constructor(port = 8080, endpoint = "/webhook", secret = null, engine = null) {
    this.port = port;
    this.endpoint = endpoint;
    this.secret = secret;
    this.engine = engine;
    this.server = null;
  }

  start() {
    if (!isNode || !http) return;
    this.server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        if (this.secret) {
          const authHeader = req.headers["authorization"] || "";
          const tokenHeader = req.headers["x-secret-token"] || "";
          const isAuthorized =
            (authHeader.startsWith("Bearer ") && authHeader.slice(7).trim() === this.secret) ||
            tokenHeader === this.secret;

          if (!isAuthorized) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Unauthorized" }));
            return;
          }
        }

        let payload = {};
        if (body) {
          try {
            payload = JSON.parse(body);
          } catch (e) {
            payload = { raw_body: body };
          }
        }

        const context = {
          event_type: "webhook",
          endpoint: req.url,
          method: req.method,
          payload,
          headers: req.headers,
          timestamp: Date.now(),
        };

        let results = [];
        if (this.engine) {
          results = this.engine.fireEvent("webhook", context);
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", executed_count: results.length }));
      });
    });

    this.server.listen(this.port);
  }

  stop() {
    if (this.server) {
      try {
        this.server.close();
      } catch (e) {}
      this.server = null;
    }
  }
}

/**
 * System Event Listener
 */
export class SystemEventListener {
  constructor(engine = null) {
    this.engine = engine;
  }

  emitEvent(eventName, payload = {}) {
    const context = {
      event_type: "system_event",
      event_name: eventName,
      payload,
      timestamp: Date.now(),
    };
    if (this.engine) {
      return this.engine.fireEvent("system_event", context);
    }
    return [];
  }
}

/**
 * Event Trigger Engine Core
 */
export class EventTriggerEngine {
  constructor(actionExecutor = null) {
    this.triggers = new Map();
    this.actionExecutor = actionExecutor || this._defaultExecutor;
    this.fileWatchers = new Map();
    this.webhookServers = new Map();
    this.systemListener = new SystemEventListener(this);
  }

  _defaultExecutor(command, context) {
    const interpolated = interpolateParameters(command, context);
    return {
      command: interpolated,
      success: true,
      timestamp: Date.now(),
    };
  }

  registerTrigger(trigger) {
    if (!trigger || typeof trigger !== "object") return false;
    const tId = String(trigger.id || `trig_${this.triggers.size + 1}_${Date.now()}`).trim();
    trigger.id = tId;
    if (trigger.enabled === undefined) trigger.enabled = true;
    if (!trigger.name) trigger.name = tId;
    if (!trigger.type) trigger.type = "file_change";
    if (!trigger.config) trigger.config = {};

    this.triggers.set(tId, trigger);
    this._setupTriggerServices(trigger);
    return true;
  }

  unregisterTrigger(triggerId) {
    const tId = String(triggerId).trim();
    if (this.triggers.has(tId)) {
      this._cleanupTriggerServices(tId);
      this.triggers.delete(tId);
      return true;
    }
    return false;
  }

  getTriggers() {
    return Array.from(this.triggers.values());
  }

  getTrigger(triggerId) {
    return this.triggers.get(String(triggerId).trim());
  }

  enableTrigger(triggerId) {
    const t = this.getTrigger(triggerId);
    if (t) {
      t.enabled = true;
      return true;
    }
    return false;
  }

  disableTrigger(triggerId) {
    const t = this.getTrigger(triggerId);
    if (t) {
      t.enabled = false;
      return true;
    }
    return false;
  }

  _setupTriggerServices(trigger) {
    const tId = trigger.id;
    const tType = trigger.type;
    const cfg = trigger.config || {};

    if (tType === "file_change" || tType === "file_watch") {
      if (cfg.path) {
        const watcher = new FileWatcher(
          cfg.path,
          (ctx) => this.fireEvent(tType, ctx),
          cfg.events || ["create", "modify", "delete"],
          cfg.recursive || false,
          cfg.debounceMs || cfg.debounce_ms || 100
        );
        watcher.start();
        this.fileWatchers.set(tId, watcher);
      }
    } else if (tType === "webhook" || tType === "http_request") {
      const port = cfg.port || 8080;
      if (!this.webhookServers.has(port)) {
        const server = new WebhookServer(
          port,
          cfg.endpoint || "/webhook",
          cfg.secret,
          this
        );
        server.start();
        this.webhookServers.set(port, server);
      }
    }
  }

  _cleanupTriggerServices(triggerId) {
    if (this.fileWatchers.has(triggerId)) {
      this.fileWatchers.get(triggerId).stop();
      this.fileWatchers.delete(triggerId);
    }
  }

  stopAllServices() {
    for (const watcher of this.fileWatchers.values()) {
      watcher.stop();
    }
    this.fileWatchers.clear();

    for (const server of this.webhookServers.values()) {
      server.stop();
    }
    this.webhookServers.clear();
  }

  fireEvent(eventType, context = {}) {
    const results = [];

    for (const [tId, trigger] of this.triggers.entries()) {
      if (trigger.enabled === false) continue;

      const targetType = trigger.type;
      if (targetType !== eventType && targetType !== "*") {
        if (
          eventType === "system_event" &&
          targetType === (trigger.config && trigger.config.event_name)
        ) {
          // Matched system event name
        } else {
          continue;
        }
      }

      const condition = trigger.condition || trigger.conditionalLogic;
      if (condition && !ConditionEvaluator.evaluateRule(condition, context)) {
        continue;
      }

      let actionCmd = "";
      const action = trigger.action;
      if (typeof action === "string") {
        actionCmd = action;
      } else if (action && typeof action === "object") {
        actionCmd = action.command || action.template || "";
      }

      if (!actionCmd) continue;

      const interpolatedCmd = interpolateParameters(actionCmd, context);
      const res = this.actionExecutor(interpolatedCmd, context);
      results.push({
        trigger_id: tId,
        trigger_name: trigger.name || tId,
        action_command: interpolatedCmd,
        context,
        result: res,
      });
    }

    return results;
  }
}
