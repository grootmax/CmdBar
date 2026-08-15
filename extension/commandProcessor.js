/**
 * Core business logic for CmdBar extension command processing and validation.
 */

let GLib;
try {
    if (typeof globalThis.imports !== 'undefined' && globalThis.imports.gi) {
        GLib = globalThis.imports.gi.GLib;
    }
} catch (e) {}

if (!GLib) {
    try {
        const gi = await import('gi');
        GLib = gi.GLib;
    } catch (e) {}
}

/**
 * Checks if the entered text is non-empty and contains non-whitespace characters.
 * @param {string} text
 * @returns {boolean}
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
    if (!commandTemplate || typeof commandTemplate !== 'string') {
        return false;
    }
    return /<[^>]+>/.test(commandTemplate) || /\{\{[^}]+\}\}/.test(commandTemplate);
}

/**
 * Substitutes the given input parameter value into the command template placeholders.
 * If multiple placeholders exist, all are replaced by the parameter value.
 * @param {string} commandTemplate
 * @param {string} val
 * @returns {string}
 */
export function substituteCommand(commandTemplate, val) {
    if (!commandTemplate || typeof commandTemplate !== 'string') {
        return '';
    }
    const cleanVal = val !== undefined && val !== null ? String(val) : '';
    let substituted = commandTemplate;
    // Replace all occurrences of <something>
    substituted = substituted.replace(/<[^>]+>/g, () => cleanVal);
    // Replace all occurrences of {{something}}
    substituted = substituted.replace(/\{\{[^}]+\}\}/g, () => cleanVal);
    return substituted;
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
    const contentStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

    if (isNode) {
        const fs = (await import('fs')).default;
        const tempPath = targetPath + '.tmp';
        fs.writeFileSync(tempPath, contentStr, 'utf8');
        fs.renameSync(tempPath, targetPath);
    } else {
        // GJS (GNOME Shell) environment
        const { Gio, GLib } = await import('gi');
        const file = Gio.File.new_for_path(targetPath);
        const tmpPath = targetPath + '.tmp';
        const tmpFile = Gio.File.new_for_path(tmpPath);
        const bytes = new GLib.Bytes(contentStr);
        tmpFile.replace_contents(bytes, null, false, Gio.FileCreateFlags.NONE, null);
        tmpFile.move(file, Gio.FileCopyFlags.OVERWRITE, null, null);
    }
}

/**
 * Parses stdout from env command into an array of environment variables.
 * Filters out invalid lines.
 * @param {string} stdout
 * @returns {string[]}
 */
export function parseEnv(stdout) {
    if (!stdout || typeof stdout !== 'string') {
        return [];
    }
    return stdout.split('\n')
        .filter(line => line.includes('='));
}

/**
 * Tokenizes a command line string into arguments.
 * Uses native GLib.shell_parse_argv when available, falls back to JS simulation.
 * @param {string} commandLine
 * @returns {string[]}
 */
export function tokenizeCommand(commandLine) {
    if (!commandLine || typeof commandLine !== 'string') {
        return [];
    }

    if (GLib && typeof GLib.shell_parse_argv === 'function') {
        try {
            const [ok, argv] = GLib.shell_parse_argv(commandLine);
            if (ok) {
                return argv;
            }
        } catch (e) {
            // Fall through to JS-based parser
        }
    }

    // JS fallback tokenizer
    const result = [];
    let current = '';
    let inDoubleQuotes = false;
    let inSingleQuotes = false;
    let escaped = false;
    let hasToken = false;

    for (let i = 0; i < commandLine.length; i++) {
        const char = commandLine[i];

        if (escaped) {
            current += char;
            escaped = false;
            hasToken = true;
        } else if (char === '\\') {
            if (inSingleQuotes) {
                current += char;
            } else {
                escaped = true;
            }
            hasToken = true;
        } else if (char === '"') {
            if (inSingleQuotes) {
                current += char;
            } else {
                inDoubleQuotes = !inDoubleQuotes;
                hasToken = true;
            }
        } else if (char === "'") {
            if (inDoubleQuotes) {
                current += char;
            } else {
                inSingleQuotes = !inSingleQuotes;
                hasToken = true;
            }
        } else if (/\s/.test(char)) {
            if (inDoubleQuotes || inSingleQuotes) {
                current += char;
                hasToken = true;
            } else {
                if (hasToken || current.length > 0) {
                    result.push(current);
                    current = '';
                    hasToken = false;
                }
            }
        } else {
            current += char;
            hasToken = true;
        }
    }

    if (hasToken || current.length > 0) {
        result.push(current);
    }

    return result;
}

/**
 * Extracts placeholders from a command template string.
 * Supports <placeholder> and {{placeholder}}.
 * @param {string} commandTemplate
 * @returns {string[]}
 */
export function getPlaceholders(commandTemplate) {
    if (!commandTemplate || typeof commandTemplate !== 'string') {
        return [];
    }

    const regex = /<[^>]+>|\{\{[^}]+\}\}/g;
    const matches = commandTemplate.match(regex);
    return matches ? matches : [];
}

/**
 * Substitutes keys inside mapped placeholder object.
 * @param {string[]} tokens
 * @param {object} placeholderMap
 * @returns {string[]}
 */
export function substituteTokens(tokens, placeholderMap) {
    if (!Array.isArray(tokens)) {
        return [];
    }
    if (!placeholderMap || typeof placeholderMap !== 'object') {
        return tokens;
    }

    return tokens.map(token => {
        if (placeholderMap.hasOwnProperty(token)) {
            return placeholderMap[token];
        }
        return token;
    });
}

