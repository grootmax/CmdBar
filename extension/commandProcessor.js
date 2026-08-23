/**
 * Core business logic for CmdBar extension command processing and validation.
 */

let GLib;
try {
  if (typeof globalThis.imports !== "undefined" && globalThis.imports.gi) {
    GLib = globalThis.imports.gi.GLib;
  }
} catch (e) {}

if (!GLib) {
  try {
    const giModule = await import("gi");
    GLib = giModule.GLib || (giModule.default && giModule.default.GLib);
  } catch (e) {}
}

/**
 * Checks if the entered text is non-empty and contains non-whitespace characters.
 * @param {string} text
 * @returns {boolean}
 * @public
 */
export function validateInput(text) {
  if (text === null || text === undefined) {
    return false;
  }
  const str = String(text);
  return str.trim().length > 0;
}

/**
 * Checks if a command template has placeholders needing parameter substitution.
 * Placeholders can be of the form <parameter-name> or {{parameter-name}}.
 * @param {string} commandTemplate
 * @returns {boolean}
 */
export function hasPlaceholder(commandTemplate) {
  if (!commandTemplate || typeof commandTemplate !== "string") {
    return false;
  }
  return /<[^>]+>|\{\{[^}]+\}\}|\{[^}]+\}/.test(commandTemplate);
}

/**
 * Substitutes the given input parameter value into the command template placeholders.
 * If multiple placeholders exist, all are replaced by the parameter value.
 * @param {string} commandTemplate
 * @param {string} val
 * @returns {string}
 * @public
 */
export function substituteCommand(commandTemplate, val) {
  if (!commandTemplate || typeof commandTemplate !== "string") {
    return "";
  }
  const cleanVal = val !== undefined && val !== null ? String(val) : "";
  return commandTemplate.replace(
    /\{\{[^}]+\}\}|<[^>]+>|\{[^}]+\}/g,
    () => cleanVal,
  );
}

/**
 * Writes the configuration atomically by first writing to a temporary file
 * and then renaming (or replacing) the target file with the temporary one.
 * Supports both Node.js (with dynamic imports of 'fs') and GJS (with dynamic imports of 'gi').
 *
 * @param {string} targetPath
 * @param {object|string} data
 * @returns {Promise<void>}
 */
export async function writeConfigAtomically(targetPath, data) {
  const contentStr =
    typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const isNode =
    typeof process !== "undefined" && process.versions && process.versions.node;

  if (isNode) {
    const fs = (await import("fs")).default || (await import("fs"));
    const path = (await import("path")).default || (await import("path"));
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const tempPath = targetPath + ".tmp";

    let mode;
    if (fs.existsSync(targetPath)) {
      try {
        mode = fs.statSync(targetPath).mode;
      } catch (e) {}
    }

    try {
      fs.writeFileSync(tempPath, contentStr, "utf8");
      if (mode !== undefined) {
        try {
          fs.chmodSync(tempPath, mode);
        } catch (e) {}
      }
      fs.renameSync(tempPath, targetPath);
    } catch (error) {
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch (cleanupError) {}
      throw error;
    }
  } else {
    // GJS (GNOME Shell) environment
    const giModule = await import("gi");
    const Gio = giModule.Gio || (giModule.default && giModule.default.Gio) || giModule.default;
    const GLib = giModule.GLib || (giModule.default && giModule.default.GLib);
    const file = Gio.File.new_for_path(targetPath);
    const tmpPath = targetPath + ".tmp";
    const tmpFile = Gio.File.new_for_path(tmpPath);
    const bytes = new GLib.Bytes(contentStr);
    try {
      tmpFile.replace_contents(
        bytes,
        null,
        false,
        Gio.FileCreateFlags.NONE,
        null,
      );
      tmpFile.move(file, Gio.FileCopyFlags.OVERWRITE, null, null);
    } catch (error) {
      try {
        if (tmpFile.query_exists(null)) {
          tmpFile.delete(null);
        }
      } catch (cleanupError) {}
      throw error;
    }
  }
}

/**
 * Parses environment variables from stdout.
 * @param {string} stdout
 * @returns {string[]}
 */
export function parseEnv(stdout) {
  if (!stdout || typeof stdout !== "string") {
    return [];
  }
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("="));
}

/**
 * Parses a command template string into an array of tokenized argument strings,
 * handling single/double quotes and backslash escapes properly.
 * @param {string} commandTemplate
 * @returns {string[]}
 * @public
 */
export function tokenizeCommand(commandTemplate) {
  if (!commandTemplate || typeof commandTemplate !== "string") {
    return [];
  }
  const args = [];
  let current = "";
  let inDoubleQuotes = false;
  let inSingleQuotes = false;
  let escaped = false;

  for (let i = 0; i < commandTemplate.length; i++) {
    const char = commandTemplate[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && !inSingleQuotes) {
      escaped = true;
      continue;
    }

    if (char === '"' && !inSingleQuotes) {
      inDoubleQuotes = !inDoubleQuotes;
      continue;
    }

    if (char === "'" && !inDoubleQuotes) {
      inSingleQuotes = !inSingleQuotes;
      continue;
    }

    if (char === " " || char === "\t" || char === "\r" || char === "\n") {
      if (inDoubleQuotes || inSingleQuotes) {
        current += char;
      } else if (current.length > 0) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

/**
 * Extracts all placeholders (e.g., <parameter-name> or {{parameter-name}})
 * from the command template.
 * @param {string} commandTemplate
 * @returns {string[]}
 */
export function getPlaceholders(commandTemplate) {
  if (!commandTemplate || typeof commandTemplate !== "string") {
    return [];
  }
  const regex = /\{\{[^}]+\}\}|<[^>]+>|\{[^}]+\}/g;
  const matches = [];
  let match;
  while ((match = regex.exec(commandTemplate)) !== null) {
    if (!matches.includes(match[0])) {
      matches.push(match[0]);
    }
  }
  return matches;
}

export const DEFAULT_ALLOWED_PREFIXES = [
  "/usr/bin/",
  "/bin/",
  "/usr/local/bin/",
  "/usr/sbin/",
  "/sbin/",
];

export const DEFAULT_ALLOWED_BINARIES = [
  "make",
  "echo",
  "deploy",
  "aws",
  "ping",
  "git",
  "docker",
  "zenity",
  "python",
  "python3",
  "node",
  "npm",
  "notify-send",
  "pkill",
  "env",
  "sh",
  "bash",
];

/**
 * Checks whether a given binary path or executable name is in the approved allowlist.
 * @param {string} binaryPath
 * @param {string[]} [customAllowlist]
 * @returns {boolean}
 */
export function isBinaryAllowlisted(binaryPath, customAllowlist = []) {
  if (!binaryPath || typeof binaryPath !== "string") {
    return false;
  }
  const cleanPath = binaryPath.trim();
  if (!cleanPath) {
    return false;
  }

  if (Array.isArray(customAllowlist) && customAllowlist.length > 0) {
    if (customAllowlist.includes(cleanPath)) {
      return true;
    }
    for (const item of customAllowlist) {
      if (
        typeof item === "string" &&
        item.endsWith("/") &&
        cleanPath.startsWith(item)
      ) {
        return true;
      }
    }
  }

  if (cleanPath.startsWith("/")) {
    for (const prefix of DEFAULT_ALLOWED_PREFIXES) {
      if (cleanPath.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }

  if (DEFAULT_ALLOWED_BINARIES.includes(cleanPath)) {
    return true;
  }

  return false;
}

/**
 * Substitutes mapping values into a tokenized argument list.
 * @param {string[]} tokens
 * @param {Object.<string, string>} placeholderMap
 * @returns {string[]}
 */
export function substituteTokens(tokens, placeholderMap) {
  if (!tokens || !Array.isArray(tokens)) {
    return [];
  }
  if (!placeholderMap || typeof placeholderMap !== "object") {
    return [...tokens];
  }
  const expandedMap = {};
  for (const [key, val] of Object.entries(placeholderMap)) {
    if (key.startsWith("<") || key.startsWith("{")) {
      expandedMap[key] = val;
    } else {
      expandedMap[`<${key}>`] = val;
      expandedMap[`{{${key}}}`] = val;
      expandedMap[`{${key}}`] = val;
    }
  }
  const entries = Object.entries(expandedMap).sort(
    (a, b) => b[0].length - a[0].length,
  );
  return tokens.map((token) => {
    let substituted = token;
    for (const [placeholder, val] of entries) {
      const cleanVal = val !== undefined && val !== null ? String(val) : "";
      const escapedPlaceholder = placeholder.replace(
        /[-\/\\^$*+?.()|[\]{}]/g,
        "\\$&",
      );
      const regex = new RegExp(escapedPlaceholder, "g");
      substituted = substituted.replace(regex, () => cleanVal);
    }
    return substituted;
  });
}

/**
 * Returns preview token array with sensitive parameter values redacted.
 * @param {string[]} argv
 * @param {Object.<string, string>} [placeholderMap]
 * @param {Array<Object>|Object} [parametersSchema]
 * @returns {string[]}
 */
export function getPreviewTokens(argv, placeholderMap, parametersSchema) {
  if (!argv || !Array.isArray(argv)) {
    return [];
  }
  const secureKeys = new Set();
  if (Array.isArray(parametersSchema)) {
    for (const p of parametersSchema) {
      if (p && p.secure) {
        secureKeys.add(p.name);
      }
    }
  } else if (parametersSchema && typeof parametersSchema === "object") {
    for (const [ph, p] of Object.entries(parametersSchema)) {
      if (p && p.secure) {
        secureKeys.add(ph);
      }
    }
  }

  return argv.map((arg) => {
    let previewArg = arg;
    if (placeholderMap && typeof placeholderMap === "object") {
      for (const [key, val] of Object.entries(placeholderMap)) {
        if (val !== undefined && val !== null) {
          const cleanVal = String(val);
          const cleanKey = key.replace(/<|>/g, "");
          const isSecure =
            secureKeys.has(cleanKey) ||
            cleanKey.toLowerCase().includes("password") ||
            cleanKey.toLowerCase().includes("secret") ||
            cleanKey.toLowerCase().includes("token");

          if (isSecure) {
            if (cleanVal.length > 0) {
              const escapedVal = cleanVal.replace(
                /[-\/\\^$*+?.()|[\]{}]/g,
                "\\$&",
              );
              previewArg = previewArg.replace(
                new RegExp(escapedVal, "g"),
                "[REDACTED]",
              );
            }
          }
        }
      }
    }
    return previewArg;
  });
}

/**
 * Format GSettings accelerator string into human-readable shortcut hint.
 * @param {string|string[]} accel
 * @returns {string}
 */
export function formatShortcutHint(accel) {
  let str = Array.isArray(accel) ? (accel[0] || "") : (accel || "");
  if (!str) return "Super+Space";

  let parts = [];
  if (/<Control>/i.test(str) || /<Ctrl>/i.test(str)) parts.push("Ctrl");
  if (/<Alt>/i.test(str)) parts.push("Alt");
  if (/<Super>/i.test(str) || /<Meta>/i.test(str)) parts.push("Super");
  if (/<Shift>/i.test(str)) parts.push("Shift");

  let baseKey = str.replace(/<[^>]+>/g, "").trim();
  if (baseKey) {
    if (baseKey.toLowerCase() === "space") {
      baseKey = "Space";
    } else if (baseKey.length === 1) {
      baseKey = baseKey.toUpperCase();
    } else {
      baseKey = baseKey.charAt(0).toUpperCase() + baseKey.slice(1);
    }
    parts.push(baseKey);
  }

  return parts.join("+") || "Super+Space";
}

/**
 * Parse user-entered keybinding string or shortcut into GSettings accelerator array.
 * Handles modifier keys (Ctrl, Alt, Super, Shift).
 * @param {string} text
 * @returns {string[]}
 */
export function parseAccel(text) {
  if (!text || !text.trim()) return ["<Super>space"];

  let input = text.trim();
  if (input.startsWith("<") && input.includes(">")) {
    return [input];
  }

  let parts = input.split("+").map((p) => p.trim());
  let modifiers = "";
  let baseKey = "";

  for (let part of parts) {
    let lower = part.toLowerCase();
    if (lower === "super" || lower === "meta") {
      modifiers += "<Super>";
    } else if (lower === "alt") {
      modifiers += "<Alt>";
    } else if (lower === "ctrl" || lower === "control") {
      modifiers += "<Control>";
    } else if (lower === "shift") {
      modifiers += "<Shift>";
    } else {
      baseKey = lower;
    }
  }

  if (!baseKey) baseKey = "space";
  if (!modifiers) modifiers = "<Super>";

  return [`${modifiers}${baseKey}`];
}

/**
 * Escapes special XML/Pango markup characters.
 * @param {string} str
 * @returns {string}
 */
export function escapeMarkup(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Checks if pattern fuzzy-matches text and calculates relevance score.
 * @param {string} pattern Search query
 * @param {string} text Text to match against
 * @param {number} [usageCount=0] Frequency of command usage
 * @returns {{ match: boolean, score: number, matches: number[] }}
 */
export function fuzzyMatch(pattern, text, usageCount = 0) {
  if (text === null || text === undefined) {
    return { match: false, score: 0, matches: [] };
  }
  const textStr = String(text);

  if (!pattern || typeof pattern !== "string" || pattern.trim() === "") {
    return {
      match: true,
      score: (usageCount || 0) * 10,
      matches: [],
    };
  }

  const cleanPattern = pattern.trim();
  const patternLower = cleanPattern.toLowerCase();
  const textLower = textStr.toLowerCase();

  let matchedIndices = [];

  // 1. Check if text includes cleanPattern as a contiguous substring
  const subIdx = textLower.indexOf(patternLower);
  if (subIdx !== -1) {
    for (let i = 0; i < patternLower.length; i++) {
      matchedIndices.push(subIdx + i);
    }
  } else {
    // 2. Perform sequential subsequence fuzzy match
    let patternIdx = 0;
    for (let i = 0; i < textLower.length && patternIdx < patternLower.length; i++) {
      if (textLower[i] === patternLower[patternIdx]) {
        matchedIndices.push(i);
        patternIdx++;
      }
    }
    if (patternIdx < patternLower.length) {
      return { match: false, score: 0, matches: [] };
    }
  }

  // Calculate relevance score
  let score = 100;

  if (textLower === patternLower) {
    score += 1000;
  } else if (textLower.startsWith(patternLower)) {
    score += 500;
  } else if (subIdx !== -1) {
    score += 300;
  }

  // Word boundary bonus
  for (const idx of matchedIndices) {
    if (idx === 0) {
      score += 50;
    } else {
      const prevChar = textStr[idx - 1];
      if (/[\s\-_.\/:;=,]/.test(prevChar)) {
        score += 50;
      } else if (
        /[a-z]/.test(textStr[idx - 1]) &&
        /[A-Z]/.test(textStr[idx])
      ) {
        score += 50;
      }
    }
  }

  // Consecutive bonus
  for (let i = 1; i < matchedIndices.length; i++) {
    if (matchedIndices[i] === matchedIndices[i - 1] + 1) {
      score += 20;
    }
  }

  // Compactness bonus
  const span =
    matchedIndices[matchedIndices.length - 1] - matchedIndices[0] + 1;
  score += Math.max(0, 100 - (span - patternLower.length) * 10);

  // Early match bonus
  score += Math.max(0, 50 - matchedIndices[0] * 5);

  // Usage frequency bonus
  score += (usageCount || 0) * 10;

  return {
    match: true,
    score,
    matches: matchedIndices,
  };
}

/**
 * Highlights matched character indices in text using HTML/Pango markup tags.
 * @param {string} text
 * @param {number[]} matchedIndices
 * @param {string} [openTag="<b>"]
 * @param {string} [closeTag="</b>"]
 * @returns {string}
 */
export function highlightMatches(
  text,
  matchedIndices,
  openTag = "<b>",
  closeTag = "</b>"
) {
  if (text === null || text === undefined) {
    return "";
  }
  const str = String(text);
  if (!matchedIndices || !Array.isArray(matchedIndices) || matchedIndices.length === 0) {
    return escapeMarkup(str);
  }

  const indexSet = new Set(matchedIndices);
  let result = "";
  let inHighlight = false;

  for (let i = 0; i < str.length; i++) {
    const isMatched = indexSet.has(i);
    if (isMatched && !inHighlight) {
      result += openTag;
      inHighlight = true;
    } else if (!isMatched && inHighlight) {
      result += closeTag;
      inHighlight = false;
    }
    result += escapeMarkup(str[i]);
  }

  if (inHighlight) {
    result += closeTag;
  }

  return result;
}

/**
 * Ranks and filters commands based on search pattern and usage frequency.
 * @param {Array<object>} commands List of command objects ({ name, command, ... })
 * @param {string} pattern Search query
 * @param {Object.<string, number>} [usageMap={}]
 * @returns {Array<{ command: object, score: number, matchName: object, matchCmd: object }>}
 */
export function rankCommands(commands, pattern, usageMap = {}) {
  if (!commands || !Array.isArray(commands)) {
    return [];
  }

  const cleanPattern = (pattern || "").trim();
  const results = [];

  for (const cmd of commands) {
    const cmdName = cmd.name || "";
    const cmdCommand =
      typeof cmd.command === "string"
        ? cmd.command
        : Array.isArray(cmd.command)
        ? cmd.command.join(" ")
        : String(cmd.command || "");
    const cmdKey = cmdCommand || cmdName;
    const usageCount = usageMap[cmdKey] || 0;

    const matchName = fuzzyMatch(cleanPattern, cmdName, usageCount);
    const matchCmd = fuzzyMatch(cleanPattern, cmdCommand, usageCount);

    if (matchName.match || matchCmd.match) {
      const score = Math.max(
        matchName.match ? matchName.score : 0,
        matchCmd.match ? matchCmd.score : 0
      );
      results.push({
        command: cmd,
        score,
        matchName,
        matchCmd,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

const isNode =
  typeof process !== "undefined" && process.versions && process.versions.node;

let nodeFs = null;
let nodeCp = null;
let nodePath = null;

if (isNode) {
  try {
    nodeFs = (await import("fs")).default || (await import("fs"));
    nodeCp = (await import("child_process")).default || (await import("child_process"));
    nodePath = (await import("path")).default || (await import("path"));
  } catch (e) {}
}

/**
 * Detects if a directory is a Git repository by checking for .git file/directory or git status.
 * @param {string} [dirPath]
 * @returns {boolean}
 */
export function detectGitRepo(dirPath) {
  const targetDir = dirPath || (isNode ? process.cwd() : ".");

  if (isNode) {
    if (nodeFs) {
      try {
        const gitPath = nodePath ? nodePath.join(targetDir, ".git") : `${targetDir}/.git`;
        if (nodeFs.existsSync(gitPath)) {
          return true;
        }
      } catch (e) {}
    }

    if (nodeCp && nodeCp.execSync) {
      try {
        const out = nodeCp.execSync("git rev-parse --is-inside-work-tree", {
          cwd: targetDir,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        return out.trim() === "true";
      } catch (e) {}
    }
    return false;
  } else {
    try {
      if (typeof GLib !== "undefined" && GLib.build_filenamev) {
        const gitPath = GLib.build_filenamev([targetDir, ".git"]);
        if (GLib.file_test(gitPath, GLib.FileTest.EXISTS)) {
          return true;
        }
      }
    } catch (e) {}
    return false;
  }
}

/**
 * Synchronously fetches current Git state (branch, status, last commit).
 * @param {string} [dirPath]
 * @returns {{ isGitRepo: boolean, branch: string, status: string, lastCommit: string, repoPath: string }}
 */
export function getGitStateSync(dirPath) {
  const targetDir = dirPath || (isNode ? process.cwd() : ".");
  const isRepo = detectGitRepo(targetDir);

  if (!isRepo) {
    return {
      isGitRepo: false,
      branch: "",
      status: "N/A",
      lastCommit: "",
      repoPath: targetDir,
    };
  }

  let branch = "main";
  let status = "clean";
  let lastCommit = "";

  if (isNode && nodeCp && nodeCp.execSync) {
    try {
      branch =
        nodeCp.execSync("git branch --show-current", { cwd: targetDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() ||
        nodeCp.execSync("git rev-parse --abbrev-ref HEAD", { cwd: targetDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch (e) {}

    try {
      const st = nodeCp.execSync("git status --short", { cwd: targetDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      status = st ? `dirty (${st.split("\n").length} modified)` : "clean";
    } catch (e) {}

    try {
      lastCommit = nodeCp.execSync('git log -1 --format="%h %s"', { cwd: targetDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch (e) {}
  }

  return {
    isGitRepo: true,
    branch: branch || "main",
    status: status || "clean",
    lastCommit: lastCommit || "",
    repoPath: targetDir,
  };
}

/**
 * Asynchronously fetches current Git state (branch, status, last commit).
 * @param {string} [dirPath]
 * @returns {Promise<{ isGitRepo: boolean, branch: string, status: string, lastCommit: string, repoPath: string }>}
 */
export async function getGitStateAsync(dirPath) {
  const targetDir = dirPath || (isNode ? process.cwd() : ".");
  return getGitStateSync(targetDir);
}

/**
 * Substitutes Git placeholders {git-branch}, {git-status}, {git-last-commit} in a command template.
 * @param {string} commandTemplate
 * @param {object} gitState
 * @returns {string}
 */
export function substituteGitPlaceholders(commandTemplate, gitState) {
  if (!commandTemplate || typeof commandTemplate !== "string") {
    return "";
  }
  if (!gitState || typeof gitState !== "object") {
    return commandTemplate;
  }

  const branch = gitState.branch || "";
  const status = gitState.status || "";
  const lastCommit = gitState.lastCommit || "";

  return commandTemplate
    .replace(/\{\{git-branch\}\}|<git-branch>|\{git-branch\}/gi, branch)
    .replace(/\{\{git-status\}\}|<git-status>|\{git-status\}/gi, status)
    .replace(/\{\{git-last-commit\}\}|<git-last-commit>|\{git-last-commit\}/gi, lastCommit);
}

/**
 * Checks if a command template contains placeholders other than Git placeholders.
 * @param {string} commandTemplate
 * @returns {boolean}
 */
export function hasNonGitPlaceholders(commandTemplate) {
  if (!commandTemplate || typeof commandTemplate !== "string") {
    return false;
  }
  const stripped = commandTemplate
    .replace(/\{\{git-branch\}\}|<git-branch>|\{git-branch\}/gi, "")
    .replace(/\{\{git-status\}\}|<git-status>|\{git-status\}/gi, "")
    .replace(/\{\{git-last-commit\}\}|<git-last-commit>|\{git-last-commit\}/gi, "");

  return hasPlaceholder(stripped);
}

