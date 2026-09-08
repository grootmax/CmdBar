import fs from 'fs';
import path from 'path';
import os from 'os';
import { jest } from '@jest/globals';

const mockSubprocessNew = jest.fn();
const mockGetenv = jest.fn();
const mockSetText = jest.fn();
const mockNotify = jest.fn();

jest.unstable_mockModule('gi', () => ({
  St: {
    Clipboard: {
      get_default: () => ({
        set_text: mockSetText,
        get_text: jest.fn(),
      }),
    },
    ClipboardType: { CLIPBOARD: 1 },
    BoxLayout: class {
      constructor(props) {
        Object.assign(this, props);
        this.children = [];
      }
      add_child(child) {
        this.children.push(child);
      }
    },
    Icon: class {
      constructor(props) {
        Object.assign(this, props);
      }
    },
    Label: class {
      constructor(props) {
        Object.assign(this, props);
      }
    },
    Button: class {
      constructor(props) {
        Object.assign(this, props);
        this._listeners = {};
      }
      connect(signal, cb) {
        this._listeners[signal] = cb;
        return 1;
      }
      click() {
        if (this._listeners['clicked']) this._listeners['clicked']();
      }
    },
    Entry: class {
      constructor(props) {
        Object.assign(this, props);
        this.text = props ? props.text || "" : "";
        this._listeners = {};
        this.clutter_text = {
          connect: (signal, cb) => {
            this._listeners[signal] = cb;
          },
        };
      }
      get_text() {
        return this.text;
      }
      set_text(val) {
        this.text = val;
        if (this._listeners["text-changed"])
          this._listeners["text-changed"]();
      }
    },
  },
  Clutter: {
    Orientation: { HORIZONTAL: 0, VERTICAL: 1 },
    ActorAlign: { CENTER: 0 },
    KEY_f: 102,
    KEY_F: 70,
    KEY_asterisk: 42,
    KEY_Escape: 65307,
    EVENT_STOP: true,
    EVENT_PROPAGATE: false,
  },
  Gio: {
    Subprocess: { new: mockSubprocessNew },
    SubprocessFlags: { STDIN_PIPE: 1, STDERR_PIPE: 2, STDOUT_PIPE: 4, NONE: 0 },
  },
  GLib: {
    getenv: mockGetenv,
    get_user_config_dir: jest.fn(),
    build_filenamev: (arr) => arr.join('/'),
    timeout_add: jest.fn(() => 123),
    Source: { remove: jest.fn() },
    PRIORITY_DEFAULT: 0,
  },
  GObject: {
    registerClass: (cls) => cls,
  },
  Meta: { KeyBindingFlags: { NONE: 0 } },
  Shell: { ActionMode: { ALL: 1 } },
}), { virtual: true });

jest.unstable_mockModule('resource:///org/gnome/shell/extensions/extension.js', () => ({
  Extension: class {
    getSettings() {
      return {
        get_boolean: () => true,
        get_string: () => '',
        get_strv: () => ['<Super>space'],
        connect: () => 1,
        disconnect: () => {},
      };
    }
  },
}), { virtual: true });

jest.unstable_mockModule('resource:///org/gnome/shell/ui/main.js', () => ({
  notify: mockNotify,
  panel: { addToStatusArea: jest.fn() },
  wm: { addKeybinding: jest.fn(), removeKeybinding: jest.fn() },
}), { virtual: true });

jest.unstable_mockModule('resource:///org/gnome/shell/ui/panelMenu.js', () => ({
  Button: class {
    constructor() {
      this.menu = {
        items: [],
        removeAll() {
          this.items = [];
        },
        addMenuItem(item) {
          this.items.push(item);
        },
      };
    }
    destroy() {}
  },
}), { virtual: true });

jest.unstable_mockModule('resource:///org/gnome/shell/ui/popupMenu.js', () => ({
  PopupBaseMenuItem: class {
    constructor(...args) {
      this._listeners = {};
      if (typeof this._init === 'function') {
        this._init(...args);
      }
    }
    _init() {}
    add_child(child) {
      this.children = this.children || [];
      this.children.push(child);
    }
    connect(signal, cb) {
      this._listeners[signal] = cb;
      return 1;
    }
    disconnect() {}
    destroy() {}
  },
  PopupMenuItem: class {
    constructor(text) {
      this.text = text;
      this.label = { text };
    }
    _init(text) {
      this.text = text;
      this.label = { text };
    }
  },
  PopupSeparatorMenuItem: class {
    constructor() {}
    _init() {}
  },
}), { virtual: true });

jest.unstable_mockModule('resource:///org/gnome/shell/ui/modalDialog.js', () => ({
  ModalDialog: class {},
}), { virtual: true });

const { validateConfigSchema, loadConfig, saveConfig } = await import('../extension/configSync.js');
const CmdBarExtension = (await import('../extension/extension.js')).default;

describe('Command Favorites and Pinning Unit Tests', () => {
  let tempDir;
  let configPath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdbar-fav-test-'));
    configPath = path.join(tempDir, 'cmdbar', 'config.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('validateConfigSchema allows favorite and pinned boolean properties', () => {
    const validConfig = {
      categories: [
        {
          name: 'Dev',
          commands: [
            { name: 'Build', command: 'make build', favorite: true },
            { name: 'Test', command: 'npm test', pinned: false },
          ],
        },
      ],
    };
    expect(validateConfigSchema(validConfig)).toBe(true);

    const invalidConfig = {
      categories: [
        {
          name: 'Dev',
          commands: [{ name: 'Build', command: 'make build', favorite: 'invalid-type' }],
        },
      ],
    };
    expect(validateConfigSchema(invalidConfig)).toBe(false);
  });

  test('persist and load favorite commands in config file', async () => {
    const configData = {
      categories: [
        {
          name: 'Projects',
          commands: [
            { name: 'Build', command: 'make build', favorite: true },
            { name: 'Deploy', command: 'deploy <app>', placeholder: 'app', favorite: false },
          ],
        },
      ],
    };

    await saveConfig(configData, configPath);
    const loaded = await loadConfig(configPath);
    expect(loaded.categories[0].commands[0].favorite).toBe(true);
    expect(loaded.categories[0].commands[1].favorite).toBe(false);
  });

  test('extension indicator generates Favorites category at top and sorts favorites first', async () => {
    const testConfig = {
      categories: [
        {
          name: 'Tools',
          commands: [
            { name: 'Command A', command: 'echo A', favorite: false },
            { name: 'Command B', command: 'echo B', favorite: true },
          ],
        },
      ],
    };
    await saveConfig(testConfig, configPath);

    const ext = new CmdBarExtension();
    ext.enable();

    // Override config path getter
    ext._indicator._getConfigPath = () => configPath;
    await ext._indicator._reloadMenu();

    const items = ext._indicator.menu.items;
    // Search entry & separator at index 0 & 1, then "Favorites" header at index 2, then favorited Command B
    expect(items.length).toBeGreaterThan(3);
    const favHeader = items.find((item) => item.label && item.label.text === 'Favorites');
    expect(favHeader).toBeDefined();
    expect(favHeader.label.text).toBe('Favorites');

    const favHeaderIndex = items.indexOf(favHeader);
    const favCmdItem = items[favHeaderIndex + 1];
    expect(favCmdItem._commandName).toBe('Command B');

    ext.disable();
  });

  test('toggleFavorite toggles favorite state and saves configuration', async () => {
    const initialConfig = {
      categories: [
        {
          name: 'Tools',
          commands: [
            { name: 'Command A', command: 'echo A', favorite: false },
          ],
        },
      ],
    };
    await saveConfig(initialConfig, configPath);

    const ext = new CmdBarExtension();
    ext.enable();
    ext._indicator._getConfigPath = () => configPath;
    await ext._indicator._reloadMenu();

    const targetCmd = initialConfig.categories[0].commands[0];
    await ext._indicator.toggleFavorite(targetCmd);

    const reloadedConfig = await loadConfig(configPath);
    expect(reloadedConfig.categories[0].commands[0].favorite).toBe(true);

    ext.disable();
  });
});
