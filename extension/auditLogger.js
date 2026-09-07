/**
 * Command Audit Logger for CmdBar.
 * Works in both GJS (GNOME Shell Extension) and Node.js (Testing/Companion).
 */

const isNode =
  typeof process !== "undefined" && process.versions && process.versions.node;

let Gio, GLib;
let nodeFs = null;
let nodePath = null;

if (isNode) {
  try {
    nodeFs = (await import("fs")).default || (await import("fs"));
    nodePath = (await import("path")).default || (await import("path"));
  } catch (e) {}
} else {
  try {
    const giModule = await import("gi");
    Gio = giModule.Gio || (giModule.default && giModule.default.Gio) || giModule.default;
    GLib = giModule.GLib || (giModule.default && giModule.default.GLib);
  } catch (e) {
    console.error("CmdBar AuditLogger: Failed to import gi inside non-Node environment:", e);
  }
}

export const DEFAULT_SENSITIVE_KEYWORDS = [
  "password",
  "passwd",
  "secret",
  "token",
  "api_key",
  "apikey",
  "key",
  "credentials",
  "cred",
  "sudo",
  "auth",
  "bearer",
  "private_key",
];

export function getAuditLogPath() {
  if (isNode && process.env.CMDBAR_AUDIT_LOG_PATH) {
    return process.env.CMDBAR_AUDIT_LOG_PATH;
  }
  if (!isNode && typeof GLib !== "undefined" && GLib.getenv) {
    const override = GLib.getenv("CMDBAR_AUDIT_LOG_PATH");
    if (override) return override;
    const xdgDataHome = GLib.getenv("XDG_DATA_HOME");
    if (xdgDataHome) {
      return `${xdgDataHome}/cmdbar/audit.log`;
    }
    const home = GLib.getenv("HOME") || "/tmp";
    return `${home}/.local/share/cmdbar/audit.log`;
  }
  if (isNode) {
    const home = process.env.HOME || "/tmp";
    return `${home}/.local/share/cmdbar/audit.log`;
  }
  return "/tmp/cmdbar-audit.log";
}

export function getCurrentUser() {
  if (isNode) {
    return (
      process.env.USER ||
      process.env.LOGNAME ||
      process.env.USERNAME ||
      "unknown"
    );
  }
  if (typeof GLib !== "undefined" && GLib.get_user_name) {
    return GLib.get_user_name() || "unknown";
  }
  return "unknown";
}

export function isSensitiveCommand(
  commandStr,
  cmdObj = {},
  placeholderMap = {},
  config = {},
) {
  if (!commandStr && !cmdObj) return false;

  const raw = String(commandStr || "").toLowerCase();

  for (const kw of DEFAULT_SENSITIVE_KEYWORDS) {
    if (raw.includes(kw)) {
      return true;
    }
  }

  if (cmdObj) {
    if (cmdObj.secure === true || cmdObj.sensitive === true) {
      return true;
    }
    if (Array.isArray(cmdObj.parameters)) {
      for (const p of cmdObj.parameters) {
        if (p && (p.secure === true || p.type === "password" || p.type === "secret")) {
          return true;
        }
      }
    } else if (cmdObj.parameters && typeof cmdObj.parameters === "object") {
      for (const p of Object.values(cmdObj.parameters)) {
        if (p && (p.secure === true || p.type === "password" || p.type === "secret")) {
          return true;
        }
      }
    }
  }

  if (placeholderMap && typeof placeholderMap === "object") {
    for (const [k, v] of Object.entries(placeholderMap)) {
      const lowerKey = String(k).toLowerCase();
      for (const kw of DEFAULT_SENSITIVE_KEYWORDS) {
        if (lowerKey.includes(kw)) {
          return true;
        }
      }
    }
  }

  return false;
}

export async function rotateLogIfNeeded(logPath) {
  const targetPath = logPath || getAuditLogPath();
  const todayStr = new Date().toISOString().split("T")[0];

  if (isNode) {
    const fs = nodeFs || (await import("fs")).default || (await import("fs"));
    if (!fs.existsSync(targetPath)) return;

    try {
      const stats = await fs.promises.stat(targetPath);
      const fileDateStr = new Date(stats.mtimeMs).toISOString().split("T")[0];
      if (fileDateStr !== todayStr) {
        const rotatedPath = `${targetPath}.${fileDateStr}`;
        await fs.promises.rename(targetPath, rotatedPath);
      }
    } catch (e) {
      console.error("CmdBar AuditLogger: Node log rotation failed:", e.message);
    }
  } else {
    try {
      const file = Gio.File.new_for_path(targetPath);
      if (!file.query_exists(null)) return;

      const info = file.query_info(
        "time::modified",
        Gio.FileQueryInfoFlags.NONE,
        null
      );
      const mtime = info.get_modification_date_time();
      if (mtime) {
        const fileDateStr = mtime.format("%Y-%m-%d");
        if (fileDateStr !== todayStr) {
          const rotatedPath = `${targetPath}.${fileDateStr}`;
          const destFile = Gio.File.new_for_path(rotatedPath);
          file.move(destFile, Gio.FileCopyFlags.OVERWRITE, null, null);
        }
      }
    } catch (e) {
      console.error("CmdBar AuditLogger: GJS log rotation failed:", e.message);
    }
  }
}

export async function logCommand({
  command,
  exitCode = 0,
  durationMs = 0,
  user,
  cmdObj = {},
  placeholderMap = {},
  config = {},
}) {
  const auditCfg = (config && config.audit) || {};
  if (auditCfg.enabled === false) {
    return false;
  }

  const privacyMode = auditCfg.privacy_mode === true;
  const sensitive = isSensitiveCommand(command, cmdObj, placeholderMap, config);

  if (privacyMode && sensitive) {
    return false;
  }

  const logPath = getAuditLogPath();
  await rotateLogIfNeeded(logPath);

  const entry = {
    timestamp: new Date().toISOString(),
    user: user || getCurrentUser(),
    command: command || "",
    exit_code: typeof exitCode === "number" ? exitCode : String(exitCode),
    duration_ms: Math.round(Number(durationMs) || 0),
    duration: `${Math.round(Number(durationMs) || 0)}ms`,
  };

  const line = JSON.stringify(entry) + "\n";

  if (isNode) {
    const fs = nodeFs || (await import("fs")).default || (await import("fs"));
    const pathModule = nodePath || (await import("path")).default || (await import("path"));
    const dir = pathModule.dirname(logPath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.appendFile(logPath, line, "utf8");
  } else {
    try {
      const lastSlash = logPath.lastIndexOf("/");
      if (lastSlash !== -1) {
        const dirPath = logPath.slice(0, lastSlash);
        const dirFile = Gio.File.new_for_path(dirPath);
        if (!dirFile.query_exists(null)) {
          dirFile.make_directory_with_parents(null);
        }
      }
      const file = Gio.File.new_for_path(logPath);
      let stream;
      if (file.query_exists(null)) {
        stream = file.append_to(Gio.FileCreateFlags.NONE, null);
      } else {
        stream = file.create(Gio.FileCreateFlags.NONE, null);
      }
      const encoder = new TextEncoder();
      const bytes = encoder.encode(line);
      stream.write_all(bytes, null);
      stream.close(null);
    } catch (e) {
      console.error("CmdBar AuditLogger: GJS write log failed:", e.message);
    }
  }

  return true;
}

export async function readAuditLogs(customPath) {
  const logPath = customPath || getAuditLogPath();
  const entries = [];

  if (isNode) {
    const fs = nodeFs || (await import("fs")).default || (await import("fs"));
    if (!fs.existsSync(logPath)) return [];
    const content = await fs.promises.readFile(logPath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch (e) {
        entries.push({ raw: line });
      }
    }
  } else {
    try {
      const file = Gio.File.new_for_path(logPath);
      if (!file.query_exists(null)) return [];
      const [success, contents] = file.load_contents(null);
      if (success) {
        const decoder = new TextDecoder("utf-8");
        const content = decoder.decode(contents);
        const lines = content.split("\n").filter((l) => l.trim().length > 0);
        for (const line of lines) {
          try {
            entries.push(JSON.parse(line));
          } catch (e) {
            entries.push({ raw: line });
          }
        }
      }
    } catch (e) {
      console.error("CmdBar AuditLogger: GJS read log failed:", e.message);
    }
  }

  return entries;
}

export async function clearAuditLog(customPath) {
  const logPath = customPath || getAuditLogPath();
  if (isNode) {
    const fs = nodeFs || (await import("fs")).default || (await import("fs"));
    if (fs.existsSync(logPath)) {
      await fs.promises.unlink(logPath);
    }
  } else {
    try {
      const file = Gio.File.new_for_path(logPath);
      if (file.query_exists(null)) {
        file.delete(null);
      }
    } catch (e) {}
  }
}
