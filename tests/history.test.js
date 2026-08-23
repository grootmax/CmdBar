import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  sanitizeSensitiveData,
  sanitizeHistoryItem,
  addHistoryItem,
  MAX_HISTORY_ITEMS,
} from '../extension/commandProcessor.js';
import {
  loadCommandHistory,
  saveCommandHistory,
  getDefaultHistoryPath,
} from '../extension/configSync.js';

describe('Command History and Recents Tracking Unit Tests', () => {
  let tempDir;
  let historyPath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdbar-history-test-'));
    historyPath = path.join(tempDir, 'subfolder', 'history.json');
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Sensitive Data Sanitization', () => {
    test('should redact sensitive command flags in strings', () => {
      expect(sanitizeSensitiveData('login --password mysecret123')).toContain('[REDACTED]');
      expect(sanitizeSensitiveData('login --password mysecret123')).not.toContain('mysecret123');
      expect(sanitizeSensitiveData('curl -H "Authorization: Bearer secretTokenABC"')).toContain('[REDACTED]');
      expect(sanitizeSensitiveData('curl -H "Authorization: Bearer secretTokenABC"')).not.toContain('secretTokenABC');
      expect(sanitizeSensitiveData('deploy --token=xyz987')).toContain('[REDACTED]');
    });

    test('should sanitize history item parameters and command fields', () => {
      const rawItem = {
        name: 'Deploy API',
        command: 'deploy --password secretPass --token secretToken',
        resolvedCommand: 'deploy --password secretPass --token secretToken',
        parameters: {
          user: 'jules',
          password: 'secretPass123',
          api_key: 'key999',
        },
        timestamp: 100000,
      };

      const sanitized = sanitizeHistoryItem(rawItem);

      expect(sanitized.resolvedCommand).not.toContain('secretPass');
      expect(sanitized.resolvedCommand).toContain('[REDACTED]');
      expect(sanitized.parameters.user).toBe('jules');
      expect(sanitized.parameters.password).toBe('[REDACTED]');
      expect(sanitized.parameters.api_key).toBe('[REDACTED]');
    });
  });

  describe('History List Management & Capacity Limit', () => {
    test('should prepend new items to history', () => {
      let history = [];
      history = addHistoryItem(history, { name: 'Command 1', resolvedCommand: 'echo 1' });
      history = addHistoryItem(history, { name: 'Command 2', resolvedCommand: 'echo 2' });

      expect(history.length).toBe(2);
      expect(history[0].name).toBe('Command 2');
      expect(history[1].name).toBe('Command 1');
    });

    test('should cap history at 50 items (MAX_HISTORY_ITEMS)', () => {
      let history = [];
      for (let i = 1; i <= 60; i++) {
        history = addHistoryItem(history, {
          name: `Command ${i}`,
          resolvedCommand: `echo ${i}`,
        });
      }

      expect(history.length).toBe(MAX_HISTORY_ITEMS);
      expect(history.length).toBe(50);
      expect(history[0].name).toBe('Command 60');
      expect(history[49].name).toBe('Command 11');
    });

    test('should deduplicate re-executed commands and bring latest to top', () => {
      let history = [];
      history = addHistoryItem(history, { name: 'Build', resolvedCommand: 'make build' });
      history = addHistoryItem(history, { name: 'Deploy', resolvedCommand: 'deploy app' });
      history = addHistoryItem(history, { name: 'Build', resolvedCommand: 'make build' });

      expect(history.length).toBe(2);
      expect(history[0].name).toBe('Build');
      expect(history[1].name).toBe('Deploy');
    });
  });

  describe('Atomic Persistence in history.json', () => {
    test('should return empty array when history file does not exist', async () => {
      const history = await loadCommandHistory(historyPath);
      expect(history).toEqual([]);
    });

    test('should save and load command history correctly', async () => {
      const sampleHistory = [
        {
          name: 'Git Checkout',
          command: 'git checkout {branch}',
          resolvedCommand: 'git checkout main',
          parameters: { branch: 'main' },
          timestamp: Date.now(),
        },
      ];

      await saveCommandHistory(sampleHistory, historyPath);
      expect(fs.existsSync(historyPath)).toBe(true);

      const loaded = await loadCommandHistory(historyPath);
      expect(loaded.length).toBe(1);
      expect(loaded[0].name).toBe('Git Checkout');
      expect(loaded[0].resolvedCommand).toBe('git checkout main');
    });

    test('should handle corrupted history file gracefully', async () => {
      fs.mkdirSync(path.dirname(historyPath), { recursive: true });
      fs.writeFileSync(historyPath, '{ invalid json', 'utf8');

      const loaded = await loadCommandHistory(historyPath);
      expect(loaded).toEqual([]);
    });

    test('should allow clearing history file', async () => {
      await saveCommandHistory([{ name: 'Task', resolvedCommand: 'echo 1' }], historyPath);
      await saveCommandHistory([], historyPath);

      const loaded = await loadCommandHistory(historyPath);
      expect(loaded).toEqual([]);
    });
  });
});
