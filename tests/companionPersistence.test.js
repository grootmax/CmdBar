import fs from 'fs';
import path from 'path';
import os from 'os';
import { jest } from '@jest/globals';
import { 
    getConfigDir, 
    getConfigPath, 
    saveConfigAtomically, 
    saveConfigAtomicallyAsync 
} from '../companion/configStore.js';

describe('Atomic Companion Persistence Tests', () => {
    let testDir;
    let testFile;

    beforeEach(() => {
        // Create a unique temporary directory for each test run to isolate test side-effects
        testDir = path.join(os.tmpdir(), `cmdbar-test-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`);
        testFile = path.join(testDir, 'commands.json');
    });

    afterEach(() => {
        // Clean up any test directory/files
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    describe('Path Resolution', () => {
        test('should resolve configuration directory correctly using defaults', () => {
            const originalXdg = process.env.XDG_CONFIG_HOME;
            delete process.env.XDG_CONFIG_HOME;

            const expectedDir = path.join(os.homedir(), '.config', 'cmdbar');
            expect(getConfigDir()).toBe(expectedDir);

            if (originalXdg) {
                process.env.XDG_CONFIG_HOME = originalXdg;
            }
        });

        test('should respect XDG_CONFIG_HOME environment variable', () => {
            const originalXdg = process.env.XDG_CONFIG_HOME;
            const customXdg = '/tmp/custom-xdg-config';
            process.env.XDG_CONFIG_HOME = customXdg;

            const expectedDir = path.join(customXdg, 'cmdbar');
            expect(getConfigDir()).toBe(expectedDir);

            const expectedPath = path.join(expectedDir, 'commands.json');
            expect(getConfigPath()).toBe(expectedPath);

            if (originalXdg) {
                process.env.XDG_CONFIG_HOME = originalXdg;
            } else {
                delete process.env.XDG_CONFIG_HOME;
            }
        });
    });

    describe('Atomic Writes (Synchronous)', () => {
        test('should write configuration file and ensure directory is created', () => {
            const testData = { categories: [{ name: 'Test', commands: [] }] };

            expect(fs.existsSync(testDir)).toBe(false);
            
            saveConfigAtomically(testData, testFile);

            expect(fs.existsSync(testFile)).toBe(true);
            const content = JSON.parse(fs.readFileSync(testFile, 'utf8'));
            expect(content).toEqual(testData);
        });

        test('should perform write using a temporary file in the same directory before rename', () => {
            const testData = { key: 'value' };
            
            // Spy on fs.writeFileSync and fs.renameSync to verify the atomic swap mechanism
            const writeSpy = jest.spyOn(fs, 'writeFileSync');
            const renameSpy = jest.spyOn(fs, 'renameSync');

            saveConfigAtomically(testData, testFile);

            expect(writeSpy).toHaveBeenCalled();
            expect(renameSpy).toHaveBeenCalled();

            // Verify the write target was indeed a .tmp file in the same directory
            const writePathArg = writeSpy.mock.calls[0][0];
            expect(writePathArg).not.toBe(testFile);
            expect(writePathArg.startsWith(testFile)).toBe(true);
            expect(writePathArg.endsWith('.tmp')).toBe(true);
            expect(path.dirname(writePathArg)).toBe(path.dirname(testFile));

            // Verify the rename swapped the tmp file with the target file
            const [srcRename, destRename] = renameSpy.mock.calls[0];
            expect(srcRename).toBe(writePathArg);
            expect(destRename).toBe(testFile);

            // Clean up spies
            writeSpy.mockRestore();
            renameSpy.mockRestore();
        });

        test('should clean up temporary file if writing fails', () => {
            const testData = { key: 'value' };

            // Mock writeFileSync to throw an error
            const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
                // Ensure a partial temp file is tracked if simulated
                throw new Error('Simulated write failure');
            });

            expect(() => saveConfigAtomically(testData, testFile)).toThrow('Simulated write failure');

            // Verify no temp file left behind in directory
            if (fs.existsSync(testDir)) {
                const files = fs.readdirSync(testDir);
                const tempFiles = files.filter(f => f.endsWith('.tmp'));
                expect(tempFiles.length).toBe(0);
            }

            writeSpy.mockRestore();
        });
    });

    describe('Atomic Writes (Asynchronous)', () => {
        test('should write configuration file asynchronously', async () => {
            const testData = { categories: [{ name: 'Async Test', commands: [] }] };

            expect(fs.existsSync(testDir)).toBe(false);

            await saveConfigAtomicallyAsync(testData, testFile);

            expect(fs.existsSync(testFile)).toBe(true);
            const content = JSON.parse(await fs.promises.readFile(testFile, 'utf8'));
            expect(content).toEqual(testData);
        });

        test('should perform async write using a temporary file in the same directory before rename', async () => {
            const testData = { asyncKey: 'asyncValue' };

            const writeSpy = jest.spyOn(fs.promises, 'writeFile');
            const renameSpy = jest.spyOn(fs.promises, 'rename');

            await saveConfigAtomicallyAsync(testData, testFile);

            expect(writeSpy).toHaveBeenCalled();
            expect(renameSpy).toHaveBeenCalled();

            const writePathArg = writeSpy.mock.calls[0][0];
            expect(writePathArg).not.toBe(testFile);
            expect(writePathArg.startsWith(testFile)).toBe(true);
            expect(writePathArg.endsWith('.tmp')).toBe(true);
            expect(path.dirname(writePathArg)).toBe(path.dirname(testFile));

            const [srcRename, destRename] = renameSpy.mock.calls[0];
            expect(srcRename).toBe(writePathArg);
            expect(destRename).toBe(testFile);

            writeSpy.mockRestore();
            renameSpy.mockRestore();
        });

        test('should clean up temporary file if async writing fails', async () => {
            const testData = { asyncKey: 'asyncValue' };

            const writeSpy = jest.spyOn(fs.promises, 'writeFile').mockRejectedValue(new Error('Simulated async write failure'));

            await expect(saveConfigAtomicallyAsync(testData, testFile)).rejects.toThrow('Simulated async write failure');

            if (fs.existsSync(testDir)) {
                const files = fs.readdirSync(testDir);
                const tempFiles = files.filter(f => f.endsWith('.tmp'));
                expect(tempFiles.length).toBe(0);
            }

            writeSpy.mockRestore();
        });
    });

    describe('Robustness Against Rapid Configuration Saves', () => {
        test('should handle rapid consecutive saves without partial or corrupt reads', async () => {
            // This test simulates multiple concurrent updates (drag-and-drop / rapid reordering).
            // It runs a continuous read loop that reads and parses the target config file,
            // asserting that it NEVER encounters incomplete JSON or syntax crashes.
            fs.mkdirSync(testDir, { recursive: true });
            fs.writeFileSync(testFile, JSON.stringify({ index: -1 }), 'utf8');

            let readerErrorOccurred = false;
            let readCount = 0;

            const readInterval = setInterval(() => {
                try {
                    const data = fs.readFileSync(testFile, 'utf8');
                    // Ensure the JSON is always fully written and valid
                    const parsed = JSON.parse(data);
                    expect(parsed).toHaveProperty('index');
                    readCount++;
                } catch (e) {
                    console.error('Reader encountered syntax error during rapid writes:', e);
                    readerErrorOccurred = true;
                }
            }, 1);

            // Execute 50 rapid sequential atomic writes
            for (let i = 0; i < 50; i++) {
                await saveConfigAtomicallyAsync({ index: i }, testFile);
            }

            clearInterval(readInterval);

            expect(readerErrorOccurred).toBe(false);
            expect(readCount).toBeGreaterThan(0);

            // Check that the final write is correct
            const finalData = JSON.parse(fs.readFileSync(testFile, 'utf8'));
            expect(finalData).toEqual({ index: 49 });
        });
    });
});
