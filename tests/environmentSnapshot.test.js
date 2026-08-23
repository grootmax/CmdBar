import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  exportEnvironmentSnapshot,
  validateSnapshotSchema,
  importEnvironmentSnapshot,
  createBackup,
  listBackups,
  restoreFromBackup,
  deleteBackup,
  encodeShareablePayload,
  decodeShareablePayload,
  shareSnapshotToCloud,
  fetchSnapshotFromCloud,
  mergeConfigs,
  mergeHistories,
  encryptPayload,
  decryptPayload
} from '../extension/environmentSnapshot.js';
import { saveConfig, saveClipboardHistory } from '../extension/configSync.js';

describe('Environment Snapshots Unit & Integration Tests', () => {
  let tempDir;
  let configPath;
  let clipboardPath;
  let stylesheetPath;
  let backupsDir;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdbar-snapshot-test-'));
    configPath = path.join(tempDir, 'config.json');
    clipboardPath = path.join(tempDir, 'clipboard_history.json');
    stylesheetPath = path.join(tempDir, 'stylesheet.css');
    backupsDir = path.join(tempDir, 'backups');

    fs.mkdirSync(backupsDir, { recursive: true });

    // Seed test config
    const sampleConfig = {
      categories: [
        {
          name: 'Development',
          commands: [
            { name: 'Git Log', command: 'git log -n 5' },
            { name: 'Docker Ps', command: 'docker ps' }
          ]
        }
      ],
      ai: { provider: 'openai', model: 'gpt-4o' }
    };
    await saveConfig(sampleConfig, configPath);

    // Seed test clipboard history
    const sampleHistory = [
      { text: 'git status', command: 'git status', timestamp: Date.now() },
      { text: 'npm test', command: 'npm test', timestamp: Date.now() }
    ];
    await saveClipboardHistory(sampleHistory, clipboardPath);

    // Seed stylesheet
    fs.writeFileSync(stylesheetPath, '.cmdbar-button { color: #3584e4; }', 'utf8');
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Export & Validation', () => {
    test('should export full environment snapshot to object', async () => {
      const snap = await exportEnvironmentSnapshot({
        configPath,
        clipboardPath,
        stylesheetPath,
        description: 'Test Export'
      });

      expect(snap.$schema).toBe('cmdbar-environment-snapshot/v1');
      expect(snap.version).toBe(1);
      expect(snap.snapshot_id).toMatch(/^snap_\d+_[a-f0-9]+$/);
      expect(snap.description).toBe('Test Export');
      expect(snap.config.categories.length).toBe(1);
      expect(snap.history.clipboard.length).toBe(2);
      expect(snap.themes.custom_stylesheet).toBe('.cmdbar-button { color: #3584e4; }');
      expect(snap.signature).toBeDefined();
    });

    test('should export snapshot directly to output file', async () => {
      const outFile = path.join(tempDir, 'exported_snapshot.json');
      const snap = await exportEnvironmentSnapshot({
        configPath,
        clipboardPath,
        stylesheetPath,
        outputPath: outFile
      });

      expect(fs.existsSync(outFile)).toBe(true);
      const fileData = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      expect(fileData.snapshot_id).toBe(snap.snapshot_id);
    });

    test('should validate valid snapshot schema and signature', async () => {
      const snap = await exportEnvironmentSnapshot({
        configPath,
        clipboardPath,
        stylesheetPath
      });

      const res = validateSnapshotSchema(snap);
      expect(res.valid).toBe(true);
      expect(res.snapshot.snapshot_id).toBe(snap.snapshot_id);
    });

    test('should detect signature tampering in snapshot', async () => {
      const snap = await exportEnvironmentSnapshot({
        configPath,
        clipboardPath,
        stylesheetPath
      });

      snap.config.categories.push({ name: 'Hacked', commands: [] });

      const res = validateSnapshotSchema(snap);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Cryptographic signature mismatch');
    });

    test('should encrypt snapshot with passphrase and decrypt during validation', async () => {
      const passphrase = 'SuperSecretPassphrase123!';
      const snap = await exportEnvironmentSnapshot({
        configPath,
        clipboardPath,
        stylesheetPath,
        passphrase
      });

      expect(snap.encrypted_payload).toBeDefined();
      expect(snap.config).toBeUndefined(); // Config is hidden inside payload

      // Validating without passphrase should fail
      const noPassRes = validateSnapshotSchema(snap);
      expect(noPassRes.valid).toBe(false);
      expect(noPassRes.error).toContain('Passphrase required');

      // Validating with wrong passphrase should fail
      const wrongPassRes = validateSnapshotSchema(snap, 'WrongPassphrase');
      expect(wrongPassRes.valid).toBe(false);

      // Validating with correct passphrase should succeed
      const validRes = validateSnapshotSchema(snap, passphrase);
      expect(validRes.valid).toBe(true);
      expect(validRes.snapshot.config.categories.length).toBe(1);
    });
  });

  describe('Import & Merging Modes', () => {
    test('should import snapshot in replace mode', async () => {
      const newConfigPath = path.join(tempDir, 'new_config.json');
      const newClipPath = path.join(tempDir, 'new_clip.json');
      const newStylePath = path.join(tempDir, 'new_style.css');

      const snapshot = await exportEnvironmentSnapshot({
        configPath,
        clipboardPath,
        stylesheetPath
      });

      const res = await importEnvironmentSnapshot(snapshot, {
        mode: 'replace',
        configPath: newConfigPath,
        clipboardPath: newClipPath,
        stylesheetPath: newStylePath,
        backupsDir
      });

      expect(res.success).toBe(true);
      expect(fs.existsSync(newConfigPath)).toBe(true);
      expect(fs.existsSync(newClipPath)).toBe(true);
      expect(fs.existsSync(newStylePath)).toBe(true);
    });

    test('should merge configs without overwriting existing unique entries', () => {
      const target = {
        categories: [
          { name: 'Dev', commands: [{ name: 'Test', command: 'npm test' }] }
        ]
      };
      const source = {
        categories: [
          { name: 'Dev', commands: [{ name: 'Build', command: 'npm run build' }] },
          { name: 'Ops', commands: [{ name: 'Status', command: 'systemctl status' }] }
        ]
      };

      const merged = mergeConfigs(target, source);
      expect(merged.categories.length).toBe(2);
      const devCat = merged.categories.find(c => c.name === 'Dev');
      expect(devCat.commands.length).toBe(2);
    });

    test('should merge history entries deduplicating items', () => {
      const target = ['git status', 'git diff'];
      const source = ['git diff', 'git commit'];

      const merged = mergeHistories(target, source);
      expect(merged).toEqual(['git status', 'git diff', 'git commit']);
    });
  });

  describe('Backup & Restore Operations', () => {
    test('should create backup and list backups sorted by date', async () => {
      const b1 = await createBackup({ backupsDir, description: 'Backup 1', configPath, clipboardPath, stylesheetPath });
      expect(b1.success).toBe(true);

      const list = listBackups(backupsDir);
      expect(list.length).toBe(1);
      expect(list[0].description).toBe('Backup 1');
    });

    test('should restore environment from backup file', async () => {
      const b1 = await createBackup({ backupsDir, description: 'Backup To Restore', configPath, clipboardPath, stylesheetPath });

      // Modify active config
      await saveConfig({ categories: [] }, configPath);

      const restoreRes = await restoreFromBackup(b1.backup_path, {
        configPath,
        clipboardPath,
        stylesheetPath,
        backupsDir
      });

      expect(restoreRes.success).toBe(true);
      const restoredConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      expect(restoredConfig.categories.length).toBe(1);
    });

    test('should delete backup', async () => {
      const b1 = await createBackup({ backupsDir, description: 'To Delete', configPath, clipboardPath, stylesheetPath });
      expect(listBackups(backupsDir).length).toBe(1);

      const deleted = deleteBackup(b1.backup_path, backupsDir);
      expect(deleted).toBe(true);
      expect(listBackups(backupsDir).length).toBe(0);
    });
  });

  describe('Cloud Sharing & Payload Encoding', () => {
    test('should encode and decode shareable snapshot link payload', async () => {
      const snap = await exportEnvironmentSnapshot({ configPath, clipboardPath, stylesheetPath });
      const encoded = encodeShareablePayload(snap);
      expect(encoded.startsWith('cmdbar-snap://')).toBe(true);

      const decoded = decodeShareablePayload(encoded);
      expect(decoded.snapshot_id).toBe(snap.snapshot_id);
    });

    test('should share and fetch snapshot via cloud config', async () => {
      const snap = await exportEnvironmentSnapshot({ configPath, clipboardPath, stylesheetPath });
      const cloudRes = await shareSnapshotToCloud(snap);
      expect(cloudRes.success).toBe(true);

      const fetched = await fetchSnapshotFromCloud({ shareLink: cloudRes.shareable_link });
      expect(fetched.snapshot_id).toBe(snap.snapshot_id);
    });
  });

  describe('Performance Benchmark', () => {
    test('export and import operations should complete in < 100ms', async () => {
      const startExport = performance.now();
      const snap = await exportEnvironmentSnapshot({ configPath, clipboardPath, stylesheetPath });
      const exportTime = performance.now() - startExport;

      const startImport = performance.now();
      await importEnvironmentSnapshot(snap, {
        mode: 'replace',
        configPath,
        clipboardPath,
        stylesheetPath,
        backupsDir,
        createBackupBeforeImport: false
      });
      const importTime = performance.now() - startImport;

      expect(exportTime).toBeLessThan(100);
      expect(importTime).toBeLessThan(100);
    });
  });
});
