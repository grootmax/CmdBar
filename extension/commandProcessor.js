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

/**
 * Checks if search text triggers calculator mode (> prefix, = prefix, or calc prefix).
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


