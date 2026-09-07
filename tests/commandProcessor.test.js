import {
  validateInput,
  hasPlaceholder,
  substituteCommand,
  parseEnv,
  tokenizeCommand,
  getPlaceholders,
  substituteTokens,
  getPreviewTokens,
  fuzzyMatch,
  highlightMatches,
  escapeMarkup,
  rankCommands,
} from "../extension/commandProcessor.js";

describe("CmdBar Extension Core Unit Tests", () => {
  describe("Input Verification & Validation", () => {
    test("should block empty text submissions", () => {
      expect(validateInput("")).toBe(false);
      expect(validateInput(null)).toBe(false);
      expect(validateInput(undefined)).toBe(false);
    });

    test("should block whitespace-only submissions", () => {
      expect(validateInput("   ")).toBe(false);
      expect(validateInput("\n\t")).toBe(false);
    });

    test("should allow valid non-empty inputs", () => {
      expect(validateInput("my-task-123")).toBe(true);
      expect(validateInput("  my-task-123  ")).toBe(true);
      expect(validateInput("a")).toBe(true);
      expect(validateInput("12345")).toBe(true);
    });
  });

  describe("Placeholder Parameter Detection", () => {
    test("should detect placeholders with angle brackets <...>", () => {
      expect(hasPlaceholder("echo <task-id>")).toBe(true);
      expect(hasPlaceholder("deploy <service-name>")).toBe(true);
    });

    test("should detect placeholders with double curly braces {{...}}", () => {
      expect(
        hasPlaceholder("aws ecs update-service --service {{service-name}}"),
      ).toBe(true);
    });

    test("should detect placeholders with single curly braces {...}", () => {
      expect(hasPlaceholder("git checkout {branch}")).toBe(true);
      expect(hasPlaceholder("echo {ticket_id}")).toBe(true);
    });

    test("should return false if there are no placeholders in the command", () => {
      expect(hasPlaceholder("make build")).toBe(false);
      expect(hasPlaceholder("echo hello")).toBe(false);
      expect(hasPlaceholder("")).toBe(false);
      expect(hasPlaceholder(null)).toBe(false);
    });
  });

  describe("Command Template Substitution", () => {
    test("should substitute values into angle bracket placeholders <...>", () => {
      const template = "echo Starting task <task-id>";
      const val = "TFG-999";
      expect(substituteCommand(template, val)).toBe(
        "echo Starting task TFG-999",
      );
    });

    test("should substitute values into double curly braces placeholders {{...}}", () => {
      const template = "deploy {{service-name}}";
      const val = "auth-api";
      expect(substituteCommand(template, val)).toBe("deploy auth-api");
    });

    test("should substitute values into single curly brace placeholders {...}", () => {
      const template = "git checkout {branch}";
      const val = "feature-123";
      expect(substituteCommand(template, val)).toBe("git checkout feature-123");
    });

    test("should substitute multiple placeholders of mixed syntax types", () => {
      const template = "echo <task-id> {{service}} {branch}";
      const val = "123";
      expect(substituteCommand(template, val)).toBe("echo 123 123 123");
    });

    test("should handle null/undefined inputs gracefully", () => {
      const template = "echo <task-id>";
      expect(substituteCommand(template, null)).toBe("echo ");
      expect(substituteCommand(template, undefined)).toBe("echo ");
    });

    test("should return empty string if template is invalid", () => {
      expect(substituteCommand(null, "val")).toBe("");
      expect(substituteCommand(undefined, "val")).toBe("");
    });

    test("should handle replacement values with special characters like $ safely and literally", () => {
      const template = "echo <task-id>";
      const val = "$something$$";
      expect(substituteCommand(template, val)).toBe("echo $something$$");
    });
  });

  describe("Environment Parsing", () => {
    test("should handle empty or null/undefined stdout", () => {
      expect(parseEnv(null)).toEqual([]);
      expect(parseEnv(undefined)).toEqual([]);
      expect(parseEnv("")).toEqual([]);
    });

    test("should parse environment variables properly", () => {
      const stdout = "PATH=/usr/bin:/bin\nUSER=jules\nSHELL=/bin/bash\n";
      expect(parseEnv(stdout)).toEqual([
        "PATH=/usr/bin:/bin",
        "USER=jules",
        "SHELL=/bin/bash",
      ]);
    });

    test("should filter out lines without an equals sign", () => {
      const stdout = "PATH=/usr/bin\nINVALID_LINE_NO_EQUALS\nHOME=/app\n";
      expect(parseEnv(stdout)).toEqual(["PATH=/usr/bin", "HOME=/app"]);
    });
  });

  describe("Command Tokenization", () => {
    test("should tokenize command by space", () => {
      expect(tokenizeCommand("make build")).toEqual(["make", "build"]);
      expect(tokenizeCommand("echo <task-id>")).toEqual(["echo", "<task-id>"]);
    });

    test("should handle single and double quotes", () => {
      expect(tokenizeCommand('echo "hello world"')).toEqual([
        "echo",
        "hello world",
      ]);
      expect(tokenizeCommand("echo 'hello world'")).toEqual([
        "echo",
        "hello world",
      ]);
    });

    test("should handle backslash escapes", () => {
      expect(tokenizeCommand("echo hello\\ world")).toEqual([
        "echo",
        "hello world",
      ]);
    });

    test("should handle empty or invalid inputs", () => {
      expect(tokenizeCommand("")).toEqual([]);
      expect(tokenizeCommand(null)).toEqual([]);
      expect(tokenizeCommand(undefined)).toEqual([]);
    });
  });

  describe("Extract Placeholders", () => {
    test("should extract angle brackets, double curly, and single curly placeholders", () => {
      expect(getPlaceholders("echo <task-id>")).toEqual(["<task-id>"]);
      expect(getPlaceholders("deploy {{service-name}}")).toEqual([
        "{{service-name}}",
      ]);
      expect(getPlaceholders("git checkout {branch}")).toEqual(["{branch}"]);
      expect(
        getPlaceholders(
          "aws ecs update-service --service {{service-name}} --desired-count {count} --host <host>",
        ),
      ).toEqual(["{{service-name}}", "{count}", "<host>"]);
    });

    test("should handle no placeholders", () => {
      expect(getPlaceholders("make build")).toEqual([]);
      expect(getPlaceholders("")).toEqual([]);
      expect(getPlaceholders(null)).toEqual([]);
    });
  });

  describe("Token Substitution with Mapping", () => {
    test("should substitute mapped values safely across mixed placeholder syntaxes", () => {
      const tokens = [
        "aws",
        "ecs",
        "update",
        "--service",
        "{{service}}",
        "--count",
        "{count}",
        "--host",
        "<host>",
      ];
      const map = {
        "{{service}}": "auth-api",
        "{count}": "5",
        "<host>": "prod-host",
      };
      expect(substituteTokens(tokens, map)).toEqual([
        "aws",
        "ecs",
        "update",
        "--service",
        "auth-api",
        "--count",
        "5",
        "--host",
        "prod-host",
      ]);
    });

    test("should substitute mapped values safely", () => {
      const tokens = ["echo", "<task-id>"];
      const map = { "<task-id>": "hello world; rm -rf /" };
      expect(substituteTokens(tokens, map)).toEqual([
        "echo",
        "hello world; rm -rf /",
      ]);
    });

    test("should handle substitution values with $ safely and literally", () => {
      const tokens = ["echo", "<pwd>"];
      const map = { "<pwd>": "p@$$w0rd" };
      expect(substituteTokens(tokens, map)).toEqual(["echo", "p@$$w0rd"]);
    });

    test("should handle empty or missing maps", () => {
      const tokens = ["make", "build"];
      expect(substituteTokens(tokens, null)).toEqual(["make", "build"]);
      expect(substituteTokens(tokens, {})).toEqual(["make", "build"]);
    });
  });

  describe("Sensitive Parameter Redaction in Confirmation Previews", () => {
    test("should redact secure parameter values in preview tokens", () => {
      const argv = ["login", "-u", "jules", "-p", "mySecretPass123"];
      const map = { password: "mySecretPass123" };
      const schema = [{ name: "password", secure: true }];
      expect(getPreviewTokens(argv, map, schema)).toEqual([
        "login",
        "-u",
        "jules",
        "-p",
        "[REDACTED]",
      ]);
    });

    test("should automatically redact parameter keys containing password, secret, or token", () => {
      const argv = ["curl", "-H", "Authorization: Bearer secretTokenABC"];
      const map = { token: "secretTokenABC" };
      expect(getPreviewTokens(argv, map, [])).toEqual([
        "curl",
        "-H",
        "Authorization: Bearer [REDACTED]",
      ]);
    });

    test("should keep non-sensitive parameter values visible in preview", () => {
      const argv = ["git", "checkout", "feature/safe-quoting"];
      const map = { branch: "feature/safe-quoting" };
      expect(getPreviewTokens(argv, map, [])).toEqual([
        "git",
        "checkout",
        "feature/safe-quoting",
      ]);
    });
  });

  describe("Fuzzy Matching Algorithm", () => {
    test('should match "gp" to "git push origin"', () => {
      const res = fuzzyMatch("gp", "git push origin");
      expect(res.match).toBe(true);
      expect(res.matches).toEqual([0, 4]);
      expect(res.score).toBeGreaterThan(0);
    });

    test("should match exact string with higher score than partial match", () => {
      const exactRes = fuzzyMatch("git", "git");
      const partialRes = fuzzyMatch("git", "git push origin");
      expect(exactRes.match).toBe(true);
      expect(partialRes.match).toBe(true);
      expect(exactRes.score).toBeGreaterThan(partialRes.score);
    });

    test("should return match: false when pattern characters are missing", () => {
      const res = fuzzyMatch("xyz", "git push origin");
      expect(res.match).toBe(false);
      expect(res.matches).toEqual([]);
    });

    test("should match all commands when query is empty or whitespace", () => {
      const resEmpty = fuzzyMatch("", "git push origin");
      const resSpace = fuzzyMatch("   ", "git push origin");
      expect(resEmpty.match).toBe(true);
      expect(resSpace.match).toBe(true);
    });

    test("should boost score based on usage frequency", () => {
      const lowUsage = fuzzyMatch("git", "git push", 1);
      const highUsage = fuzzyMatch("git", "git push", 10);
      expect(highUsage.score).toBeGreaterThan(lowUsage.score);
    });
  });

  describe("Matched Character Highlighting & Markup Escaping", () => {
    test("should surround matched indices with <b> tags", () => {
      const highlighted = highlightMatches("git push origin", [0, 4]);
      expect(highlighted).toBe("<b>g</b>it <b>p</b>ush origin");
    });

    test("should combine contiguous matched indices into single tag range", () => {
      const highlighted = highlightMatches("git push origin", [0, 1, 2]);
      expect(highlighted).toBe("<b>git</b> push origin");
    });

    test("should escape HTML/XML characters safely", () => {
      expect(escapeMarkup('echo <task-id> & "test"')).toBe(
        "echo &lt;task-id&gt; &amp; &quot;test&quot;",
      );
      const highlighted = highlightMatches("echo <task>", [0, 1, 2, 3]);
      expect(highlighted).toBe("<b>echo</b> &lt;task&gt;");
    });
  });

  describe("Command Ranking and Performance", () => {
    test("should rank matching commands by relevance and usage frequency", () => {
      const commands = [
        { name: "Git Push", command: "git push origin" },
        { name: "Git Pull", command: "git pull origin" },
        { name: "Docker Run", command: "docker run -d" },
      ];
      const usageMap = { "git pull origin": 10 };
      const ranked = rankCommands(commands, "gp", usageMap);
      expect(ranked.length).toBe(2);
      expect(ranked[0].command.name).toBe("Git Pull"); // Boosted by high usage frequency
    });

    test("should process search and rank for 100+ commands in under 100ms", () => {
      const largeCommandsList = [];
      for (let i = 0; i < 150; i++) {
        largeCommandsList.push({
          name: `Command Option ${i}`,
          command: `git checkout branch-${i} && make build-${i}`,
        });
      }

      const startTime = performance.now();
      const ranked = rankCommands(largeCommandsList, "gc", {});
      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(100); // Acceptance criteria: < 100ms
      expect(ranked.length).toBeGreaterThan(0);
    });
  });
});
