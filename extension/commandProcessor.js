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
 * Escapes HTML/XML markup characters in a string.
 * @param {string} text
 * @returns {string}
 */
export function escapeMarkup(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Performs fuzzy sequence matching on text against pattern.
 * @param {string} pattern
 * @param {string} text
 * @param {number} [usageCount=0]
 * @returns {{ match: boolean, matches: number[], score: number }}
 */
export function fuzzyMatch(pattern, text, usageCount = 0) {
  if (text === null || text === undefined) text = "";
  if (pattern === null || pattern === undefined) pattern = "";

  const trimmedPattern = pattern.trim();
  if (trimmedPattern === "") {
    return { match: true, matches: [], score: usageCount * 10 };
  }

  const pLower = trimmedPattern.toLowerCase();
  const tLower = text.toLowerCase();

  let pIdx = 0;
  const matches = [];

  for (let i = 0; i < tLower.length; i++) {
    if (tLower[i] === pLower[pIdx]) {
      matches.push(i);
      pIdx++;
      if (pIdx === pLower.length) break;
    }
  }

  if (pIdx < pLower.length) {
    return { match: false, matches: [], score: 0 };
  }

  let score = 100;
  if (text.length === trimmedPattern.length) {
    score += 50;
  } else {
    score += Math.max(0, 30 - (text.length - trimmedPattern.length));
  }

  for (let i = 1; i < matches.length; i++) {
    if (matches[i] === matches[i - 1] + 1) {
      score += 15;
    }
  }

  score += usageCount * 10;

  return { match: true, matches, score };
}

/**
 * Highlights character matches in text using <b> tags and escaped markup.
 * @param {string} text
 * @param {number[]} matches
 * @returns {string}
 */
export function highlightMatches(text, matches) {
  if (!text) return "";
  if (!matches || matches.length === 0) return escapeMarkup(text);

  const sortedMatches = [...matches].sort((a, b) => a - b);
  const matchSet = new Set(sortedMatches);

  const ranges = [];
  let currentRange = null;

  for (const idx of sortedMatches) {
    if (!currentRange) {
      currentRange = [idx, idx];
    } else if (idx === currentRange[1] + 1) {
      currentRange[1] = idx;
    } else {
      ranges.push(currentRange);
      currentRange = [idx, idx];
    }
  }
  if (currentRange) {
    ranges.push(currentRange);
  }

  let result = "";
  let lastIdx = 0;

  for (const [start, end] of ranges) {
    if (start > lastIdx) {
      result += escapeMarkup(text.substring(lastIdx, start));
    }
    result += "<b>" + escapeMarkup(text.substring(start, end + 1)) + "</b>";
    lastIdx = end + 1;
  }

  if (lastIdx < text.length) {
    result += escapeMarkup(text.substring(lastIdx));
  }

  return result;
}

/**
 * Ranks commands based on fuzzy match score and usage frequency.
 * @param {Array<Object>} commands
 * @param {string} query
 * @param {Object.<string, number>} [usageMap={}]
 * @returns {Array<Object>}
 */
export function rankCommands(commands, query, usageMap = {}) {
  if (!Array.isArray(commands)) return [];

  const results = [];
  for (const cmd of commands) {
    const commandStr = cmd.command || "";
    const nameStr = cmd.name || "";
    const usage = usageMap[commandStr] || usageMap[nameStr] || 0;

    const cmdMatch = fuzzyMatch(query, commandStr, usage);
    const nameMatch = fuzzyMatch(query, nameStr, usage);

    const bestMatch = (cmdMatch.match && nameMatch.match)
      ? (cmdMatch.score >= nameMatch.score ? cmdMatch : nameMatch)
      : (cmdMatch.match ? cmdMatch : (nameMatch.match ? nameMatch : null));

    if (bestMatch) {
      results.push({
        command: cmd,
        matchResult: bestMatch,
        score: bestMatch.score,
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

    const expectedToken = createApprovalToken(data.command, data.approver, data.expiresAt - Date.now(), key);
    const expectedRaw = Buffer.from(expectedToken, "base64").toString("utf8");
    const expectedSig = JSON.parse(expectedRaw).sig;

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
  detectFormat,
  parseCsvLine,
  parseCsvOrTsv,
  formatTable,
  formatJson,
  formatCodeBlock,
  formatOutput,
} from "./outputFormatter.js";


