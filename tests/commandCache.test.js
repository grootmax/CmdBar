import fs from 'fs';
import path from 'path';
import os from 'os';
import { jest } from '@jest/globals';

import {
  isCommandCacheable,
  getCommandTTL,
  isCacheValid,
  loadCache,
  saveCache,
  CommandCacheStore,
} from '../extension/commandCache.js';

// Mock GI and GNOME Shell modules for extension.js imports
const mockSubprocessNew = jest.fn();

jest.unstable_mockModule('gi', () => ({
  St: {
    Clipboard: {
      get_default: () => ({
        set_text: jest.fn(),
        get_text: jest.fn(),
      }),
    },
    ClipboardType: { CLIPBOARD: 1 },
    BoxLayout: class {
      constructor() { this.children = []; }
      add_child(child) { this.children.push(child); }
    },
    Icon: class { constructor(props) { Object.assign(this, props); } },
    Label: class { constructor(props) { Object.assign(this, props); } },
    Button: class {
      constructor(props) {
        Object.assign(this, props);
        this._listeners = {};
      }
      connect(signal, cb) { this._listeners[signal] = cb; }
    },
    Entry: class { get_text() { return ''; } },
  },
  Clutter: {
    Orientation: { HORIZONTAL: 0, VERTICAL: 1 },
    ActorAlign: { CENTER: 0 },
  },
  Gio: {
    Subprocess: { new: mockSubprocessNew },
    SubprocessFlags: { STDOUT_PIPE: 1, STDERR_PIPE: 2, NONE: 0 },
  },
  GLib: {
    getenv: jest.fn(),
    timeout_add: jest.fn(() => 123),
    Source: { remove: jest.fn() },
    PRIORITY_DEFAULT: 0,
    SOURCE_CONTINUE: true,
  },
  GObject: { registerClass: (cls) => cls },
  Meta: {},
  Shell: {},
}), { virtual: true });

jest.unstable_mockModule('resource:///org/gnome/shell/extensions/extension.js', () => ({
  Extension: class {},
}), { virtual: true });

const mockNotify = jest.fn();
jest.unstable_mockModule('resource:///org/gnome/shell/ui/main.js', () => ({
  notify: mockNotify,
  panel: { addToStatusArea: jest.fn() },
}), { virtual: true });

jest.unstable_mockModule('resource:///org/gnome/shell/ui/panelMenu.js', () => ({
  Button: class { constructor() { this.menu = { addMenuItem: jest.fn(), removeAll: jest.fn(), close: jest.fn() }; } },
}), { virtual: true });

jest.unstable_mockModule('resource:///org/gnome/shell/ui/popupMenu.js', () => ({
  PopupBaseMenuItem: class { add_child() {} connect() { return 1; } disconnect() {} destroy() {} },
  PopupMenuItem: class {},
  PopupMenuSection: class { addMenuItem() {} removeAll() {} },
  PopupSeparatorMenuItem: class {},
}), { virtual: true });

jest.unstable_mockModule('resource:///org/gnome/shell/ui/modalDialog.js', () => ({
  ModalDialog: class {},
}), { virtual: true });

const {
  runCommandAsync,
  refreshCommandCache,
  invalidateCommandCache,
  clearCommandCache,
  globalCacheStore,
} = await import('../extension/extension.js');

describe('Command Result Caching Unit Tests', () => {
  let tempDir;
  let cacheFile;

  beforeEach(async () => {
    jest.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdbar-cache-test-'));
    cacheFile = path.join(tempDir, 'cache.json');
    globalCacheStore.cachePath = cacheFile;
    await globalCacheStore.clear();
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 10));
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (e) {}
    }
  });

  describe('1. Command Tagging (cacheable vs realtime)', () => {
    test('identifies cacheable commands correctly', () => {
      expect(isCommandCacheable({ cacheable: true })).toBe(true);
      expect(isCommandCacheable({ type: 'cacheable' })).toBe(true);
      expect(isCommandCacheable({ ttl: 30 })).toBe(true);
      expect(isCommandCacheable({ cache_ttl: 45 })).toBe(true);
      expect(isCommandCacheable({ ttl_seconds: 60 })).toBe(true);
    });

    test('identifies realtime commands correctly', () => {
      expect(isCommandCacheable({ cacheable: false })).toBe(false);
      expect(isCommandCacheable({ type: 'realtime' })).toBe(false);
      expect(isCommandCacheable({ name: 'Deploy', command: 'make deploy' })).toBe(false);
      expect(isCommandCacheable(null)).toBe(false);
      expect(isCommandCacheable(undefined)).toBe(false);
    });
  });

  describe('2. TTL Configuration Per Command', () => {
    test('extracts configured TTL per command', () => {
      expect(getCommandTTL({ ttl: 30 })).toBe(30);
      expect(getCommandTTL({ cache_ttl: 45 })).toBe(45);
      expect(getCommandTTL({ ttl_seconds: 120 })).toBe(120);
      expect(getCommandTTL({}, 60)).toBe(60);
      expect(getCommandTTL(null, 90)).toBe(90);
    });

    test('validates cache entry against TTL window', () => {
      const now = 1000000;
      const validEntry = { timestamp: now - 10000, ttl: 30 }; // 10s old, 30s TTL
      const expiredEntry = { timestamp: now - 40000, ttl: 30 }; // 40s old, 30s TTL

      expect(isCacheValid(validEntry, now)).toBe(true);
      expect(isCacheValid(expiredEntry, now)).toBe(false);
      expect(isCacheValid(null, now)).toBe(false);
    });
  });

  describe('3. Cache Storage (JSON persistence)', () => {
    test('saves and loads cache entries from JSON file', async () => {
      const entries = {
        'git status': {
          key: 'git status',
          command: 'git status',
          stdout: 'On branch main',
          stderr: '',
          exitStatus: '0',
          timestamp: Date.now(),
          ttl: 30,
        },
      };

      await saveCache(entries, cacheFile);
      expect(fs.existsSync(cacheFile)).toBe(true);

      const loaded = await loadCache(cacheFile);
      expect(loaded['git status']).toBeDefined();
      expect(loaded['git status'].stdout).toBe('On branch main');
    });

    test('CommandCacheStore set, get, invalidate, clear, and prune', async () => {
      const store = new CommandCacheStore(cacheFile);
      await store.init();

      await store.set('df -h', 'df -h', { stdout: '/dev/sda1 50%', stderr: '', exitStatus: 0 }, 60);

      const retrieved = store.get('df -h');
      expect(retrieved).toBeDefined();
      expect(retrieved.stdout).toBe('/dev/sda1 50%');

      // Test invalidation
      expect(await store.invalidate('df -h')).toBe(true);
      expect(store.get('df -h')).toBeNull();

      // Test pruning expired entries
      const past = Date.now() - 100000;
      await store.set('expired cmd', 'expired cmd', { stdout: 'old' }, 10, past);
      await store.set('valid cmd', 'valid cmd', { stdout: 'fresh' }, 300, Date.now());

      const prunedCount = await store.prune();
      expect(prunedCount).toBe(1);
      expect(store.get('expired cmd')).toBeNull();
      expect(store.get('valid cmd')).toBeDefined();

      // Test clear
      await store.clear();
      expect(Object.keys(store.entries).length).toBe(0);
    });
  });

  describe('4. Command Result Caching & Manual Refresh in runCommandAsync', () => {
    test('serves cached result on subsequent calls within TTL without spawning process', async () => {
      const cmdObj = { name: 'Git Status', command: 'git status', cacheable: true, ttl: 60, verified: true };

      // Manually populate cache
      await globalCacheStore.set('git status', 'git status', { stdout: 'On branch main', exitStatus: '0' }, 60);

      // Call runCommandAsync
      const result = runCommandAsync('Git Status', 'git status', cmdObj);

      expect(result).toBeDefined();
      expect(result.stdout).toBe('On branch main');
      expect(mockSubprocessNew).not.toHaveBeenCalled();
      expect(mockNotify).toHaveBeenCalledWith(
        expect.stringContaining('Command Succeeded (Cached'),
        expect.stringContaining('On branch main')
      );
    });

    test('forceRefresh bypasses cache and re-executes command', async () => {
      const cmdObj = { name: 'Git Status', command: 'git status', cacheable: true, ttl: 60, verified: true };

      await globalCacheStore.set('git status', 'git status', { stdout: 'Old output', exitStatus: '0' }, 60);

      const mockProc = {
        communicate_utf8_async: jest.fn((input, cancel, cb) => {
          if (cb) cb(mockProc, {});
        }),
        get_successful: () => true,
        get_if_exited: () => true,
        get_exit_status: () => 0,
        communicate_utf8_finish: () => ['Fresh output from git status', ''],
      };
      mockSubprocessNew.mockReturnValue(mockProc);

      refreshCommandCache('Git Status', 'git status', cmdObj);

      expect(mockSubprocessNew).toHaveBeenCalled();
      expect(mockNotify).toHaveBeenCalledWith(
        'Command Refreshed: Git Status',
        expect.stringContaining('Fresh output from git status')
      );

      const updated = globalCacheStore.get('git status');
      expect(updated.stdout).toBe('Fresh output from git status');
    });

    test('realtime commands bypass cache and always execute process', async () => {
      const realtimeCmdObj = { name: 'Deploy', command: 'deploy app', cacheable: false, verified: true };

      await globalCacheStore.set('deploy app', 'deploy app', { stdout: 'Cached deploy' }, 60);

      const mockProc = {
        communicate_utf8_async: jest.fn((input, cancel, cb) => {
          if (cb) cb(mockProc, {});
        }),
        get_successful: () => true,
        get_if_exited: () => true,
        get_exit_status: () => 0,
        communicate_utf8_finish: () => ['Live deploy output', ''],
      };
      mockSubprocessNew.mockReturnValue(mockProc);

      runCommandAsync('Deploy', 'deploy app', realtimeCmdObj);

      expect(mockSubprocessNew).toHaveBeenCalled();
    });

    test('invalidateCommandCache and clearCommandCache helpers', async () => {
      await globalCacheStore.set('uptime', 'uptime', { stdout: 'up 5 days' }, 60);
      await globalCacheStore.set('whoami', 'whoami', { stdout: 'jules' }, 60);

      expect(await invalidateCommandCache('uptime')).toBe(true);
      expect(globalCacheStore.get('uptime')).toBeNull();
      expect(globalCacheStore.get('whoami')).toBeDefined();

      await clearCommandCache();
      expect(globalCacheStore.get('whoami')).toBeNull();
    });
  });
});
