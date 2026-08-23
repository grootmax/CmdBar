import fs from "fs";
import path from "path";
import os from "os";
import http from "http";
import {
  resolveFieldValue,
  interpolateParameters,
  ConditionEvaluator,
  FileWatcher,
  GitHookHandler,
  WebhookServer,
  SystemEventListener,
  EventTriggerEngine,
} from "../extension/eventTriggers.js";

describe("Event-Based Triggers - Unit & Integration Tests", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmdbar-triggers-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("Field Resolution & Parameter Interpolation", () => {
    test("resolveFieldValue handles flat and nested dot notation keys", () => {
      const context = {
        file_name: "index.js",
        payload: {
          branch: "main",
          commit: { sha: "abc1234" },
          items: ["first", "second"],
        },
      };

      expect(resolveFieldValue("file_name", context)).toBe("index.js");
      expect(resolveFieldValue("payload.branch", context)).toBe("main");
      expect(resolveFieldValue("payload.commit.sha", context)).toBe("abc1234");
      expect(resolveFieldValue("payload.items.1", context)).toBe("second");
      expect(resolveFieldValue("non_existent", context)).toBeUndefined();
      expect(resolveFieldValue("payload.invalid.key", context)).toBeUndefined();
    });

    test("interpolateParameters substitutes placeholders of various formats", () => {
      const context = {
        file_path: "/src/main.js",
        payload: { branch: "feature/login" },
      };

      const template1 = "echo File: {file_path} on branch {payload.branch}";
      expect(interpolateParameters(template1, context)).toBe(
        "echo File: /src/main.js on branch feature/login"
      );

      const template2 = "git checkout <payload.branch> && process <file_path>";
      expect(interpolateParameters(template2, context)).toBe(
        "git checkout feature/login && process /src/main.js"
      );

      const template3 = "deploy {{payload.branch}}";
      expect(interpolateParameters(template3, context)).toBe("deploy feature/login");
    });
  });

  describe("Condition Evaluator", () => {
    test("evaluateRule equality and inequality operators", () => {
      const context = { status: "success", code: 200 };

      expect(
        ConditionEvaluator.evaluateRule(
          { field: "status", operator: "equals", value: "success" },
          context
        )
      ).toBe(true);

      expect(
        ConditionEvaluator.evaluateRule(
          { field: "status", operator: "not_equals", value: "failed" },
          context
        )
      ).toBe(true);

      expect(
        ConditionEvaluator.evaluateRule(
          { field: "code", operator: "eq", value: "200" },
          context
        )
      ).toBe(true);
    });

    test("evaluateRule string and array containment operators", () => {
      const context = {
        file_name: "test_suite.spec.js",
        tags: ["ci", "release", "frontend"],
      };

      expect(
        ConditionEvaluator.evaluateRule(
          { field: "file_name", operator: "contains", value: "spec" },
          context
        )
      ).toBe(true);

      expect(
        ConditionEvaluator.evaluateRule(
          { field: "file_name", operator: "not_contains", value: "python" },
          context
        )
      ).toBe(true);

      expect(
        ConditionEvaluator.evaluateRule(
          { field: "tags", operator: "contains", value: "release" },
          context
        )
      ).toBe(true);
    });

    test("evaluateRule regex and comparison operators", () => {
      const context = { version: "v2.5.1", coverage: 87.5 };

      expect(
        ConditionEvaluator.evaluateRule(
          { field: "version", operator: "matches_regex", value: "^v[0-9]+\\." },
          context
        )
      ).toBe(true);

      expect(
        ConditionEvaluator.evaluateRule(
          { field: "coverage", operator: "greater_than", value: 80 },
          context
        )
      ).toBe(true);

      expect(
        ConditionEvaluator.evaluateRule(
          { field: "coverage", operator: "less_than", value: 50 },
          context
        )
      ).toBe(false);
    });

    test("evaluateRule in / not_in and is_empty / is_not_empty operators", () => {
      const context = { env: "staging", empty_list: [], filled_str: "content" };

      expect(
        ConditionEvaluator.evaluateRule(
          { field: "env", operator: "in", value: ["staging", "production"] },
          context
        )
      ).toBe(true);

      expect(
        ConditionEvaluator.evaluateRule(
          { field: "empty_list", operator: "is_empty" },
          context
        )
      ).toBe(true);

      expect(
        ConditionEvaluator.evaluateRule(
          { field: "filled_str", operator: "is_not_empty" },
          context
        )
      ).toBe(true);
    });

    test("evaluateRule nested boolean logic (all / any / not)", () => {
      const context = { branch: "main", status: "passed", build_id: 104 };

      const ruleAll = {
        all: [
          { field: "branch", operator: "equals", value: "main" },
          { field: "status", operator: "equals", value: "passed" },
        ],
      };
      expect(ConditionEvaluator.evaluateRule(ruleAll, context)).toBe(true);

      const ruleAny = {
        any: [
          { field: "branch", operator: "equals", value: "dev" },
          { field: "status", operator: "equals", value: "passed" },
        ],
      };
      expect(ConditionEvaluator.evaluateRule(ruleAny, context)).toBe(true);

      const ruleNot = {
        not: { field: "branch", operator: "equals", value: "feature" },
      };
      expect(ConditionEvaluator.evaluateRule(ruleNot, context)).toBe(true);
    });
  });

  describe("FileWatcher Integration", () => {
    test("FileWatcher detects file modifications with debouncing", (done) => {
      const targetFile = path.join(tmpDir, "watched.txt");
      fs.writeFileSync(targetFile, "initial content");

      let callCount = 0;
      let lastCtx = null;

      const watcher = new FileWatcher(
        tmpDir,
        (context) => {
          callCount++;
          lastCtx = context;
        },
        ["modify", "create"],
        false,
        50
      );

      watcher.start();

      setTimeout(() => {
        fs.appendFileSync(targetFile, "\nupdated content 1");
        fs.appendFileSync(targetFile, "\nupdated content 2");

        setTimeout(() => {
          watcher.stop();
          expect(callCount).toBeGreaterThanOrEqual(1);
          expect(lastCtx).not.toBeNull();
          expect(lastCtx.event_type).toBe("file_change");
          done();
        }, 150);
      }, 50);
    });
  });

  describe("GitHookHandler", () => {
    test("installs and uninstalls git hook script", () => {
      const repoDir = path.join(tmpDir, "test_repo");
      fs.mkdirSync(path.join(repoDir, ".git", "hooks"), { recursive: true });

      const installed = GitHookHandler.installGitHook(
        repoDir,
        "pre-commit",
        "trig_1"
      );
      expect(installed).toBe(true);

      const hookFile = path.join(repoDir, ".git", "hooks", "pre-commit");
      expect(fs.existsSync(hookFile)).toBe(true);

      const uninstalled = GitHookHandler.uninstallGitHook(repoDir, "pre-commit");
      expect(uninstalled).toBe(true);
      expect(fs.existsSync(hookFile)).toBe(false);
    });

    test("buildEventContext constructs correct git hook context", () => {
      const ctx = GitHookHandler.buildEventContext("/tmp/repo", "post-commit", [
        "arg1",
      ]);
      expect(ctx.event_type).toBe("git_hook");
      expect(ctx.hook_type).toBe("post-commit");
      expect(ctx.repo_path).toBe("/tmp/repo");
      expect(ctx.payload.args).toEqual(["arg1"]);
    });
  });

  describe("WebhookServer Integration", () => {
    test("handles POST requests and fires events with authorization", (done) => {
      const port = 18990;
      const secret = "test-secret-key";

      const engine = new EventTriggerEngine();
      let triggered = false;
      let recContext = null;

      engine.registerTrigger({
        id: "webhook_trig",
        type: "webhook",
        config: { port, secret },
        action: "echo Webhook Received",
      });

      // Override actionExecutor for testing
      engine.actionExecutor = (cmd, ctx) => {
        triggered = true;
        recContext = ctx;
        return { success: true };
      };

      setTimeout(() => {
        const postData = JSON.stringify({
          action: "deploy",
          service: "api-gateway",
        });

        const req = http.request(
          {
            hostname: "127.0.0.1",
            port,
            path: "/webhook",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(postData),
              "X-Secret-Token": secret,
            },
          },
          (res) => {
            let resData = "";
            res.on("data", (chunk) => (resData += chunk));
            res.on("end", () => {
              engine.stopAllServices();
              expect(res.statusCode).toBe(200);
              expect(triggered).toBe(true);
              expect(recContext.payload.service).toBe("api-gateway");
              done();
            });
          }
        );

        req.write(postData);
        req.end();
      }, 50);
    });
  });

  describe("EventTriggerEngine Management", () => {
    test("registers, enables, disables, and unregisters triggers", () => {
      const engine = new EventTriggerEngine();

      const success = engine.registerTrigger({
        id: "trig_test",
        type: "file_change",
        action: "echo Changed",
        condition: { field: "file_ext", operator: "equals", value: "js" },
      });

      expect(success).toBe(true);
      expect(engine.getTriggers().length).toBe(1);

      engine.disableTrigger("trig_test");
      expect(engine.getTrigger("trig_test").enabled).toBe(false);

      engine.enableTrigger("trig_test");
      expect(engine.getTrigger("trig_test").enabled).toBe(true);

      const unregistered = engine.unregisterTrigger("trig_test");
      expect(unregistered).toBe(true);
      expect(engine.getTriggers().length).toBe(0);
    });

    test("fireEvent evaluates conditions and executes target command", () => {
      const engine = new EventTriggerEngine();
      let executedCmd = null;

      engine.actionExecutor = (cmd, ctx) => {
        executedCmd = cmd;
        return { success: true };
      };

      engine.registerTrigger({
        id: "build_trig",
        type: "file_change",
        action: "npm run build --file={file_name}",
        condition: { field: "file_ext", operator: "equals", value: "ts" },
      });

      // Fire with non-matching extension -> should not execute
      engine.fireEvent("file_change", {
        file_name: "README.md",
        file_ext: "md",
      });
      expect(executedCmd).toBeNull();

      // Fire with matching extension -> should execute with interpolation
      engine.fireEvent("file_change", {
        file_name: "index.ts",
        file_ext: "ts",
      });
      expect(executedCmd).toBe("npm run build --file=index.ts");
    });
  });

  describe("Performance Benchmarks", () => {
    test("Condition evaluation achieves high throughput (>10,000 ops/sec)", () => {
      const context = {
        status: "active",
        user: { role: "admin", level: 5 },
        tags: ["backend", "core"],
      };

      const rule = {
        all: [
          { field: "status", operator: "equals", value: "active" },
          { field: "user.role", operator: "equals", value: "admin" },
          { field: "user.level", operator: "greater_than", value: 3 },
          { field: "tags", operator: "contains", value: "core" },
        ],
      };

      const iterations = 5000;
      const start = Date.now();
      for (let i = 0; i < iterations; i++) {
        ConditionEvaluator.evaluateRule(rule, context);
      }
      const elapsedMs = Date.now() - start;
      const opsPerSec = (iterations / elapsedMs) * 1000;

      expect(elapsedMs).toBeLessThan(1000);
      expect(opsPerSec).toBeGreaterThan(10000);
    });
  });
});
