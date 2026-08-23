import {
  isSandboxEnabled,
  getSandboxConfig,
  wrapCommandInSandbox,
  AVAILABLE_ENGINES,
  SECURITY_PROFILES,
} from "../extension/sandboxWrapper.js";

describe("Sandboxed Execution Mode - JS Wrapper Tests", () => {
  describe("Sandbox Configuration Parsing", () => {
    test("detects sandbox enabled status across config formats", () => {
      expect(isSandboxEnabled(null)).toBe(false);
      expect(isSandboxEnabled({})).toBe(false);
      expect(isSandboxEnabled({ sandbox: false })).toBe(false);
      expect(isSandboxEnabled({ sandbox: true })).toBe(true);
      expect(isSandboxEnabled({ sandbox_enabled: true })).toBe(true);
      expect(isSandboxEnabled({ sandbox: { enabled: true } })).toBe(true);
      expect(isSandboxEnabled({ sandbox: { enabled: false } })).toBe(false);
    });

    test("normalizes sandbox config with default values", () => {
      const cfg = getSandboxConfig({ sandbox: true });
      expect(cfg.enabled).toBe(true);
      expect(cfg.engine).toBe("bwrap");
      expect(cfg.profile).toBe("strict");
      expect(cfg.filesystem).toBe("read-only");
      expect(cfg.network).toBe(false);
    });

    test("preserves custom engine, profile, filesystem, and network settings", () => {
      const cmdObj = {
        sandbox: {
          enabled: true,
          engine: "firejail",
          profile: "custom",
          filesystem: "tmpfs",
          network: true,
        },
      };
      const cfg = getSandboxConfig(cmdObj);
      expect(cfg.engine).toBe("firejail");
      expect(cfg.profile).toBe("custom");
      expect(cfg.filesystem).toBe("tmpfs");
      expect(cfg.network).toBe(true);
    });
  });

  describe("Bubblewrap (bwrap) Command Wrapping", () => {
    test("wraps command using bwrap in strict profile with network unshare", () => {
      const argv = ["ping", "-c", "3", "8.8.8.8"];
      const cmdObj = {
        sandbox: {
          enabled: true,
          engine: "bwrap",
          profile: "strict",
          network: false,
        },
      };
      const wrapped = wrapCommandInSandbox(argv, cmdObj);

      expect(wrapped[0]).toBe("bwrap");
      expect(wrapped).toContain("--unshare-net");
      expect(wrapped).toContain("--unshare-all");
      expect(wrapped).toContain("--ro-bind");
      expect(wrapped.slice(-4)).toEqual(["ping", "-c", "3", "8.8.8.8"]);
    });

    test("bwrap profile permissive includes bind / and allows network", () => {
      const argv = ["curl", "https://example.com"];
      const cmdObj = {
        sandbox: {
          enabled: true,
          engine: "bwrap",
          profile: "permissive",
          network: true,
        },
      };
      const wrapped = wrapCommandInSandbox(argv, cmdObj);

      expect(wrapped[0]).toBe("bwrap");
      expect(wrapped).toContain("--bind");
      expect(wrapped).not.toContain("--unshare-net");
      expect(wrapped.slice(-2)).toEqual(["curl", "https://example.com"]);
    });
  });

  describe("Flatpak Spawn Command Wrapping", () => {
    test("wraps command using flatpak-spawn with sandbox and no-network flags", () => {
      const argv = ["python3", "script.py"];
      const cmdObj = {
        sandbox: {
          enabled: true,
          engine: "flatpak-spawn",
          profile: "strict",
          network: false,
        },
      };
      const wrapped = wrapCommandInSandbox(argv, cmdObj);

      expect(wrapped[0]).toBe("flatpak-spawn");
      expect(wrapped).toContain("--sandbox");
      expect(wrapped).toContain("--no-network");
      expect(wrapped.slice(-2)).toEqual(["python3", "script.py"]);
    });
  });

  describe("Firejail Command Wrapping", () => {
    test("wraps command using firejail with net=none and security profile flags", () => {
      const argv = ["make", "build"];
      const cmdObj = {
        sandbox: {
          enabled: true,
          engine: "firejail",
          profile: "strict",
          network: false,
        },
      };
      const wrapped = wrapCommandInSandbox(argv, cmdObj);

      expect(wrapped[0]).toBe("firejail");
      expect(wrapped).toContain("--net=none");
      expect(wrapped).toContain("--seccomp");
      expect(wrapped).toContain("--nodbus");
      expect(wrapped.slice(-2)).toEqual(["make", "build"]);
    });
  });

  describe("Backward Compatibility", () => {
    test("returns original argument list untouched if sandboxing is disabled", () => {
      const argv = ["git", "status"];
      expect(wrapCommandInSandbox(argv, null)).toEqual(["git", "status"]);
      expect(wrapCommandInSandbox(argv, { sandbox: false })).toEqual(["git", "status"]);
      expect(wrapCommandInSandbox(argv, { sandbox: { enabled: false } })).toEqual(["git", "status"]);
    });
  });
});
