import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  createSnapshot,
  exportSnapshotToFile,
  importSnapshot,
  importSnapshotFromFile,
  validateSnapshotSchema,
  createBackup,
  restoreBackup,
  shareSnapshotToCloud,
  fetchSnapshotFromCloud,
} from '../extension/environmentSnapshot.js';
import { DEFAULT_CONFIG, loadConfig, saveConfig, loadClipboardHistory, saveClipboardHistory } from '../extension/configSync.js';

describe('Environment Snapshots Unit & Integration Tests', () => {
  let tempDir;
  let tempConfigPath;
  let tempClipboardPath;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdbar-snap-test-'));
    tempConfigPath = path.join(tempDir, 'config.json');
    tempClipboardPath = path.join(tempDir, 'clipboard.json');

    await saveConfig(DEFAULT_CONFIG, tempConfigPath);
    await saveClipboardHistory([{ text: 'copied-item-1', timestamp: 1000 }], tempClipboardPath);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('validateSnapshotSchema detects valid and invalid payloads', () => {
    expect(validateSnapshotSchema(null)).toBe(false);
    expect(validateSnapshotSchema({})).toBe(false);
    expect(validateSnapshotSchema({ version: 123, type: 'cmdbar_environment_snapshot' })).toBe(false);

    const validSnapshot = {
      version: '1.0',
      type: 'cmdbar_environment_snapshot',
      config: DEFAULT_CONFIG,
      history: { clipboard_history: [], command_history: [] },
      themes: { active_theme: 'default' },
    };

    expect(validateSnapshotSchema(validSnapshot)).toBe(true);

    expect(validateSnapshotSchema({ ...validSnapshot, type: 'invalid_type' })).toBe(false);
    expect(validateSnapshotSchema({ ...validSnapshot, config: null })).toBe(false);
    expect(validateSnapshotSchema({ ...validSnapshot, history: 'not_an_object' })).toBe(false);
    expect(validateSnapshotSchema({ ...validSnapshot, history: { clipboard_history: 'invalid' } })).toBe(false);
    expect(validateSnapshotSchema({ ...validSnapshot, history: { command_history: 'invalid' } })).toBe(false);
    expect(validateSnapshotSchema({ ...validSnapshot, themes: 'invalid' })).toBe(false);
  });

  test('createSnapshot builds correct structure and signature', async () => {
    const snapshot = await createSnapshot({
      configPath: tempConfigPath,
      clipboardPath: tempClipboardPath,
      description: 'Test Snapshot',
    });

    expect(snapshot.version).toBe('1.0');
    expect(snapshot.type).toBe('cmdbar_environment_snapshot');
    expect(snapshot.description).toBe('Test Snapshot');
    expect(snapshot.config).toBeDefined();
    expect(snapshot.history.clipboard_history.length).toBe(1);
    expect(snapshot.signature).toBeDefined();
    expect(typeof snapshot.signature).toBe('string');
  });

  test('exportSnapshotToFile and importSnapshotFromFile work end-to-end', async () => {
    const snapshotFile = path.join(tempDir, 'snapshot.json');

    await exportSnapshotToFile(snapshotFile, {
      configPath: tempConfigPath,
      clipboardPath: tempClipboardPath,
      description: 'Export File Test',
    });

    expect(fs.existsSync(snapshotFile)).toBe(true);

    // Modify current config to test restore
    const modifiedConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    modifiedConfig.categories = [];
    await saveConfig(modifiedConfig, tempConfigPath);

    const result = await importSnapshotFromFile(snapshotFile, {
      configPath: tempConfigPath,
      clipboardPath: tempClipboardPath,
      mode: 'overwrite',
      backup: true,
      backupDir: tempDir,
    });

    expect(result.success).toBe(true);
    expect(result.restored.categoriesCount).toBe(DEFAULT_CONFIG.categories.length);

    const restoredConfig = await loadConfig(tempConfigPath);
    expect(restoredConfig.categories.length).toBe(DEFAULT_CONFIG.categories.length);
  });

  test('exportSnapshotToFile and importSnapshotFromFile error cases', async () => {
    await expect(exportSnapshotToFile(null)).rejects.toThrow('Invalid target snapshot file path');
    await expect(importSnapshotFromFile(null)).rejects.toThrow('Invalid snapshot file path');

    const invalidJsonFile = path.join(tempDir, 'corrupt.json');
    fs.writeFileSync(invalidJsonFile, '{ invalid json');
    await expect(importSnapshotFromFile(invalidJsonFile)).rejects.toThrow('Failed to parse snapshot file JSON');

    const invalidSchemaFile = path.join(tempDir, 'invalid_schema.json');
    fs.writeFileSync(invalidSchemaFile, JSON.stringify({ version: '1.0' }));
    await expect(importSnapshotFromFile(invalidSchemaFile)).rejects.toThrow('Invalid environment snapshot schema');
  });

  test('importSnapshot in merge mode combines categories, commands, env_profiles, allowed_binaries, and shortcuts', async () => {
    const currentConfig = await loadConfig(tempConfigPath);
    currentConfig.categories.push({
      name: 'Custom Category',
      commands: [{ name: 'Custom Cmd 1', command: 'echo 1' }],
    });
    currentConfig.allowed_binaries = ['/bin/ls'];
    currentConfig.shortcuts = [{ name: 'sc1', key: '<Super>k' }];
    currentConfig.env_profiles = { dev: { PORT: '8080' } };
    await saveConfig(currentConfig, tempConfigPath);

    const snapshotData = await createSnapshot({
      configPath: tempConfigPath,
      clipboardPath: tempClipboardPath,
    });

    snapshotData.config.categories.push({
      name: 'Custom Category',
      commands: [
        { name: 'Custom Cmd 1', command: 'echo 1' },
        { name: 'Custom Cmd 2', command: 'echo 2' },
      ],
    });
    snapshotData.config.categories.push({
      name: 'New Cloud Category',
      commands: [{ name: 'Cloud Cmd', command: 'curl example.com' }],
    });
    snapshotData.config.allowed_binaries = ['/bin/ls', '/bin/cat'];
    snapshotData.config.shortcuts = [{ name: 'sc2', key: '<Super>j' }];
    snapshotData.config.env_profiles = { prod: { PORT: '443' } };

    snapshotData.history.clipboard_history = ['raw-string-item-1', { text: 'new-clipboard-item' }];

    const result = await importSnapshot(snapshotData, {
      configPath: tempConfigPath,
      clipboardPath: tempClipboardPath,
      mode: 'merge',
      backup: false,
    });

    expect(result.success).toBe(true);
    expect(result.mode).toBe('merge');

    const mergedConfig = await loadConfig(tempConfigPath);
    const customCat = mergedConfig.categories.find((c) => c.name === 'Custom Category');
    expect(customCat).toBeDefined();
    expect(customCat.commands.length).toBe(2);

    expect(mergedConfig.allowed_binaries).toContain('/bin/cat');
    expect(mergedConfig.env_profiles.prod).toBeDefined();

    const mergedClipboard = await loadClipboardHistory(tempClipboardPath);
    expect(mergedClipboard.length).toBeGreaterThanOrEqual(2);
  });

  test('createBackup and restoreBackup function properly', async () => {
    const backupPath = await createBackup(tempDir, {
      configPath: tempConfigPath,
      clipboardPath: tempClipboardPath,
    });

    expect(fs.existsSync(backupPath)).toBe(true);

    const restoreResult = await restoreBackup(backupPath, {
      configPath: tempConfigPath,
      clipboardPath: tempClipboardPath,
    });

    expect(restoreResult.success).toBe(true);
  });

  test('shareSnapshotToCloud and fetchSnapshotFromCloud simulate remote sharing and options', async () => {
    const snapshot = await createSnapshot({
      configPath: tempConfigPath,
      clipboardPath: tempClipboardPath,
    });

    const shareRes = await shareSnapshotToCloud(snapshot);
    expect(shareRes.success).toBe(true);
    expect(shareRes.share_id).toBeDefined();
    expect(shareRes.url).toContain(shareRes.share_id);

    const mockClient = {
      share: async (snap, ep) => ({ success: true, share_id: 'mock_123', url: 'https://mock.cloud/s/123' }),
      fetch: async (id, ep) => snapshot,
    };

    const mockShare = await shareSnapshotToCloud(snapshot, null, { mockClient });
    expect(mockShare.share_id).toBe('mock_123');

    const mockFetch = await fetchSnapshotFromCloud('mock_123', null, {
      mockClient,
      autoImport: true,
      configPath: tempConfigPath,
      clipboardPath: tempClipboardPath,
    });

    expect(mockFetch.snapshot).toBeDefined();
    expect(mockFetch.importResult.success).toBe(true);

    const noImportFetch = await fetchSnapshotFromCloud('mock_123', null, {
      mockClient,
      autoImport: false,
    });
    expect(noImportFetch.importResult).toBeUndefined();

    await expect(shareSnapshotToCloud(null)).rejects.toThrow('Invalid environment snapshot for cloud sharing');
    await expect(fetchSnapshotFromCloud(null)).rejects.toThrow('Invalid cloud snapshot URL or ID');
  });

  test('Performance Benchmark: Export and import complete in under 100ms', async () => {
    const startExport = performance.now();
    const snapshot = await createSnapshot({
      configPath: tempConfigPath,
      clipboardPath: tempClipboardPath,
    });
    const exportTime = performance.now() - startExport;

    const startImport = performance.now();
    await importSnapshot(snapshot, {
      configPath: tempConfigPath,
      clipboardPath: tempClipboardPath,
      mode: 'overwrite',
      backup: false,
    });
    const importTime = performance.now() - startImport;

    expect(exportTime).toBeLessThan(100);
    expect(importTime).toBeLessThan(100);
  });
});
