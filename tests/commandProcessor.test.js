import { validateInput, hasPlaceholder, substituteCommand, parseEnv } from '../extension/commandProcessor.js';

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

    describe('Environment Parsing', () => {
        test('should handle empty or null/undefined stdout', () => {
            expect(parseEnv(null)).toEqual([]);
            expect(parseEnv(undefined)).toEqual([]);
            expect(parseEnv('')).toEqual([]);
        });

        test('should parse environment variables properly', () => {
            const stdout = 'PATH=/usr/bin:/bin\nUSER=jules\nSHELL=/bin/bash\n';
            expect(parseEnv(stdout)).toEqual([
                'PATH=/usr/bin:/bin',
                'USER=jules',
                'SHELL=/bin/bash'
            ]);
        });

        test('should filter out lines without an equals sign', () => {
            const stdout = 'PATH=/usr/bin\nINVALID_LINE_NO_EQUALS\nHOME=/app\n';
            expect(parseEnv(stdout)).toEqual([
                'PATH=/usr/bin',
                'HOME=/app'
            ]);
        });
    });
});
