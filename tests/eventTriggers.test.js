import {
  evaluateCondition,
  evaluateConditions,
  substituteContext,
  computeHmacSha256,
  getNestedValue,
  FileWatcherManager,
  GitHookManager,
  WebhookListener,
  SystemEventManager,
  EventTriggerManager,
} from "../extension/eventTriggers.js";

describe("Event-Based Triggers Engine (JS)", () => {
  describe("getNestedValue", () => {
    test("retrieves nested properties using dot notation", () => {
      const obj = { user: { name: "Alice", meta: { role: "admin" } } };
      expect(getNestedValue(obj, "user.name")).toBe("Alice");
      expect(getNestedValue(obj, "user.meta.role")).toBe("admin");
      expect(getNestedValue(obj, "user.nonexistent")).toBeUndefined();
      expect(getNestedValue(null, "user.name")).toBeUndefined();
      expect(getNestedValue(obj, "")).toBeUndefined();
      expect(getNestedValue("invalid", "user")).toBeUndefined();
    });
  });

  describe("evaluateCondition", () => {
    const context = {
      file_path: "/app/src/index.js",
      file_event: "modify",
      git_branch: "main",
      status_code: 200,
      http_body: { ref: "refs/heads/main", action: "opened" },
      tags: ["ci", "build"],
    };

    test("handles null, invalid, or empty condition", () => {
      expect(evaluateCondition(null, context)).toBe(true);
      expect(evaluateCondition({}, context)).toBe(true);
    });

    test("evaluates equality operators", () => {
      expect(evaluateCondition({ field: "git_branch", operator: "equals", value: "main" }, context)).toBe(true);
      expect(evaluateCondition({ field: "git_branch", operator: "==", value: "main" }, context)).toBe(true);
      expect(evaluateCondition({ field: "git_branch", operator: "eq", value: "main" }, context)).toBe(true);
      expect(evaluateCondition({ field: "git_branch", operator: "not_equals", value: "dev" }, context)).toBe(true);
      expect(evaluateCondition({ field: "git_branch", operator: "!=", value: "dev" }, context)).toBe(true);
      expect(evaluateCondition({ field: "git_branch", operator: "ne", value: "dev" }, context)).toBe(true);
    });

    test("evaluates string matching operators (starts_with, ends_with, contains, regex)", () => {
      expect(evaluateCondition({ field: "file_path", operator: "ends_with", value: ".js" }, context)).toBe(true);
      expect(evaluateCondition({ field: "file_path", operator: "starts_with", value: "/app" }, context)).toBe(true);
      expect(evaluateCondition({ field: "file_path", operator: "contains", value: "src" }, context)).toBe(true);
      expect(evaluateCondition({ field: "file_path", operator: "not_contains", value: "test" }, context)).toBe(true);
      expect(evaluateCondition({ field: "tags", operator: "not_contains", value: "deploy" }, context)).toBe(true);
      expect(evaluateCondition({ field: "file_path", operator: "regex", value: "\\.js$" }, context)).toBe(true);
      expect(evaluateCondition({ field: "file_path", operator: "regex", value: "[" }, context)).toBe(false); // Invalid regex
    });

    test("evaluates numeric comparison operators (gt, lt, gte, lte)", () => {
      expect(evaluateCondition({ field: "status_code", operator: "gt", value: 199 }, context)).toBe(true);
      expect(evaluateCondition({ field: "status_code", operator: "greater_than", value: 199 }, context)).toBe(true);
      expect(evaluateCondition({ field: "status_code", operator: "lt", value: 300 }, context)).toBe(true);
      expect(evaluateCondition({ field: "status_code", operator: "less_than", value: 300 }, context)).toBe(true);
      expect(evaluateCondition({ field: "status_code", operator: "gte", value: 200 }, context)).toBe(true);
      expect(evaluateCondition({ field: "status_code", operator: "greater_than_or_equal", value: 200 }, context)).toBe(true);
      expect(evaluateCondition({ field: "status_code", operator: "lte", value: 200 }, context)).toBe(true);
      expect(evaluateCondition({ field: "status_code", operator: "less_than_or_equal", value: 200 }, context)).toBe(true);
    });

    test("evaluates array and membership operators (in, not_in)", () => {
      expect(evaluateCondition({ field: "tags", operator: "contains", value: "ci" }, context)).toBe(true);
      expect(evaluateCondition({ field: "git_branch", operator: "in", value: ["main", "master"] }, context)).toBe(true);
      expect(evaluateCondition({ field: "git_branch", operator: "in", value: "main_branch" }, context)).toBe(true);
      expect(evaluateCondition({ field: "git_branch", operator: "not_in", value: ["feature", "dev"] }, context)).toBe(true);
      expect(evaluateCondition({ field: "git_branch", operator: "not_in", value: "other_branch" }, context)).toBe(true);
    });

    test("evaluates existence operators (exists, not_exists)", () => {
      expect(evaluateCondition({ field: "file_path", operator: "exists" }, context)).toBe(true);
      expect(evaluateCondition({ field: "nonexistent_field", operator: "not_exists" }, context)).toBe(true);
    });

    test("evaluates compound conditions with AND / OR logical operators", () => {
      const compoundAnd = {
        logical_operator: "and",
        conditions: [
          { field: "git_branch", operator: "equals", value: "main" },
          { field: "file_path", operator: "ends_with", value: ".js" },
        ],
      };
      expect(evaluateCondition(compoundAnd, context)).toBe(true);

      const compoundOr = {
        logical_operator: "or",
        conditions: [
          { field: "git_branch", operator: "equals", value: "dev" },
          { field: "file_path", operator: "ends_with", value: ".js" },
        ],
      };
      expect(evaluateCondition(compoundOr, context)).toBe(true);
    });

    test("evaluateConditions handles empty or custom logical operators", () => {
      expect(evaluateConditions(null, context)).toBe(true);
      expect(evaluateConditions([], context)).toBe(true);
      expect(evaluateConditions([
        { field: "git_branch", operator: "equals", value: "dev" },
        { field: "file_path", operator: "ends_with", value: ".js" }
      ], context, "or")).toBe(true);
    });
  });

  describe("substituteContext", () => {
    test("substitutes {{field}} and <field> placeholders using event context", () => {
      const context = {
        file_name: "app.js",
        git_branch: "feature/login",
        user: { name: "Bob" },
        meta: { id: 123 },
      };
      const template = "git checkout {{git_branch}} && node <file_name> --user={{user.name}} --meta={{meta}}";
      const result = substituteContext(template, context);
      expect(result).toBe('git checkout feature/login && node app.js --user=Bob --meta={"id":123}');
    });

    test("handles non-string templates and array mapping", () => {
      const context = { file_path: "/tmp/file.txt", event: "created" };
      expect(substituteContext(null, context)).toBeNull();
      expect(substituteContext(123, context)).toBe(123);
      expect(substituteContext(["<event>", "{{file_path}}"], context)).toEqual(["created", "/tmp/file.txt"]);
    });
  });

  describe("computeHmacSha256", () => {
    test("computes HMAC SHA256 signature for webhook verification", () => {
      expect(computeHmacSha256("test", "")).toBe("");
      const payload = '{"ref":"refs/heads/main"}';
      const secret = "secret123";
      const sig = computeHmacSha256(payload, secret);
      expect(typeof sig).toBe("string");
      expect(sig.length).toBeGreaterThan(0);
    });
  });

  describe("FileWatcherManager", () => {
    test("registers, gets, and removes watches", () => {
      const fwm = new FileWatcherManager();
      expect(fwm.addWatch(null)).toBe(false);
      const trigger = {
        id: "fw1",
        enabled: true,
        type: "file_watcher",
        config: { path: "/app/src", events: ["modify", "create"], recursive: true },
        conditions: [{ field: "file_name", operator: "ends_with", value: ".js" }],
      };
      expect(fwm.addWatch(trigger)).toBe(true);
      expect(fwm.getWatch("fw1")).toBe(trigger);

      const matches = fwm.processFileEvent("/app/src/index.js", "modify");
      expect(matches.length).toBe(1);

      expect(fwm.removeWatch("fw1")).toBe(true);
      expect(fwm.getWatch("fw1")).toBeUndefined();
    });
  });

  describe("GitHookManager", () => {
    test("registers, removes, and processes git hooks", () => {
      const ghm = new GitHookManager();
      expect(ghm.addHook(null)).toBe(false);
      const trigger = {
        id: "gh1",
        enabled: true,
        type: "git_hook",
        config: { hook: "pre-commit", branch: "main", repo_path: "/app" },
      };
      expect(ghm.addHook(trigger)).toBe(true);

      const matches = ghm.processGitEvent("pre-commit", { repo_path: "/app", branch: "main" });
      expect(matches.length).toBe(1);

      expect(ghm.removeHook("gh1")).toBe(true);
    });
  });

  describe("WebhookListener", () => {
    test("processes incoming webhook HTTP requests with token and query secret", () => {
      const wl = new WebhookListener();
      expect(wl.addEndpoint(null)).toBe(false);

      const secret = "token123";
      wl.addEndpoint({
        id: "wh1",
        enabled: true,
        type: "webhook",
        config: { path_pattern: "^/webhook/.*", method: "POST", secret },
      });

      const matchHeader = wl.processHttpRequest(
        "POST",
        "/webhook/github",
        { "x-webhook-token": "token123" },
        '{"action":"push"}'
      );
      expect(matchHeader.length).toBe(1);

      const matchQuery = wl.processHttpRequest(
        "POST",
        "/webhook/github",
        {},
        '{"action":"push"}',
        { secret: "token123" }
      );
      expect(matchQuery.length).toBe(1);

      expect(wl.removeEndpoint("wh1")).toBe(true);
    });
  });

  describe("SystemEventManager", () => {
    test("processes system events and handles removal", () => {
      const sem = new SystemEventManager();
      expect(sem.addTrigger(null)).toBe(false);
      sem.addTrigger({
        id: "sys1",
        enabled: true,
        type: "system_event",
        config: { event_name: "timer" },
      });

      const matches = sem.processSystemEvent("timer", { interval: 60 });
      expect(matches.length).toBe(1);

      expect(sem.removeTrigger("sys1")).toBe(true);
    });
  });

  describe("EventTriggerManager", () => {
    test("handles full trigger CRUD, enablement, processing, history, and command execution errors", async () => {
      const etm = new EventTriggerManager();
      expect(etm.addTrigger(null)).toBe(false);

      etm.addTrigger({
        id: "trig_err",
        name: "Failing Trigger",
        type: "system_event",
        enabled: true,
        target_command: "fail_cmd",
        config: { event_name: "test_error" },
      });

      expect(etm.getTrigger("trig_err")).not.toBeNull();
      expect(etm.getTrigger("nonexistent")).toBeNull();

      const failingExecutor = async () => {
        throw new Error("Execution failed intentionally");
      };

      const results = await etm.processEvent("system_event", { event_name: "test_error" }, failingExecutor);
      expect(results.length).toBe(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe("Execution failed intentionally");

      expect(etm.getHistory().length).toBe(1);
      etm.clearHistory();
      expect(etm.getHistory().length).toBe(0);

      expect(etm.removeTrigger("trig_err")).toBe(true);
      expect(etm.removeTrigger("nonexistent")).toBe(false);
      expect(etm.enableTrigger("nonexistent", true)).toBe(false);
    });
  });
});
