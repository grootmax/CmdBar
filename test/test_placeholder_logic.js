import assert from 'assert';
import { describe, it } from 'node:test';

// Extract the core functions to test
function findPlaceholders(commandString) {
    let placeholderRegex = /<([^>]+)>/g;
    let matches = [...commandString.matchAll(placeholderRegex)];
    let uniquePlaceholders = [];
    for (let m of matches) {
        if (!uniquePlaceholders.includes(m[0])) {
            uniquePlaceholders.push(m[0]);
        }
    }
    return uniquePlaceholders;
}

function substitutePlaceholders(commandString, replacements) {
    let result = commandString;
    for (let placeholder of Object.keys(replacements)) {
        result = result.replaceAll(placeholder, replacements[placeholder]);
    }
    return result;
}

describe('CmdBar Placeholder Logic', () => {
    it('should detect no placeholders in a standard command', () => {
        const cmd = 'npm run dev';
        const placeholders = findPlaceholders(cmd);
        assert.deepStrictEqual(placeholders, []);
    });

    it('should detect a single placeholder', () => {
        const cmd = 'docker logs -f <container-id>';
        const placeholders = findPlaceholders(cmd);
        assert.deepStrictEqual(placeholders, ['<container-id>']);
    });

    it('should detect multiple unique placeholders', () => {
        const cmd = "ansible-playbook -i inventory deploy.yml --extra-vars 'service=<service-name> version=<version-tag>'";
        const placeholders = findPlaceholders(cmd);
        assert.deepStrictEqual(placeholders, ['<service-name>', '<version-tag>']);
    });

    it('should substitute single placeholder correctly', () => {
        const cmd = 'docker logs -f <container-id>';
        const result = substitutePlaceholders(cmd, {
            '<container-id>': 'my-running-container'
        });
        assert.strictEqual(result, 'docker logs -f my-running-container');
    });

    it('should substitute multiple unique placeholders correctly', () => {
        const cmd = "ansible-playbook -i inventory deploy.yml --extra-vars 'service=<service-name> version=<version-tag>'";
        const result = substitutePlaceholders(cmd, {
            '<service-name>': 'auth-api',
            '<version-tag>': 'v1.4.2'
        });
        assert.strictEqual(result, "ansible-playbook -i inventory deploy.yml --extra-vars 'service=auth-api version=v1.4.2'");
    });

    it('should substitute multiple occurrences of the same placeholder correctly', () => {
        const cmd = 'echo <name> and <name>';
        const result = substitutePlaceholders(cmd, {
            '<name>': 'Jules'
        });
        assert.strictEqual(result, 'echo Jules and Jules');
    });
});
