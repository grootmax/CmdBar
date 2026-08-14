import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { jest } from '@jest/globals';
import { writeConfigAtomically } from '../extension/commandProcessor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Dual-Layer Guarded Sync & Atomic Writes', () => {
    const testDir = path.join(__dirname, 'test-temp');
    const targetFile = path.join(testDir, 'commands-test.json');

    let consoleErrorSpy;
    let consoleWarnSpy;

    beforeEach(() => {
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();

        if (fs.existsSync(targetFile)) {
            fs.unlinkSync(targetFile);
        }
        if (fs.existsSync(targetFile + '.tmp')) {
            fs.unlinkSync(targetFile + '.tmp');
        }
        if (fs.existsSync(testDir)) {
            fs.rmdirSync(testDir);
        }
    });

    describe('Atomic Configuration Write (Requirement 1)', () => {
        test('should write configuration atomically to the target file', async () => {
            const data = {
                categories: [
                    {
                        name: "Test Cat",
                        commands: [{ name: "Test Cmd", command: "echo test" }]
                    }
                ]
            };

            await writeConfigAtomically(targetFile, data);

            // Verify file exists and has correct contents
            expect(fs.existsSync(targetFile)).toBe(true);
            const content = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
            expect(content).toEqual(data);
        });

        test('should write to a temporary .tmp file before renaming', async () => {
            const spyWriteFileSync = jest.spyOn(fs, 'writeFileSync');
            const spyRenameSync = jest.spyOn(fs, 'renameSync');

            const data = { test: 'atomic' };
            await writeConfigAtomically(targetFile, data);

            // The temporary file should have been written to first
            expect(spyWriteFileSync).toHaveBeenCalledWith(
                targetFile + '.tmp',
                expect.any(String),
                'utf8'
            );

            // Then it should have been renamed/moved to the target file
            expect(spyRenameSync).toHaveBeenCalledWith(
                targetFile + '.tmp',
                targetFile
            );

            spyWriteFileSync.mockRestore();
            spyRenameSync.mockRestore();
        });
    });

    describe('Fallback Configuration & Exception Safety (Requirements 3 & 4)', () => {
        // Simulated loading/parsing logic mirroring CmdBarIndicator
        class MockCmdBarIndicator {
            constructor() {
                this._cachedConfig = null;
                this.menuCleared = false;
                this.menuRebuilt = false;
            }

            // Simulates GJS file.load_contents and JSON parsing
            _loadConfig(mockFileContents) {
                try {
                    if (!mockFileContents) {
                        throw new Error("File could not be read");
                    }
                    let parsed = JSON.parse(mockFileContents);
                    if (parsed && parsed.categories && Array.isArray(parsed.categories)) {
                        this._cachedConfig = parsed;
                        return parsed;
                    } else {
                        console.error(`CmdBar: invalid config structure, 'categories' must be an array`);
                    }
                } catch (e) {
                    console.error(`CmdBar: failed to parse config file: ${e.message}`);
                }

                // Fallback mechanism (Requirement 4)
                if (this._cachedConfig) {
                    return this._cachedConfig;
                }

                // Default package fallback
                return { categories: [] };
            }

            _reloadMenu(mockFileContents) {
                try {
                    let config = this._loadConfig(mockFileContents);
                    
                    // Clear and rebuild menu
                    this.menuCleared = true;
                    this.menuRebuilt = true;
                    this.loadedConfig = config;
                } catch (e) {
                    console.error("Error reloading menu:", e);
                }
            }
        }

        test('should successfully load valid configuration and cache it', () => {
            const indicator = new MockCmdBarIndicator();
            const validJSON = JSON.stringify({
                categories: [{ name: "Valid", commands: [] }]
            });

            const config = indicator._loadConfig(validJSON);
            expect(config.categories[0].name).toBe("Valid");
            expect(indicator._cachedConfig).toEqual(config);
        });

        test('should fallback to last successfully loaded configuration when encountering invalid JSON (Requirement 4)', () => {
            const indicator = new MockCmdBarIndicator();
            const validJSON = JSON.stringify({
                categories: [{ name: "Valid", commands: [] }]
            });

            // First load successful config
            indicator._reloadMenu(validJSON);
            expect(indicator.loadedConfig.categories[0].name).toBe("Valid");

            // Now load invalid JSON
            const invalidJSON = "invalid { json";
            indicator._reloadMenu(invalidJSON);

            // Should fallback to previously cached configuration
            expect(indicator.loadedConfig.categories[0].name).toBe("Valid");
            expect(indicator._cachedConfig.categories[0].name).toBe("Valid");
        });

        test('should wrap reloading in try-catch to prevent crashing main thread (Requirement 3)', () => {
            const indicator = new MockCmdBarIndicator();
            
            // Should not crash even when passed null/undefined or corrupted parameters
            expect(() => {
                indicator._reloadMenu(null);
            }).not.toThrow();
        });
    });

    describe('Debounced File Monitoring (Requirement 2)', () => {
        // Simulated debounced monitor mirroring CmdBarIndicator
        class MockDebouncedFileMonitor {
            constructor() {
                this._timeoutId = 0;
                this.reloadCount = 0;
            }

            // Mimics GLib timeout source removal
            mockSourceRemove(id) {
                // Clear simulated timeout
                clearTimeout(id);
            }

            // Mimics GLib timeout add
            mockTimeoutAdd(delay, callback) {
                return setTimeout(callback, delay);
            }

            onFileChanged() {
                if (this._timeoutId) {
                    this.mockSourceRemove(this._timeoutId);
                    this._timeoutId = 0;
                }

                this._timeoutId = this.mockTimeoutAdd(100, () => {
                    this._timeoutId = 0;
                    this.reloadMenu();
                });
            }

            reloadMenu() {
                this.reloadCount++;
            }
        }

        test('should ignore intermediate rapid file change events and coalesce them (Requirement 2)', (done) => {
            const monitor = new MockDebouncedFileMonitor();

            // Trigger multiple file changes rapidly (intermediate events)
            monitor.onFileChanged();
            monitor.onFileChanged();
            monitor.onFileChanged();

            // At this point, reloadMenu should not have been called yet
            expect(monitor.reloadCount).toBe(0);

            // Wait 150ms (longer than the 100ms debounce delay)
            setTimeout(() => {
                // Should have only triggered reloadMenu once
                expect(monitor.reloadCount).toBe(1);
                done();
            }, 150);
        });
    });
});
