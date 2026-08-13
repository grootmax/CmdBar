import { validateInput, hasPlaceholder, substituteCommand, tokenizeCommand, getPlaceholders, substituteTokens } from '../extension/commandProcessor.js';

describe('CmdBar Extension Core Unit Tests', () => {
    
    describe('Input Verification & Validation', () => {
        test('should block empty text submissions', () => {
            expect(validateInput('')).toBe(false);
            expect(validateInput(null)).toBe(false);
            expect(validateInput(undefined)).toBe(false);
        });

        test('should block whitespace-only submissions', () => {
            expect(validateInput('   ')).toBe(false);
            expect(validateInput('\n\t')).toBe(false);
        });

        test('should allow valid non-empty inputs', () => {
            expect(validateInput('my-task-123')).toBe(true);
            expect(validateInput('  my-task-123  ')).toBe(true);
            expect(validateInput('a')).toBe(true);
            expect(validateInput('12345')).toBe(true);
        });
    });

    describe('Placeholder Parameter Detection', () => {
        test('should detect placeholders with angle brackets <...>', () => {
            expect(hasPlaceholder('echo <task-id>')).toBe(true);
            expect(hasPlaceholder('deploy <service-name>')).toBe(true);
        });

        test('should detect placeholders with double curly braces {{...}}', () => {
            expect(hasPlaceholder('aws ecs update-service --service {{service-name}}')).toBe(true);
        });

        test('should return false if there are no placeholders in the command', () => {
            expect(hasPlaceholder('make build')).toBe(false);
            expect(hasPlaceholder('echo hello')).toBe(false);
            expect(hasPlaceholder('')).toBe(false);
            expect(hasPlaceholder(null)).toBe(false);
        });
    });

    describe('Command Template Substitution', () => {
        test('should substitute values into angle bracket placeholders <...>', () => {
            const template = 'echo Starting task <task-id>';
            const val = 'TFG-999';
            expect(substituteCommand(template, val)).toBe('echo Starting task TFG-999');
        });

        test('should substitute values into double curly braces placeholders {{...}}', () => {
            const template = 'deploy {{service-name}}';
            const val = 'auth-api';
            expect(substituteCommand(template, val)).toBe('deploy auth-api');
        });

        test('should substitute multiple placeholders of the same type', () => {
            const template = 'echo <task-id> and <task-id>';
            const val = '123';
            expect(substituteCommand(template, val)).toBe('echo 123 and 123');
        });

        test('should handle null/undefined inputs gracefully', () => {
            const template = 'echo <task-id>';
            expect(substituteCommand(template, null)).toBe('echo ');
            expect(substituteCommand(template, undefined)).toBe('echo ');
        });

        test('should return empty string if template is invalid', () => {
            expect(substituteCommand(null, 'val')).toBe('');
            expect(substituteCommand(undefined, 'val')).toBe('');
        });
    });

    describe('Command Tokenization', () => {
        test('should tokenize command by space', () => {
            expect(tokenizeCommand('make build')).toEqual(['make', 'build']);
            expect(tokenizeCommand('echo <task-id>')).toEqual(['echo', '<task-id>']);
        });

        test('should handle single and double quotes', () => {
            expect(tokenizeCommand('echo "hello world"')).toEqual(['echo', 'hello world']);
            expect(tokenizeCommand("echo 'hello world'")).toEqual(['echo', 'hello world']);
        });

        test('should handle backslash escapes', () => {
            expect(tokenizeCommand('echo hello\\ world')).toEqual(['echo', 'hello world']);
        });

        test('should handle empty or invalid inputs', () => {
            expect(tokenizeCommand('')).toEqual([]);
            expect(tokenizeCommand(null)).toEqual([]);
            expect(tokenizeCommand(undefined)).toEqual([]);
        });
    });

    describe('Extract Placeholders', () => {
        test('should extract angle brackets and double curly placeholders', () => {
            expect(getPlaceholders('echo <task-id>')).toEqual(['<task-id>']);
            expect(getPlaceholders('deploy {{service-name}}')).toEqual(['{{service-name}}']);
            expect(getPlaceholders('aws ecs update-service --service {{service-name}} --desired-count {{count}}')).toEqual(['{{service-name}}', '{{count}}']);
        });

        test('should handle no placeholders', () => {
            expect(getPlaceholders('make build')).toEqual([]);
            expect(getPlaceholders('')).toEqual([]);
            expect(getPlaceholders(null)).toEqual([]);
        });
    });

    describe('Token Substitution with Mapping', () => {
        test('should substitute mapped values safely', () => {
            const tokens = ['echo', '<task-id>'];
            const map = { '<task-id>': 'hello world; rm -rf /' };
            expect(substituteTokens(tokens, map)).toEqual(['echo', 'hello world; rm -rf /']);
        });

        test('should handle empty or missing maps', () => {
            const tokens = ['make', 'build'];
            expect(substituteTokens(tokens, null)).toEqual(['make', 'build']);
            expect(substituteTokens(tokens, {})).toEqual(['make', 'build']);
        });
    });
});
