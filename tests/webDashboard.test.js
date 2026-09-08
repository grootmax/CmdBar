import {
  validateParameterValue,
  shellQuote,
  resolveCommandPreview,
  reorderArray,
  moveCommandBetweenCategories,
  applyTeamPreset,
  exportConfigJSON,
  importConfigJSON,
} from "../dashboard/dashboard.js";

describe("CmdBar Web Dashboard Unit & Integration Tests", () => {
  describe("Parameter Validation Logic", () => {
    test("should allow valid input matching regex", () => {
      const schema = { regex: "^[a-zA-Z0-9_-]+$" };
      const result = validateParameterValue("my-container-123", schema);
      expect(result.isValid).toBe(true);
      expect(result.errorMessage).toBeNull();
    });

    test("should reject input failing regex pattern", () => {
      const schema = { regex: "^[0-9]+$", error_message: "Must be numeric!" };
      const result = validateParameterValue("abc", schema);
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe("Must be numeric!");
    });

    test("should reject input containing forbidden shell characters", () => {
      const schema = { regex: ".*" };
      const forbiddenChars = [
        ";",
        "&&",
        "||",
        "|",
        "&",
        "`",
        "$",
        "(",
        ")",
        ">",
        "<",
      ];

      forbiddenChars.forEach((char) => {
        const result = validateParameterValue(`test${char}injection`, schema);
        expect(result.isValid).toBe(false);
        expect(result.errorMessage).toContain("forbidden character");
      });
    });

    test("should handle secure parameter masking", () => {
      const schema = { regex: "^[a-zA-Z0-9]+$", secure: true };
      const result = validateParameterValue("secret;injection", schema);
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).not.toContain("secret;injection");
    });
  });

  describe("Shell Quoting & Command Preview Engine", () => {
    test("should quote strings containing spaces or special characters", () => {
      expect(shellQuote("hello")).toBe("hello");
      expect(shellQuote("hello world")).toBe("'hello world'");
      expect(shellQuote("foo;bar")).toBe("'foo;bar'");
    });

    test("should resolve shell-quoted preview with parameter values", () => {
      const template = "deploy.sh --service <service> --version <version>";
      const values = { service: "auth-api", version: "v1.2.0" };
      const schemas = {
        service: { regex: "^[a-zA-Z0-9_-]+$" },
        version: { regex: "^[a-zA-Z0-9_.-]+$" },
      };

      const preview = resolveCommandPreview(
        template,
        "shell-quoted",
        values,
        schemas,
      );
      expect(preview.resolved).toBe(
        "deploy.sh --service auth-api --version v1.2.0",
      );
      expect(Object.keys(preview.errors).length).toBe(0);
    });

    test("should resolve direct-array preview format", () => {
      const template = '/usr/bin/echo "Running task" <task_id>';
      const values = { task_id: "TASK-101" };
      const schemas = { task_id: { regex: "^[a-zA-Z0-9_-]+$" } };

      const preview = resolveCommandPreview(
        template,
        "direct-array",
        values,
        schemas,
      );
      expect(preview.resolved).toContain("Direct Array");
      expect(preview.resolved).toContain("TASK-101");
      expect(Object.keys(preview.errors).length).toBe(0);
    });

    test("should mask secure parameter values in dry-run preview output", () => {
      const template = "login.sh --pass <token>";
      const values = { token: "secret-auth-key" };
      const schemas = { token: { secure: true, regex: ".*" } };

      const preview = resolveCommandPreview(
        template,
        "shell-quoted",
        values,
        schemas,
      );
      expect(preview.resolved).not.toContain("secret-auth-key");
      expect(preview.resolved).toContain("***************"); // 15 asterisks
    });

    test("should collect errors for invalid parameter values", () => {
      const template = "ping <host>";
      const values = { host: "invalid;host" };
      const schemas = { host: { regex: "^[a-zA-Z0-9.-]+$" } };

      const preview = resolveCommandPreview(
        template,
        "shell-quoted",
        values,
        schemas,
      );
      expect(preview.errors.host).toBeDefined();
      expect(preview.errors.host).toContain("forbidden character");
    });
  });

  describe("Drag-and-Drop & Reordering Helpers", () => {
    test("should reorder array elements correctly", () => {
      const items = ["Cat A", "Cat B", "Cat C"];
      const reordered = reorderArray(items, 0, 2);
      expect(reordered).toEqual(["Cat B", "Cat C", "Cat A"]);
    });

    test("should handle invalid reorder bounds gracefully", () => {
      const items = ["A", "B"];
      expect(reorderArray(items, -1, 1)).toEqual(items);
      expect(reorderArray(items, 0, 10)).toEqual(items);
    });

    test("should move commands between categories", () => {
      const config = {
        categories: [
          { name: "Cat 1", commands: [{ name: "Cmd 1" }, { name: "Cmd 2" }] },
          { name: "Cat 2", commands: [{ name: "Cmd 3" }] },
        ],
      };

      const updated = moveCommandBetweenCategories(config, 0, 0, 1, 1);
      expect(updated.categories[0].commands.length).toBe(1);
      expect(updated.categories[0].commands[0].name).toBe("Cmd 2");
      expect(updated.categories[1].commands.length).toBe(2);
      expect(updated.categories[1].commands[1].name).toBe("Cmd 1");
    });
  });

  describe("Team Collaboration & Import/Export", () => {
    test("should apply team presets into configuration", () => {
      const config = { categories: [{ name: "Existing", commands: [] }] };
      const merged = applyTeamPreset("DevOps", config);

      expect(merged.categories.length).toBe(2);
      const devopsCat = merged.categories.find(
        (c) => c.name === "DevOps & Infrastructure",
      );
      expect(devopsCat).toBeDefined();
      expect(devopsCat.commands.length).toBeGreaterThan(0);
    });

    test("should export configuration with team metadata", () => {
      const config = { categories: [{ name: "Projects", commands: [] }] };
      const exportedJSON = exportConfigJSON(config);

      const parsed = JSON.parse(exportedJSON);
      expect(parsed._export_timestamp).toBeDefined();
      expect(parsed._exported_by).toBe("CmdBar Web Dashboard");
    });

    test("should validate imported JSON configuration strings", () => {
      const validJSON = JSON.stringify({
        categories: [{ name: "Imported", commands: [] }],
      });
      const validRes = importConfigJSON(validJSON);
      expect(validRes.valid).toBe(true);
      expect(validRes.config.categories[0].name).toBe("Imported");

      const invalidJSON = '{"invalid": true}';
      const invalidRes = importConfigJSON(invalidJSON);
      expect(invalidRes.valid).toBe(false);
      expect(invalidRes.error).toContain("categories");

      const corruptJSON = "{corrupt:";
      const corruptRes = importConfigJSON(corruptJSON);
      expect(corruptRes.valid).toBe(false);
      expect(corruptRes.error).toContain("Parse Error");
    });
  });
});
