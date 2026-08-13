/**
 * Core business logic for CmdBar extension command processing and validation.
 */

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
    substituted = substituted.replace(/<[^>]+>/g, cleanVal);
    // Replace all occurrences of {{something}}
    substituted = substituted.replace(/\{\{[^}]+\}\}/g, cleanVal);
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

