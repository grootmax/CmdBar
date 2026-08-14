import fs from 'fs';
import path from 'path';
import os from 'os';
import { 
    validateConfigSchema, 
    loadConfig, 
    saveConfig, 
    acquireLock, 
    releaseLock, 
    DEFAULT_CONFIG 
} from '../extension/configSync.js';

describe('Lock-File Synchronization and Recovery Unit Tests', () => {
    let tempDir;
    let configPath;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdbar-test-'));
        configPath = path.join(tempDir, 'subfolder', 'commands.json');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
    });

    afterEach(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe('Schema and Parsing Validation', () => {
        test('should validate correct config structures', () => {
            const valid = {
                categories: [
                    {
                        name: 'My Category',
                        commands: [
                            { name: 'Build', command: 'make build' },
                            { name: 'Deploy', command: 'deploy <target>', placeholder: 'target' }
                        ]
                    }
                ]
            };
            expect(validateConfigSchema(valid)).toBe(true);
            expect(validateConfigSchema(DEFAULT_CONFIG)).toBe(true);
        });

        test('should reject malformed configurations', () => {
            expect(validateConfigSchema(null)).toBe(false);
            expect(validateConfigSchema({})).toBe(false);
            expect(validateConfigSchema({ categories: 'not-an-array' })).toBe(false);
            expect(validateConfigSchema({ categories: [{ name: '', commands: [] }] })).toBe(false);
            expect(validateConfigSchema({ categories: [{ name: 'Test', commands: [{ name: '', command: 'echo' }] }] })).toBe(false);
        });
    });

    describe('Asynchronous Dynamic Initialization', () => {
        test('should automatically create parent directory and default config file on first load', async () => {
            const loaded = await loadConfig(configPath);
            expect(fs.existsSync(configPath)).toBe(true);
            expect(loaded).toEqual(DEFAULT_CONFIG);
        });
    });

    describe('Atomic Write-and-Replace', () => {
        test('should update configuration files atomically', async () => {
            const updatedConfig = {
                categories: [
                    {
                        name: 'New Projects',
                        commands: [{ name: 'Run', command: 'npm start' }]
                    }
                ]
            };
            await saveConfig(updatedConfig, configPath);
            const content = fs.readFileSync(configPath, 'utf8');
            expect(JSON.parse(content)).toEqual(updatedConfig);
        });

        test('should fail to save if configuration does not match schema', async () => {
            const badConfig = { categories: [{ name: 'Bad', commands: [{ name: '', command: '' }] }] };
            await expect(saveConfig(badConfig, configPath)).rejects.toThrow();
        });
    });

    describe('Cooperative Lock-File Synchronization', () => {
        test('should serialize simultaneous write attempts and prevent concurrent writes', async () => {
            const lockPath = configPath + '.lock';
            
            // Acquire lock 1
            await acquireLock(lockPath, 100);
            
            // Attempting to acquire lock 2 immediately should timeout/fail
            let threw = false;
            try {
                await acquireLock(lockPath, 50);
            } catch (err) {
                if (err.message.includes('Lock acquisition timeout')) {
                    threw = true;
                }
            }
            expect(threw).toBe(true);
            
            // Release lock 1
            await releaseLock(lockPath);
            
            // Now lock 2 should succeed
            const success = await acquireLock(lockPath, 50);
            expect(success).toBe(true);
            await releaseLock(lockPath);
        });

        test('should automatically recover from stale lock files', async () => {
            const lockPath = configPath + '.lock';
            
            // Create a stale lock file (write time in the past)
            fs.writeFileSync(lockPath, JSON.stringify({ pid: 1234, timestamp: Date.now() - 5000 }));
            const pastTime = (Date.now() - 5000) / 1000;
            fs.utimesSync(lockPath, pastTime, pastTime);

            // Attempting to acquire lock should bypass the stale lock and succeed
            const success = await acquireLock(lockPath, 100);
            expect(success).toBe(true);
            await releaseLock(lockPath);
        });
    });

    describe('Automated Recovery from Corruption', () => {
        test('should archive corrupted json structure and recreate clean default file', async () => {
            fs.mkdirSync(path.dirname(configPath), { recursive: true });
            fs.writeFileSync(configPath, 'corrupted data { {');

            const loaded = await loadConfig(configPath);
            expect(loaded).toEqual(DEFAULT_CONFIG);

            const backupPath = configPath + '.bak';
            expect(fs.existsSync(backupPath)).toBe(true);
            expect(fs.readFileSync(backupPath, 'utf8')).toBe('corrupted data { {');
        });

        test('should archive json structure that does not match schema and recreate clean default file', async () => {
            fs.mkdirSync(path.dirname(configPath), { recursive: true });
            const invalidSchemaObj = { categories: [{ name: 'invalid-cmd', commands: [{ name: 'foo' }] }] };
            fs.writeFileSync(configPath, JSON.stringify(invalidSchemaObj));

            const loaded = await loadConfig(configPath);
            expect(loaded).toEqual(DEFAULT_CONFIG);

            const backupPath = configPath + '.bak';
            expect(fs.existsSync(backupPath)).toBe(true);
            expect(JSON.parse(fs.readFileSync(backupPath, 'utf8'))).toEqual(invalidSchemaObj);
        });
    });
});
