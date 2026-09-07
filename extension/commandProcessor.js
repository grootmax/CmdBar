/**
 * Core business logic for CmdBar extension command processing and validation.
 */

export { ChainRunner, ChainStatus, StepStatus } from "./chainRunner.js";

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
    const Gio =
      giModule.Gio ||
      (giModule.default && giModule.default.Gio) ||
      giModule.default;
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
  "bwrap",
  "flatpak-spawn",
  "firejail",
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
  let str = Array.isArray(accel) ? accel[0] || "" : accel || "";
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
    .replace(/\"/g, "&quot;")
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
    const usageCount = (usageMap && (usageMap[cmdCommand] || usageMap[cmdName] || usageMap[cmdKey])) || 0;

    const matchName = fuzzyMatch(cleanPattern, cmdName, usageCount);
    const matchCmd = fuzzyMatch(cleanPattern, cmdCommand, usageCount);

    if (matchName.match || matchCmd.match) {
      const score = Math.max(
        matchName.match ? matchName.score : 0,
        matchCmd.match ? matchCmd.score : 0
      );
      const bestMatch = matchName.score >= matchCmd.score ? matchName : matchCmd;
      results.push({
        command: cmd,
        score,
        matchName,
        matchCmd,
        matchResult: bestMatch,
        matches: bestMatch.matches,
        highlightedName: highlightMatches(cmdName, matchName.matches),
        highlightedCommand: highlightMatches(cmdCommand, matchCmd.matches),
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Converts a shell glob pattern into a JavaScript RegExp.
 * @param {string} glob
 * @returns {RegExp}
 * @private
 */
function globToRegExp(glob) {
  let regStr = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      regStr += ".*";
    } else if (c === "?") {
      regStr += ".";
    } else if ("[].+^$(){}|\\".includes(c)) {
      regStr += "\\" + c;
    } else {
      regStr += c;
    }
  }
  regStr += "$";
  return new RegExp(regStr, "i");
}

/**
 * Evaluates whether a command matches a given pattern using the specified matching strategy.
 * Supported types: 'exact', 'substring', 'glob', 'regex', 'binary'.
 * @param {string} command
 * @param {string|RegExp} pattern
 * @param {string} [type]
 * @returns {boolean}
 * @public
 */
export function matchPattern(command, pattern, type) {
  if (!command || typeof command !== "string") return false;
  if (!pattern) return false;

  const cmdStr = command.trim();
  const patStr = typeof pattern === "string" ? pattern.trim() : String(pattern);

  let matchType = type;
  if (!matchType) {
    if (typeof pattern === "object" && pattern instanceof RegExp) {
      matchType = "regex";
    } else if (patStr.includes("*") || patStr.includes("?")) {
      matchType = "glob";
    } else if (patStr.startsWith("^") || patStr.endsWith("$")) {
      matchType = "regex";
    } else {
      matchType = "substring";
    }
  }

  if (matchType === "exact") {
    return cmdStr === patStr || cmdStr.toLowerCase() === patStr.toLowerCase();
  }

  if (matchType === "substring") {
    return cmdStr.toLowerCase().includes(patStr.toLowerCase());
  }

  if (matchType === "glob") {
    try {
      const re = globToRegExp(patStr);
      return re.test(cmdStr);
    } catch (e) {
      return cmdStr.toLowerCase().includes(patStr.toLowerCase());
    }
  }

  if (matchType === "regex") {
    try {
      const re = pattern instanceof RegExp ? pattern : new RegExp(patStr, "i");
      return re.test(cmdStr);
    } catch (e) {
      return false;
    }
  }

  if (matchType === "binary") {
    const tokens = tokenizeCommand(cmdStr);
    if (tokens.length === 0) return false;
    const binary = tokens[0];
    return (
      binary === patStr ||
      binary.endsWith("/" + patStr) ||
      patStr.endsWith("/" + binary) ||
      binary.toLowerCase().includes(patStr.toLowerCase())
    );
  }

  return false;
}

/**
 * Checks whether user or group context satisfies user/group restrictions on a policy rule.
 * @param {object} [userContext]
 * @param {string[]} [ruleUsers]
 * @param {string[]} [ruleGroups]
 * @returns {boolean}
 * @public
 */
export function isUserInContext(userContext, ruleUsers, ruleGroups) {
  let username = userContext && userContext.username;
  let userGroups = (userContext && userContext.groups) || [];

  if (!username) {
    if (typeof process !== "undefined" && process.env) {
      username = process.env.USER || process.env.USERNAME || "unknown";
    } else if (typeof GLib !== "undefined" && GLib.get_user_name) {
      username = GLib.get_user_name();
    } else {
      username = "unknown";
    }
  }

  if (Array.isArray(ruleUsers) && ruleUsers.length > 0) {
    const matchesUser = ruleUsers.some(
      (u) => u === "*" || u.toLowerCase() === username.toLowerCase()
    );
    if (!matchesUser) return false;
  }

  if (Array.isArray(ruleGroups) && ruleGroups.length > 0) {
    const matchesGroup = ruleGroups.some(
      (g) => g === "*" || userGroups.some((ug) => ug.toLowerCase() === g.toLowerCase())
    );
    if (!matchesGroup) return false;
  }

  return true;
}

const DEFAULT_APPROVAL_SECRET = "cmdbar-approval-secret-key";

/**
 * Helper to compute signature string for payload.
 * @param {string} payload
 * @param {string} [key]
 * @returns {string}
 * @private
 */
function computeSignature(payload, key = DEFAULT_APPROVAL_SECRET) {
  let sig = "";
  if (typeof process !== "undefined" && process.versions && process.versions.node) {
    try {
      const crypto = globalThis.require ? globalThis.require("crypto") : null;
      if (crypto) {
        sig = crypto.createHmac("sha256", key).update(payload).digest("hex");
      }
    } catch (e) {}
  }
  if (!sig && typeof GLib !== "undefined" && GLib.compute_hmac_for_string) {
    try {
      const encoder = new TextEncoder();
      sig = GLib.compute_hmac_for_string(GLib.ChecksumType.SHA256, encoder.encode(key), payload, -1);
    } catch (e) {}
  }
  if (!sig) {
    let hash = 0;
    const str = payload + key;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    sig = Math.abs(hash).toString(16);
  }
  return sig;
}

/**
 * Creates a signed approval token for overriding a blocked command.
 * @param {string} command
 * @param {string} [approver="admin"]
 * @param {number} [expiresInMs=3600000]
 * @param {string} [key]
 * @returns {string}
 * @public
 */
export function createApprovalToken(command, approver = "admin", expiresInMs = 3600000, key = DEFAULT_APPROVAL_SECRET) {
  const expiresAt = Date.now() + expiresInMs;
  const payload = JSON.stringify({ command, approver, expiresAt });
  const sig = computeSignature(payload, key);
  const tokenObj = { payload, sig };
  return Buffer.from(JSON.stringify(tokenObj)).toString("base64");
}

/**
 * Validates an approval token for a specific command.
 * @param {string} tokenStr
 * @param {string} command
 * @param {string} [key]
 * @returns {{ valid: boolean, error: string|null, tokenData: object|null }}
 * @public
 */
export function validateApprovalToken(tokenStr, command, key = DEFAULT_APPROVAL_SECRET) {
  if (!tokenStr || typeof tokenStr !== "string") {
    return { valid: false, error: "Missing token", tokenData: null };
  }

  try {
    const raw = Buffer.from(tokenStr, "base64").toString("utf8");
    const { payload, sig } = JSON.parse(raw);
    const data = JSON.parse(payload);

    if (Date.now() > data.expiresAt) {
      return { valid: false, error: "Approval token expired", tokenData: data };
    }

    if (command && data.command !== "*" && data.command.trim() !== command.trim()) {
      return { valid: false, error: "Token command mismatch", tokenData: data };
    }

    const expectedSig = computeSignature(payload, key);

    if (sig !== expectedSig) {
      return { valid: false, error: "Invalid token signature", tokenData: data };
    }

    return { valid: true, error: null, tokenData: data };
  } catch (e) {
    return { valid: false, error: "Malformed approval token", tokenData: null };
  }
}

/**
 * Grants an approval override for a command in the overrides map.
 * @param {object} overrides
 * @param {string} command
 * @param {string} [approver="admin"]
 * @param {number} [expiresInMs=3600000]
 * @returns {object}
 * @public
 */
export function grantApprovalOverride(overrides, command, approver = "admin", expiresInMs = 3600000) {
  if (!overrides || typeof overrides !== "object") return null;
  const expiresAt = Date.now() + expiresInMs;
  const overrideEntry = {
    command,
    approved_by: approver,
    expires_at: expiresAt,
    created_at: Date.now(),
  };
  overrides[command.trim()] = overrideEntry;
  return overrideEntry;
}

/**
 * Evaluates a command against policy rules (whitelist, blacklist, pattern matching, user/group filters, overrides).
 * @param {string} command
 * @param {object} [userContext]
 * @param {object} [policy]
 * @param {object|string} [overrides]
 * @returns {{ allowed: boolean, action: string, reason: string, matchedRule: object|null, requiresApproval: boolean, canOverride: boolean, overrideActive: boolean }}
 * @public
 */
export function evaluateCommandPolicy(command, userContext = null, policy = null, overrides = null) {
  if (!command || typeof command !== "string" || command.trim().length === 0) {
    return {
      allowed: false,
      action: "block",
      reason: "Command is empty or invalid.",
      matchedRule: null,
      requiresApproval: false,
      canOverride: false,
      overrideActive: false,
    };
  }

  const cmdStr = command.trim();

  if (policy && policy.enabled === false) {
    return {
      allowed: true,
      action: "allow",
      reason: "Policy enforcement is disabled.",
      matchedRule: null,
      requiresApproval: false,
      canOverride: false,
      overrideActive: false,
    };
  }

  const effectivePolicy = policy || {};
  const effectiveOverrides = overrides || effectivePolicy.overrides || {};

  if (typeof effectiveOverrides === "string") {
    const tokenVal = validateApprovalToken(effectiveOverrides, cmdStr);
    if (tokenVal.valid) {
      return {
        allowed: true,
        action: "allow",
        reason: `Execution allowed via valid approval token (approved by ${tokenVal.tokenData.approver}).`,
        matchedRule: null,
        requiresApproval: false,
        canOverride: true,
        overrideActive: true,
      };
    }
  } else if (typeof effectiveOverrides === "object") {
    const overrideEntry = effectiveOverrides[cmdStr];
    if (overrideEntry) {
      if (typeof overrideEntry === "object" && overrideEntry.expires_at) {
        if (Date.now() < overrideEntry.expires_at) {
          return {
            allowed: true,
            action: "allow",
            reason: `Execution allowed via approved policy override (approved by ${overrideEntry.approved_by || "admin"}).`,
            matchedRule: null,
            requiresApproval: false,
            canOverride: true,
            overrideActive: true,
          };
        }
      } else if (overrideEntry === true) {
        return {
          allowed: true,
          action: "allow",
          reason: "Execution allowed via policy override flag.",
          matchedRule: null,
          requiresApproval: false,
          canOverride: true,
          overrideActive: true,
        };
      }
    }
  }

  const blacklist = effectivePolicy.blacklist || [];
  const rules = effectivePolicy.rules || [];

  const blacklistRules = [];
  for (const item of blacklist) {
    if (typeof item === "string") {
      blacklistRules.push({ pattern: item, action: "block", allow_override: true });
    } else if (item && typeof item === "object") {
      blacklistRules.push({ action: "block", allow_override: true, ...item });
    }
  }
  for (const rule of rules) {
    if (rule && rule.action === "block") {
      blacklistRules.push(rule);
    }
  }

  for (const rule of blacklistRules) {
    if (isUserInContext(userContext, rule.users, rule.groups)) {
      if (matchPattern(cmdStr, rule.pattern, rule.type)) {
        const canOverride = rule.allow_override !== false;
        return {
          allowed: false,
          action: "block",
          reason: rule.reason || `Command blocked by blacklist rule matching pattern '${rule.pattern}'.`,
          matchedRule: rule,
          requiresApproval: canOverride,
          canOverride: canOverride,
          overrideActive: false,
        };
      }
    }
  }

  const whitelist = effectivePolicy.whitelist || [];
  const whitelistRules = [];
  for (const item of whitelist) {
    if (typeof item === "string") {
      whitelistRules.push({ pattern: item, action: "allow" });
    } else if (item && typeof item === "object") {
      whitelistRules.push({ action: "allow", ...item });
    }
  }
  for (const rule of rules) {
    if (rule && rule.action === "allow") {
      whitelistRules.push(rule);
    }
  }

  const isWhitelistMode = whitelistRules.length > 0 || effectivePolicy.mode === "whitelist_only" || effectivePolicy.mode === "hybrid";
  if (isWhitelistMode) {
    let matchedWhitelist = false;
    let matchedRule = null;

    for (const rule of whitelistRules) {
      if (isUserInContext(userContext, rule.users, rule.groups)) {
        if (matchPattern(cmdStr, rule.pattern, rule.type)) {
          matchedWhitelist = true;
          matchedRule = rule;
          break;
        }
      }
    }

    if (!matchedWhitelist) {
      return {
        allowed: false,
        action: "block",
        reason: "Command is not in the approved whitelist.",
        matchedRule: null,
        requiresApproval: true,
        canOverride: true,
        overrideActive: false,
      };
    }
  }

  return {
    allowed: true,
    action: "allow",
    reason: "Command allowed by security policy.",
    matchedRule: null,
    requiresApproval: false,
    canOverride: true,
    overrideActive: false,
  };
}

export {
  CommandPolicyManager,
  globToRegex,
  resolveUserContext,
  DEFAULT_BLACKLIST_PATTERNS,
  DEFAULT_WHITELIST_PATTERNS,
} from "./commandPolicy.js";

export {
  detectFormat,
  parseCsvLine,
  parseCsvOrTsv,
  formatTable,
  formatJson,
  formatCodeBlock,
  formatOutput,
} from "./outputFormatter.js";

/**
 * Maximum history limit.
 */
export const MAX_HISTORY_ITEMS = 50;

/**
 * Sanitizes sensitive information (passwords, tokens, API keys) from string or parameters.
 * @param {string} text
 * @returns {string}
 */
export function sanitizeSensitiveData(text) {
  if (text === null || text === undefined) return "";
  let str = String(text);

  // Redact password/token/secret flags like --password secret123, --token=xyz, -p secret123
  str = str.replace(
    /(--?(?:password|token|secret|api[_-]?key|auth[_-]?token|pass|pwd))(?:=|\s+)(\S+)/gi,
    "=[REDACTED]"
  );

  // Redact key=value or key: value pairs where key contains password/secret/token/apikey
  str = str.replace(
    /((?:password|secret|token|api[_-]?key|access[_-]?key|auth[_-]?token|bearer)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s&|;]+)/gi,
    "[REDACTED]"
  );

  // Redact Bearer tokens
  str = str.replace(/(Bearer\s+)([A-Za-z0-9._~+/-]+=*)/gi, "[REDACTED]");

  return str;
}

/**
 * Sanitizes a history item before persisting or logging.
 * @param {object} item
 * @returns {object}
 */
export function sanitizeHistoryItem(item) {
  if (!item || typeof item !== "object") return item;

  const sanitized = { ...item };

  if (sanitized.resolvedCommand) {
    sanitized.resolvedCommand = sanitizeSensitiveData(sanitized.resolvedCommand);
  }
  if (sanitized.command && typeof sanitized.command === "string") {
    sanitized.command = sanitizeSensitiveData(sanitized.command);
  }
  if (sanitized.name) {
    sanitized.name = sanitizeSensitiveData(sanitized.name);
  }

  if (sanitized.parameters && typeof sanitized.parameters === "object") {
    const sanitizedParams = {};
    for (const [key, val] of Object.entries(sanitized.parameters)) {
      const lowerKey = key.toLowerCase();
      const isSensitiveKey =
        lowerKey.includes("password") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("token") ||
        lowerKey.includes("key") ||
        lowerKey.includes("auth") ||
        lowerKey.includes("credential");

      if (isSensitiveKey) {
        sanitizedParams[key] = "[REDACTED]";
      } else {
        sanitizedParams[key] = sanitizeSensitiveData(val);
      }
    }
    sanitized.parameters = sanitizedParams;
  }

  return sanitized;
}

/**
 * Adds or updates a command history item, maintaining a maximum of 50 items.
 * @param {Array<object>} history
 * @param {object} newItem
 * @returns {Array<object>}
 */
export function addHistoryItem(history, newItem) {
  if (!Array.isArray(history)) history = [];
  const sanitized = sanitizeHistoryItem(newItem);
  sanitized.timestamp = sanitized.timestamp || Date.now();

  // Deduplicate if identical resolvedCommand or command name/parameters exist, move to top
  const filtered = history.filter(item => {
    if (!item) return false;
    const sameResolved = Boolean(item.resolvedCommand && sanitized.resolvedCommand && item.resolvedCommand === sanitized.resolvedCommand);
    const sameCmdAndParams = Boolean(item.command && sanitized.command && item.command === sanitized.command && JSON.stringify(item.parameters || {}) === JSON.stringify(sanitized.parameters || {}));
    const sameNameAndResolved = Boolean(item.name && sanitized.name && item.name === sanitized.name && sameResolved);
    return !(sameResolved || sameCmdAndParams || sameNameAndResolved);
  });

  const updated = [sanitized, ...filtered];
  return updated.slice(0, MAX_HISTORY_ITEMS);
}

/**
 * Normalizes profiles section from config into a standardized array of profile objects.
 * @param {object} config
 * @returns {Array<{ name: string, env: Object.<string, string> }>}
 */
export function getProfiles(config) {
  if (!config || typeof config !== "object" || !config.profiles) {
    return [];
  }
  if (Array.isArray(config.profiles)) {
    return config.profiles.map((p) => {
      if (typeof p === "string") {
        return { name: p, env: {} };
      }
      return {
        name: p.name || "Default",
        env: p.env || p.envVars || p.environment || {},
      };
    });
  } else if (typeof config.profiles === "object") {
    return Object.entries(config.profiles).map(([name, val]) => {
      let envObj = {};
      if (val && typeof val === "object") {
        envObj = val.env || val.envVars || val.environment || val;
      }
      return { name, env: envObj };
    });
  }
  return [];
}

/**
 * Resolves active profile name from config.
 * @param {object} config
 * @returns {string|null}
 */
export function getActiveProfileName(config) {
  if (!config || typeof config !== "object") return null;
  if (config.active_profile && typeof config.active_profile === "string") {
    return config.active_profile;
  }
  if (config.activeProfile && typeof config.activeProfile === "string") {
    return config.activeProfile;
  }
  const profiles = getProfiles(config);
  return profiles.length > 0 ? profiles[0].name : null;
}

/**
 * Gets environment variables object for specified profile name.
 * @param {object} config
 * @param {string} [profileName]
 * @returns {Object.<string, string>}
 */
export function getProfileEnv(config, profileName) {
  const targetName = profileName || getActiveProfileName(config);
  if (!targetName) return {};
  const profiles = getProfiles(config);
  const found = profiles.find((p) => p.name.toLowerCase() === targetName.toLowerCase());
  return found && found.env ? found.env : {};
}

/**
 * Determines whether a command is visible in the active profile context.
 * @param {object} cmd Command object
 * @param {string} activeProfile Active profile name
 * @returns {boolean}
 */
export function isCommandVisibleInProfile(cmd, activeProfile) {
  if (!cmd || typeof cmd !== "object") return true;
  let allowedProfiles = null;
  if (Array.isArray(cmd.profiles)) {
    allowedProfiles = cmd.profiles;
  } else if (typeof cmd.profiles === "string") {
    allowedProfiles = [cmd.profiles];
  } else if (typeof cmd.profile === "string") {
    allowedProfiles = [cmd.profile];
  }

  if (!allowedProfiles || allowedProfiles.length === 0) {
    return true;
  }

  if (!activeProfile) {
    return true;
  }

  const activeLower = activeProfile.toLowerCase();
  for (const p of allowedProfiles) {
    if (typeof p === "string") {
      const pLower = p.toLowerCase();
      if (pLower === "*" || pLower === "all" || pLower === activeLower) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Merges profile environment variables into base environment map.
 * @param {Object.<string, string>} baseEnv Base environment variables
 * @param {object} config Config object containing profiles
 * @param {string} [profileName] Profile name override
 * @returns {Object.<string, string>}
 */
export function getMergedEnvironment(baseEnv, config, profileName) {
  const merged = Object.assign({}, baseEnv || {});
  const profileEnv = getProfileEnv(config, profileName);
  for (const [key, val] of Object.entries(profileEnv)) {
    if (val !== undefined && val !== null) {
      merged[key] = String(val);
    }
  }
  return merged;
}

/**
 * Spawns a subprocess with merged profile environment variables using Gio.SubprocessLauncher.
 * @param {string[]} argv Command argument array
 * @param {number} flags Subprocess flags
 * @param {object} [config] Configuration object containing profiles
 * @param {string} [profileName] Active profile name
 * @returns {Gio.Subprocess}
 */
export function spawnSubprocess(argv, flags, config, profileName) {
  let profileEnv = getProfileEnv(config, profileName);
  let envEntries = Object.entries(profileEnv);

  if (typeof Gio !== "undefined" && Gio && Gio.SubprocessLauncher && envEntries.length > 0) {
    try {
      let launcher = new Gio.SubprocessLauncher({ flags: flags });
      for (let [key, val] of envEntries) {
        if (val !== undefined && val !== null) {
          launcher.setenv(key, String(val), true);
        }
      }
      return launcher.spawnv(argv);
    } catch (e) {
      // Fallback to Gio.Subprocess.new if launcher fails
    }
  }

  return Gio.Subprocess.new(argv, flags);
}

export {
  isModhex,
  validateYubicoOTP,
  verifyFIDO2Assertion,
  requestTouchConfirmation,
  generateEmergencyCodes,
  verifyAndConsumeEmergencyCode,
  isSensitiveCommand,
  authenticateCommand,
  benchmarkYubikeyAuth,
} from "./yubikeyAuth.js";

/**
 * @param {string} text
 * @returns {boolean}
 */
export function isCalculatorQuery(text) {
  if (text === null || text === undefined) return false;
  const str = String(text).trim();
  if (str.startsWith(">") || str.startsWith("=")) {
    return true;
  }
  const lower = str.toLowerCase();
  if (
    lower === "calc" ||
    lower.startsWith("calc ") ||
    /^calc[\d\s+\-*\/%^().,]/.test(lower)
  ) {
    return true;
  }
  return false;
}

/**
 * Extracts the math expression string from calculator search text.
 * @param {string} text
 * @returns {string}
 */
export function getCalculatorExpression(text) {
  if (!text) return "";
  let str = String(text).trim();
  if (str.startsWith(">") || str.startsWith("=")) {
    return str.slice(1).trim();
  }
  if (str.toLowerCase().startsWith("calc")) {
    return str.slice(4).trim();
  }
  return str;
}

const MATH_CONSTANTS = {
  pi: Math.PI,
  PI: Math.PI,
  e: Math.E,
  E: Math.E,
  tau: 2 * Math.PI,
  TAU: 2 * Math.PI,
  phi: (1 + Math.sqrt(5)) / 2,
  PHI: (1 + Math.sqrt(5)) / 2,
};

const MATH_FUNCTIONS = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  sind: (x) => Math.sin((x * Math.PI) / 180),
  cosd: (x) => Math.cos((x * Math.PI) / 180),
  tand: (x) => Math.tan((x * Math.PI) / 180),
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  log: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  ln: Math.log,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  rad: (x) => (x * Math.PI) / 180,
  deg: (x) => (x * 180) / Math.PI,
  fact: (n) => {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  },
  factorial: (n) => {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  },
};

/**
 * Safely evaluates a math expression without eval/Function vulnerabilities.
 * @param {string} expr
 * @returns {{ success: boolean, result: number|null, formatted: string, error?: string }}
 */
export function evaluateMathExpression(expr) {
  if (!expr || typeof expr !== "string" || expr.trim() === "") {
    return {
      success: false,
      result: null,
      formatted: "",
      error: "Empty expression",
    };
  }

  const cleanExpr = expr.trim();

  try {
    const tokens = [];
    let i = 0;

    while (i < cleanExpr.length) {
      const ch = cleanExpr[i];

      if (/\s/.test(ch)) {
        i++;
        continue;
      }

      if (/[\d.]/.test(ch)) {
        let numStr = "";
        while (i < cleanExpr.length && /[\d.]/.test(cleanExpr[i])) {
          numStr += cleanExpr[i];
          i++;
        }
        if (i < cleanExpr.length && /[eE]/.test(cleanExpr[i])) {
          if (i + 1 < cleanExpr.length && /[\d+-]/.test(cleanExpr[i + 1])) {
            numStr += cleanExpr[i];
            i++;
            if (/[+-]/.test(cleanExpr[i])) {
              numStr += cleanExpr[i];
              i++;
            }
            while (i < cleanExpr.length && /\d/.test(cleanExpr[i])) {
              numStr += cleanExpr[i];
              i++;
            }
          }
        }
        const val = parseFloat(numStr);
        if (isNaN(val)) {
          throw new Error(`Invalid number: ${numStr}`);
        }
        tokens.push({ type: "NUMBER", value: val });
        continue;
      }

      if (/[a-zA-Z_]/.test(ch)) {
        let name = "";
        while (i < cleanExpr.length && /[a-zA-Z0-9_]/.test(cleanExpr[i])) {
          name += cleanExpr[i];
          i++;
        }
        tokens.push({ type: "IDENT", value: name });
        continue;
      }

      if (ch === "*" && i + 1 < cleanExpr.length && cleanExpr[i + 1] === "*") {
        tokens.push({ type: "OP", value: "^" });
        i += 2;
        continue;
      }

      if ("+-*/%^".includes(ch)) {
        tokens.push({ type: "OP", value: ch });
        i++;
        continue;
      }

      if (ch === "(" || ch === ")") {
        tokens.push({ type: "PAREN", value: ch });
        i++;
        continue;
      }

      if (ch === ",") {
        tokens.push({ type: "COMMA", value: "," });
        i++;
        continue;
      }

      throw new Error(`Unexpected character: ${ch}`);
    }

    if (tokens.length === 0) {
      return {
        success: false,
        result: null,
        formatted: "",
        error: "Empty expression",
      };
    }

    const processedTokens = [];
    for (let t = 0; t < tokens.length; t++) {
      const curr = tokens[t];
      processedTokens.push(curr);

      if (t < tokens.length - 1) {
        const next = tokens[t + 1];
        const isCurrValue =
          curr.type === "NUMBER" ||
          (curr.type === "PAREN" && curr.value === ")") ||
          (curr.type === "IDENT" && MATH_CONSTANTS.hasOwnProperty(curr.value));
        const isNextStart =
          next.type === "NUMBER" ||
          (next.type === "PAREN" && next.value === "(") ||
          next.type === "IDENT";

        if (isCurrValue && isNextStart) {
          processedTokens.push({ type: "OP", value: "*" });
        }
      }
    }

    let pos = 0;

    function peek() {
      return processedTokens[pos];
    }

    function consume() {
      return processedTokens[pos++];
    }

    function parseExpression() {
      return parseAdditive();
    }

    function parseAdditive() {
      let left = parseMultiplicative();
      while (
        peek() &&
        peek().type === "OP" &&
        ("+" === peek().value || "-" === peek().value)
      ) {
        const op = consume().value;
        const right = parseMultiplicative();
        if (op === "+") left += right;
        else left -= right;
      }
      return left;
    }

    function parseMultiplicative() {
      let left = parseExponent();
      while (
        peek() &&
        peek().type === "OP" &&
        ("*" === peek().value ||
          "/" === peek().value ||
          "%" === peek().value)
      ) {
        const op = consume().value;
        const right = parseExponent();
        if (op === "*") left *= right;
        else if (op === "/") left /= right;
        else if (op === "%") left %= right;
      }
      return left;
    }

    function parseExponent() {
      let left = parseUnary();
      while (peek() && peek().type === "OP" && peek().value === "^") {
        consume();
        const right = parseExponent();
        left = Math.pow(left, right);
      }
      return left;
    }

    function parseUnary() {
      if (
        peek() &&
        peek().type === "OP" &&
        (peek().value === "+" || peek().value === "-")
      ) {
        const op = consume().value;
        const operand = parseUnary();
        return op === "-" ? -operand : operand;
      }
      return parsePrimary();
    }

    function parsePrimary() {
      const token = peek();
      if (!token) {
        throw new Error("Unexpected end of expression");
      }

      if (token.type === "NUMBER") {
        consume();
        return token.value;
      }

      if (token.type === "PAREN" && token.value === "(") {
        consume();
        const val = parseExpression();
        if (!peek() || peek().type !== "PAREN" || peek().value !== ")") {
          throw new Error("Missing closing parenthesis");
        }
        consume();
        return val;
      }

      if (token.type === "IDENT") {
        const identToken = consume();
        const name = identToken.value;

        if (peek() && peek().type === "PAREN" && peek().value === "(") {
          consume();
          const fn =
            MATH_FUNCTIONS[name.toLowerCase()] || MATH_FUNCTIONS[name];
          if (!fn) {
            throw new Error(`Unknown function: ${name}`);
          }
          const args = [];
          if (peek() && !(peek().type === "PAREN" && peek().value === ")")) {
            args.push(parseExpression());
            while (peek() && peek().type === "COMMA") {
              consume();
              args.push(parseExpression());
            }
          }
          if (!peek() || peek().type !== "PAREN" || peek().value !== ")") {
            throw new Error(`Missing closing parenthesis for ${name}`);
          }
          consume();
          return fn(...args);
        }

        if (MATH_CONSTANTS.hasOwnProperty(name)) {
          return MATH_CONSTANTS[name];
        }

        const fn =
          MATH_FUNCTIONS[name.toLowerCase()] || MATH_FUNCTIONS[name];
        if (fn) {
          const arg = parsePrimary();
          return fn(arg);
        }

        throw new Error(`Unknown identifier: ${name}`);
      }

      throw new Error(`Unexpected token: ${token.value}`);
    }

    const val = parseExpression();

    if (pos < processedTokens.length) {
      throw new Error("Unexpected trailing tokens");
    }

    if (typeof val !== "number" || isNaN(val)) {
      return {
        success: false,
        result: null,
        formatted: "",
        error: "Invalid numeric result",
      };
    }

    let formattedStr = String(val);
    if (isFinite(val)) {
      const rounded = Number(Math.round(val + "e12") + "e-12");
      formattedStr = String(rounded);
    }

    return {
      success: true,
      result: val,
      formatted: formattedStr,
    };
  } catch (err) {
    return {
      success: false,
      result: null,
      formatted: "",
      error: err.message,
    };
  }
}

const isNode =
  typeof process !== "undefined" &&
  process.versions &&
  process.versions.node;

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
