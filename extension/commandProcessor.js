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
    if (!commandTemplate || typeof commandTemplate !== 'string') {
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
    if (!commandTemplate || typeof commandTemplate !== 'string') {
        return '';
    }
    const cleanVal = val !== undefined && val !== null ? String(val) : '';
    return commandTemplate.replace(/\{\{[^}]+\}\}|<[^>]+>|\{[^}]+\}/g, () => cleanVal);
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
        const fs = (await import('fs')).default || (await import('fs'));
        const path = (await import('path')).default || (await import('path'));
        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        const tempPath = targetPath + '.tmp';

        let mode;
        if (fs.existsSync(targetPath)) {
            try {
                mode = fs.statSync(targetPath).mode;
            } catch (e) {}
        }

        try {
            fs.writeFileSync(tempPath, contentStr, 'utf8');
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
        const { Gio, GLib } = await import('gi');
        const file = Gio.File.new_for_path(targetPath);
        const tmpPath = targetPath + '.tmp';
        const tmpFile = Gio.File.new_for_path(tmpPath);
        const bytes = new GLib.Bytes(contentStr);
        try {
            tmpFile.replace_contents(bytes, null, false, Gio.FileCreateFlags.NONE, null);
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
    if (!stdout || typeof stdout !== 'string') {
        return [];
    }
    return stdout.split('\n')
        .map(line => line.trim())
        .filter(line => line.includes('='));
}

/**
 * Parses a command template string into an array of tokenized argument strings,
 * handling single/double quotes and backslash escapes properly.
 * @param {string} commandTemplate
 * @returns {string[]}
 * @public
 */
export function tokenizeCommand(commandTemplate) {
    if (!commandTemplate || typeof commandTemplate !== 'string') {
        return [];
    }
    const args = [];
    let current = '';
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

        if (char === '\\' && !inSingleQuotes) {
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

        if (char === ' ' || char === '\t' || char === '\r' || char === '\n') {
            if (inDoubleQuotes || inSingleQuotes) {
                current += char;
            } else if (current.length > 0) {
                args.push(current);
                current = '';
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
    if (!commandTemplate || typeof commandTemplate !== 'string') {
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
    if (!placeholderMap || typeof placeholderMap !== 'object') {
        return [...tokens];
    }
    const expandedMap = {};
    for (const [key, val] of Object.entries(placeholderMap)) {
        if (key.startsWith('<') || key.startsWith('{')) {
            expandedMap[key] = val;
        } else {
            expandedMap[`<${key}>`] = val;
            expandedMap[`{{${key}}}`] = val;
            expandedMap[`{${key}}`] = val;
        }
    }
    const entries = Object.entries(expandedMap).sort((a, b) => b[0].length - a[0].length);
    return tokens.map(token => {
        let substituted = token;
        for (const [placeholder, val] of entries) {
            const cleanVal = val !== undefined && val !== null ? String(val) : '';
            const escapedPlaceholder = placeholder.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const regex = new RegExp(escapedPlaceholder, 'g');
            substituted = substituted.replace(regex, () => cleanVal);
        }
        return substituted;
    });
}

