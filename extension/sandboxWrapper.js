/**
 * Sandbox Wrapper Module for CmdBar.
 * Provides command isolation using bwrap, flatpak-spawn, or firejail.
 */

export const AVAILABLE_ENGINES = ["bwrap", "flatpak-spawn", "firejail"];
export const SECURITY_PROFILES = ["strict", "permissive", "custom"];

/**
 * Determines whether sandboxing is enabled for a given command object.
 * @param {object|boolean} cmdObj
 * @returns {boolean}
 */
export function isSandboxEnabled(cmdObj) {
  if (!cmdObj) return false;
  if (typeof cmdObj === "boolean") return cmdObj;
  if (cmdObj.sandbox === true || cmdObj.sandbox_enabled === true) return true;
  if (typeof cmdObj.sandbox === "object" && cmdObj.sandbox !== null) {
    return cmdObj.sandbox.enabled !== false;
  }
  return false;
}

/**
 * Normalizes and extracts sandbox configuration options from a command object.
 * @param {object|boolean} cmdObj
 * @returns {object}
 */
export function getSandboxConfig(cmdObj) {
  if (!isSandboxEnabled(cmdObj)) {
    return { enabled: false };
  }

  let cfg = {
    enabled: true,
    engine: "bwrap",
    profile: "strict",
    filesystem: "read-only",
    network: false,
  };

  if (typeof cmdObj === "object" && cmdObj !== null) {
    if (typeof cmdObj.sandbox === "object" && cmdObj.sandbox !== null) {
      cfg.enabled = cmdObj.sandbox.enabled !== false;
      cfg.engine = cmdObj.sandbox.engine || cmdObj.sandbox_engine || cfg.engine;
      cfg.profile = cmdObj.sandbox.profile || cmdObj.sandbox_profile || cfg.profile;
      cfg.filesystem =
        cmdObj.sandbox.filesystem ?? cmdObj.sandbox_filesystem ?? cfg.filesystem;
      cfg.network =
        cmdObj.sandbox.network ?? cmdObj.sandbox_network ?? cfg.network;
    } else {
      cfg.engine = cmdObj.sandbox_engine || cfg.engine;
      cfg.profile = cmdObj.sandbox_profile || cfg.profile;
      cfg.filesystem = cmdObj.sandbox_filesystem ?? cfg.filesystem;
      cfg.network = cmdObj.sandbox_network ?? cfg.network;
    }
  }

  if (!AVAILABLE_ENGINES.includes(cfg.engine)) {
    cfg.engine = "bwrap";
  }

  return cfg;
}

/**
 * Wraps an argument array in a sandbox invocation based on configuration options.
 * @param {string[]|string} argv
 * @param {object|boolean} sandboxConfigOrCmd
 * @returns {string[]}
 */
export function wrapCommandInSandbox(argv, sandboxConfigOrCmd) {
  let originalArgv = Array.isArray(argv) ? [...argv] : [String(argv)];
  if (originalArgv.length === 0) return [];

  const config = getSandboxConfig(sandboxConfigOrCmd);
  if (!config.enabled) {
    return originalArgv;
  }

  const engine = config.engine;
  const profile = config.profile || "strict";
  const fsMode = config.filesystem;
  const netAllowed =
    config.network === true ||
    config.network === "allow" ||
    config.network === "host";

  let wrapper = [];

  if (engine === "bwrap") {
    wrapper = ["bwrap"];

    if (profile === "strict") {
      wrapper.push(
        "--ro-bind", "/usr", "/usr",
        "--ro-bind-try", "/lib", "/lib",
        "--ro-bind-try", "/lib64", "/lib64",
        "--ro-bind-try", "/bin", "/bin",
        "--ro-bind-try", "/sbin", "/sbin",
        "--proc", "/proc",
        "--dev", "/dev",
        "--tmpfs", "/tmp"
      );
      if (!netAllowed) {
        wrapper.push("--unshare-net");
      }
      wrapper.push("--unshare-all");
    } else if (profile === "permissive") {
      wrapper.push("--bind", "/", "/");
      if (!netAllowed) {
        wrapper.push("--unshare-net");
      }
    } else {
      // Custom profile
      wrapper.push(
        "--ro-bind", "/usr", "/usr",
        "--ro-bind-try", "/lib", "/lib",
        "--ro-bind-try", "/lib64", "/lib64",
        "--ro-bind-try", "/bin", "/bin",
        "--ro-bind-try", "/sbin", "/sbin",
        "--proc", "/proc",
        "--dev", "/dev"
      );

      if (fsMode === "read-only" || fsMode === "strict") {
        wrapper.push("--ro-bind", "/", "/", "--tmpfs", "/tmp");
      } else if (fsMode === "tmpfs" || fsMode === "isolated") {
        wrapper.push("--tmpfs", "/tmp", "--tmpfs", "/home");
      } else if (fsMode === "full") {
        wrapper.push("--bind", "/", "/");
      } else if (Array.isArray(fsMode)) {
        for (const p of fsMode) {
          wrapper.push("--bind", p, p);
        }
      } else {
        wrapper.push("--tmpfs", "/tmp");
      }

      if (!netAllowed) {
        wrapper.push("--unshare-net");
      }
    }

    wrapper.push("--");
    wrapper.push(...originalArgv);
  } else if (engine === "flatpak-spawn") {
    wrapper = ["flatpak-spawn", "--sandbox"];

    if (!netAllowed) {
      wrapper.push("--no-network");
    }

    if (profile === "strict" || fsMode === "read-only" || fsMode === "strict") {
      wrapper.push("--sandbox-expose-path-ro=/usr");
    } else if (fsMode === "full" || profile === "permissive") {
      wrapper.push("--sandbox-expose-path=/");
    } else if (Array.isArray(fsMode)) {
      for (const p of fsMode) {
        wrapper.push(`--sandbox-expose-path=${p}`);
      }
    }

    wrapper.push("--");
    wrapper.push(...originalArgv);
  } else if (engine === "firejail") {
    wrapper = ["firejail"];

    if (!netAllowed) {
      wrapper.push("--net=none");
    }

    if (profile === "strict") {
      wrapper.push("--seccomp", "--nodbus", "--caps.drop=all");
      if (fsMode === "tmpfs" || fsMode === "isolated") {
        wrapper.push("--private", "--private-tmp");
      } else {
        wrapper.push("--read-only=/");
      }
    } else if (profile === "permissive") {
      wrapper.push("--noprofile");
    } else {
      if (fsMode === "read-only" || fsMode === "strict") {
        wrapper.push("--read-only=/");
      } else if (fsMode === "tmpfs" || fsMode === "isolated") {
        wrapper.push("--private", "--private-tmp");
      }
    }

    wrapper.push("--");
    wrapper.push(...originalArgv);
  }

  return wrapper;
}

export const buildSandboxCommand = wrapCommandInSandbox;
