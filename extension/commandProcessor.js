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
    substituted = substituted.replace(/<[^>]+>/g, () => cleanVal);
    // Replace all occurrences of {{something}}
    substituted = substituted.replace(/\{\{[^}]+\}\}/g, () => cleanVal);
    return substituted;
}
