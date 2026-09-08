/**
 * Output Parser and Formatter module for CmdBar extension.
 * Supports auto-detection of output formats (JSON, CSV/TSV, Code, Plain Text),
 * pretty printing JSON with syntax highlighting, ASCII table rendering for CSV/TSV,
 * and monospace code blocks.
 */

import { escapeMarkup } from "./commandProcessor.js";

/**
 * Auto-detects the format of raw command output.
 * @param {string} rawOutput
 * @returns {'json' | 'csv' | 'tsv' | 'code' | 'text'}
 */
export function detectFormat(rawOutput) {
  if (rawOutput === null || rawOutput === undefined) {
    return "text";
  }

  const str = String(rawOutput);
  const trimmed = str.trim();

  if (!trimmed) {
    return "text";
  }

  // 1. JSON Detection
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch (e) {
      // Not valid JSON
    }
  }

  // Check markdown JSON block ```json ... ```
  const jsonBlockMatch = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  if (jsonBlockMatch) {
    try {
      JSON.parse(jsonBlockMatch[1].trim());
      return "json";
    } catch (e) {}
  }

  // 2. CSV / TSV Detection
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lines.length >= 2) {
    // Check TSV
    const line0Tabs = (lines[0].match(/\t/g) || []).length;
    if (line0Tabs >= 1) {
      const isTsv = lines.every((line) => {
        const tabs = (line.match(/\t/g) || []).length;
        return tabs === line0Tabs;
      });
      if (isTsv) return "tsv";
    }

    // Check CSV
    const line0Cells = parseCsvLine(lines[0], ",");
    if (line0Cells.length >= 2) {
      const isCsv = lines.every((line) => {
        const cells = parseCsvLine(line, ",");
        return cells.length === line0Cells.length;
      });
      if (isCsv) return "csv";
    }
  }

  // 3. Code Detection
  if (
    trimmed.startsWith("```") ||
    /^(?:function|class|def|const|let|var|import|export|if|for|while)\b/m.test(
      trimmed,
    ) ||
    /^\s*<[a-zA-Z1-6]+(?:\s+[^>]*)?>[\s\S]*<\/[a-zA-Z1-6]+>\s*$/m.test(
      trimmed,
    ) ||
    /^(?:[\w.-]+:\s*.*\n){3,}/.test(trimmed)
  ) {
    return "code";
  }

  return "text";
}

/**
 * Parses a single line of CSV or TSV string, handling double quotes.
 * @param {string} line
 * @param {string} [delimiter=',']
 * @returns {string[]}
 */
export function parseCsvLine(line, delimiter = ",") {
  if (!line) return [];
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Parses CSV or TSV raw string into array of row arrays.
 * @param {string} rawText
 * @param {string} [delimiter=',']
 * @returns {string[][]}
 */
export function parseCsvOrTsv(rawText, delimiter = ",") {
  if (!rawText) return [];
  const lines = String(rawText)
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  return lines.map((line) => parseCsvLine(line, delimiter));
}

/**
 * Renders CSV/TSV data or array of rows into an ASCII table string.
 * @param {string|string[][]} input
 * @param {object} [options={}]
 * @returns {string}
 */
export function formatTable(input, options = {}) {
  const delimiter = options.delimiter || ",";
  let rows = Array.isArray(input) ? input : parseCsvOrTsv(input, delimiter);

  if (!rows || rows.length === 0) return "";

  // Calculate max column widths
  const numCols = Math.max(...rows.map((r) => r.length));
  const colWidths = new Array(numCols).fill(0);

  for (const row of rows) {
    for (let c = 0; c < numCols; c++) {
      const cellStr =
        row[c] !== undefined && row[c] !== null ? String(row[c]) : "";
      if (cellStr.length > colWidths[c]) {
        colWidths[c] = cellStr.length;
      }
    }
  }

  // Ensure minimum width for columns
  for (let c = 0; c < numCols; c++) {
    colWidths[c] = Math.max(colWidths[c], 1);
  }

  const divider = "+" + colWidths.map((w) => "-".repeat(w + 2)).join("+") + "+";

  const formattedRows = rows.map((row) => {
    const cells = [];
    for (let c = 0; c < numCols; c++) {
      const cellStr =
        row[c] !== undefined && row[c] !== null ? String(row[c]) : "";
      cells.push(cellStr.padEnd(colWidths[c]));
    }
    return "| " + cells.join(" | ") + " |";
  });

  if (formattedRows.length === 0) return "";

  const header = formattedRows[0];
  const body = formattedRows.slice(1);

  if (body.length > 0) {
    return [divider, header, divider, ...body, divider].join("\n");
  } else {
    return [divider, header, divider].join("\n");
  }
}

/**
 * Formats JSON into pretty-printed string with syntax highlighting.
 * @param {string|object} input
 * @param {object} [options={}]
 * @returns {{ text: string, markup: string, ansi: string, data: any }}
 */
export function formatJson(input, options = {}) {
  const indent = options.indent || 2;
  let parsedObj;
  let rawJsonStr = "";

  if (typeof input === "string") {
    const trimmed = input.trim();
    // Strip markdown code fence if present
    const cleanStr = trimmed
      .replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, "$1")
      .trim();
    try {
      parsedObj = JSON.parse(cleanStr);
      rawJsonStr = JSON.stringify(parsedObj, null, indent);
    } catch (e) {
      rawJsonStr = cleanStr;
      parsedObj = null;
    }
  } else {
    parsedObj = input;
    try {
      rawJsonStr = JSON.stringify(input, null, indent);
    } catch (e) {
      rawJsonStr = String(input);
    }
  }

  // Generate Pango markup for GNOME Shell labels
  let markup = escapeMarkup(rawJsonStr);
  markup = markup.replace(
    /(&quot;[\w_.\-\s]+&quot;)(\s*:)/g,
    '<span foreground="#3584e4">$1</span>$2',
  ); // Keys: blue
  markup = markup.replace(
    /:\s*(&quot;.*?&quot;)/g,
    ': <span foreground="#2ec27e">$1</span>',
  ); // String values: green
  markup = markup.replace(
    /:\s*(\b\d+(?:\.\d+)?\b)/g,
    ': <span foreground="#e66100">$1</span>',
  ); // Number values: orange
  markup = markup.replace(
    /:\s*(\btrue\b|\bfalse\b|\bnull\b)/g,
    ': <span foreground="#9141ac">$1</span>',
  ); // Booleans/null: purple

  // Generate ANSI colorized string for CLI/terminal
  let ansi = rawJsonStr;
  ansi = ansi.replace(/("[\w_.\-\s]+")(\s*:)/g, "\x1b[34m$1\x1b[0m$2"); // Blue keys
  ansi = ansi.replace(/:\s*(".*?")/g, ": \x1b[32m$1\x1b[0m"); // Green string values
  ansi = ansi.replace(/:\s*(\b\d+(?:\.\d+)?\b)/g, ": \x1b[33m$1\x1b[0m"); // Yellow/orange numbers
  ansi = ansi.replace(
    /:\s*(\btrue\b|\bfalse\b|\bnull\b)/g,
    ": \x1b[35m$1\x1b[0m",
  ); // Magenta booleans/null

  return {
    text: rawJsonStr,
    markup: `<font face="monospace">${markup}</font>`,
    ansi: ansi,
    data: parsedObj,
  };
}

/**
 * Formats code or text inside a monospace code block.
 * @param {string} codeString
 * @param {object} [options={}]
 * @returns {{ text: string, markup: string }}
 */
export function formatCodeBlock(codeString, options = {}) {
  const str =
    codeString !== null && codeString !== undefined ? String(codeString) : "";
  const clean = str.replace(/^```[a-zA-Z0-9]*\n([\s\S]*?)\n```$/, "$1");
  const lines = clean.split(/\r?\n/);
  const maxLen = Math.max(...lines.map((l) => l.length), 20);

  const topBorder = "┌" + "─".repeat(maxLen + 2) + "┐";
  const bottomBorder = "└" + "─".repeat(maxLen + 2) + "┘";
  const boxedLines = lines.map((line) => "│ " + line.padEnd(maxLen) + " │");

  const plainBoxed = [topBorder, ...boxedLines, bottomBorder].join("\n");
  const escaped = escapeMarkup(clean);
  const markup = `<font face="monospace">${escaped}</font>`;

  return {
    text: plainBoxed,
    markup: markup,
  };
}

/**
 * Main output parser and renderer function.
 * @param {string} rawOutput
 * @param {object} [options={}]
 * @returns {{ format: string, raw: string, data: any, text: string, markup: string, ansi: string }}
 */
export function formatOutput(rawOutput, options = {}) {
  if (rawOutput === null || rawOutput === undefined) {
    rawOutput = "";
  }

  const requestedFormat = options.format || "auto";
  const format =
    requestedFormat === "auto" ? detectFormat(rawOutput) : requestedFormat;

  let text = "";
  let markup = "";
  let ansi = "";
  let data = null;

  switch (format) {
    case "json": {
      const res = formatJson(rawOutput, options);
      text = res.text;
      markup = res.markup;
      ansi = res.ansi;
      data = res.data;
      break;
    }
    case "csv": {
      data = parseCsvOrTsv(rawOutput, ",");
      text = formatTable(data, { delimiter: "," });
      markup = `<font face="monospace">${escapeMarkup(text)}</font>`;
      ansi = text;
      break;
    }
    case "tsv": {
      data = parseCsvOrTsv(rawOutput, "\t");
      text = formatTable(data, { delimiter: "\t" });
      markup = `<font face="monospace">${escapeMarkup(text)}</font>`;
      ansi = text;
      break;
    }
    case "code": {
      const res = formatCodeBlock(rawOutput, options);
      text = res.text;
      markup = res.markup;
      ansi = rawOutput;
      data = rawOutput;
      break;
    }
    case "text":
    default: {
      const str = String(rawOutput).trim();
      text = str;
      markup = escapeMarkup(str);
      ansi = str;
      data = str;
      break;
    }
  }

  return {
    format,
    raw: rawOutput,
    data,
    text,
    markup,
    ansi,
  };
}
