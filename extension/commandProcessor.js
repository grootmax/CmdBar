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
    const commandStr = Array.isArray(cmd.command)
      ? cmd.command.join(" ")
      : String(cmd.command || "");
    const nameStr = cmd.name || "";
    const usage = (usageMap && (usageMap[commandStr] || usageMap[nameStr])) || 0;

    const cmdMatch = fuzzyMatch(query, commandStr, usage);
    const nameMatch = fuzzyMatch(query, nameStr, usage);

    const bestMatch = (cmdMatch.match && nameMatch.match)
      ? (cmdMatch.score >= nameMatch.score ? cmdMatch : nameMatch)
      : (cmdMatch.match ? cmdMatch : (nameMatch.match ? nameMatch : null));

    if (bestMatch) {
      results.push({
        command: cmd,
        matchResult: bestMatch,
        matches: bestMatch.matches,
        score: bestMatch.score,
        highlightedName: highlightMatches(nameStr, nameMatch.matches),
        highlightedCommand: highlightMatches(commandStr, cmdMatch.matches),
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
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
