import fs from 'fs';
import path from 'path';

describe('Plasma Plasmoid QML/JS Logic Unit Tests', () => {
    let CmdBarLogic;

    beforeAll(() => {
        const jsPath = path.resolve('kde-plasma/contents/code/cmdbar_plasma.js');
        let code = fs.readFileSync(jsPath, 'utf8');
        // Remove .pragma library for Node environment evaluation
        code = code.replace('.pragma library', '');
        
        const contextFn = new Function(`
            ${code}
            return {
                fuzzyMatch: fuzzyMatch,
                hasPlaceholders: hasPlaceholders,
                substitutePlaceholders: substitutePlaceholders,
                isAiPrompt: isAiPrompt,
                cleanAiPrompt: cleanAiPrompt,
                filterCommands: filterCommands,
                formatOutput: formatOutput
            };
        `);
        CmdBarLogic = contextFn();
    });

    test('should fuzzy match search queries', () => {
        const match = CmdBarLogic.fuzzyMatch('git', 'git status');
        expect(match.matched).toBe(true);
        expect(match.score).toBeGreaterThan(0);

        const noMatch = CmdBarLogic.fuzzyMatch('xyz', 'git status');
        expect(noMatch.matched).toBe(false);
    });

    test('should detect placeholders in command templates', () => {
        expect(CmdBarLogic.hasPlaceholders('echo <task>')).toBe(true);
        expect(CmdBarLogic.hasPlaceholders('echo {{service}}')).toBe(true);
        expect(CmdBarLogic.hasPlaceholders('echo {branch}')).toBe(true);
        expect(CmdBarLogic.hasPlaceholders('make build')).toBe(false);
    });

    test('should substitute placeholder values into templates', () => {
        expect(CmdBarLogic.substitutePlaceholders('echo <task>', '123')).toBe('echo 123');
        expect(CmdBarLogic.substitutePlaceholders('deploy {{service}}', 'auth')).toBe('deploy auth');
    });

    test('should identify and clean AI prompts', () => {
        expect(CmdBarLogic.isAiPrompt('/ai build docker image')).toBe(true);
        expect(CmdBarLogic.isAiPrompt('make build')).toBe(false);
        expect(CmdBarLogic.cleanAiPrompt('/ai deploy to staging')).toBe('deploy to staging');
    });

    test('should filter categories and commands by search query', () => {
        const categories = [
            {
                name: 'Dev',
                commands: [
                    { name: 'Git Status', command: 'git status' },
                    { name: 'Build App', command: 'make build' }
                ]
            }
        ];

        const filtered = CmdBarLogic.filterCommands(categories, 'git');
        expect(filtered.length).toBe(1);
        expect(filtered[0].commands.length).toBe(1);
        expect(filtered[0].commands[0].name).toBe('Git Status');
    });

    test('should format JSON raw output', () => {
        const rawJson = '{"status":"ok","code":200}';
        const formatted = CmdBarLogic.formatOutput(rawJson);
        expect(formatted).toContain('{\n  "status": "ok"');
    });
});
