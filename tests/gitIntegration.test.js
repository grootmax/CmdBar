import fs from 'fs';
import path from 'path';
import os from 'os';
import { jest } from '@jest/globals';

// Mock GI and GNOME Shell modules before importing extension.js
const mockSubprocessNew = jest.fn();
const mockGetenv = jest.fn();

jest.unstable_mockModule('gi', () => ({
  St: {
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
      }
    },
  },
  Clutter: {
    Orientation: { HORIZONTAL: 0, VERTICAL: 1 },
    ActorAlign: { CENTER: 0 },
  },
  Gio: {
    Subprocess: {
      new: mockSubprocessNew,
    },
    SubprocessFlags: {
      STDIN_PIPE: 1,
      STDERR_PIPE: 2,
      STDOUT_PIPE: 4,
      NONE: 0,
    },
    FileMonitorFlags: { NONE: 0 },
    FileMonitorEvent: { CHANGES_DONE_HINT: 0 },
    File: {
      new_for_path: () => ({
        monitor_file: () => ({
          connect: () => 1,
        }),
      }),
    },
  },
  GLib: {
    getenv: mockGetenv,
    get_current_dir: () => '/app/CmdBar',
    get_user_config_dir: () => '/tmp',
    build_filenamev: (parts) => parts.join('/'),
    file_test: (filepath, test) => fs.existsSync(filepath),
    FileTest: { EXISTS: 1 },
    timeout_add: jest.fn(() => 123),
    Source: {
      remove: jest.fn(),
    },
    PRIORITY_DEFAULT: 0,
    SOURCE_CONTINUE: true,
  },
  GObject: {
    registerClass: (cls) => cls,
  },
  Meta: {
    KeyBindingFlags: { NONE: 0 },
  },
  Shell: {
    ActionMode: { ALL: 1 },
  },
}), { virtual: true });

jest.unstable_mockModule('resource:///org/gnome/shell/extensions/extension.js', () => ({
  Extension: class {},
}), { virtual: true });

jest.unstable_mockModule('resource:///org/gnome/shell/ui/main.js', () => ({
  panel: { addToStatusArea: jest.fn() },
}), { virtual: true });

jest.unstable_mockModule('resource:///org/gnome/shell/ui/panelMenu.js', () => ({
  Button: class {
    constructor() {
      this.menu = {
        addMenuItem: jest.fn(),
        removeAll: jest.fn(),
        close: jest.fn(),
        connect: jest.fn(),
      };
    }
    add_child() {}
  },
}), { virtual: true });

jest.unstable_mockModule('resource:///org/gnome/shell/ui/popupMenu.js', () => ({
  PopupBaseMenuItem: class {
    constructor() {
      this._signals = {};
    }
    add_child() {}
    connect(signal, cb) {
      this._signals[signal] = cb;
      return 1;
    }
    disconnect() {}
    destroy() {}
  },
  PopupMenuItem: class {
    constructor(text, opts) {
      this.text = text;
    }
  },
  PopupMenuSection: class {
    constructor() {
      this.items = [];
    }
    addMenuItem(item) {
      this.items.push(item);
    }
    removeAll() {
      this.items = [];
    }
  },
  PopupSeparatorMenuItem: class {},
}), { virtual: true });

jest.unstable_mockModule('resource:///org/gnome/shell/ui/modalDialog.js', () => ({
  ModalDialog: class {},
}), { virtual: true });

const {
  detectGitRepo,
  getGitStateSync,
  getGitStateAsync,
  substituteGitPlaceholders,
  hasNonGitPlaceholders,
} = await import('../extension/commandProcessor.js');

describe('Git Repository Integration End-to-End Test Suite', () => {
  let tempGitDir;

  beforeEach(() => {
    tempGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-test-repo-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempGitDir)) {
      fs.rmSync(tempGitDir, { recursive: true, force: true });
    }
  });

  test('detectGitRepo identifies .git directory accurately', () => {
    expect(detectGitRepo(tempGitDir)).toBe(false);

    const gitFolder = path.join(tempGitDir, '.git');
    fs.mkdirSync(gitFolder);

    expect(detectGitRepo(tempGitDir)).toBe(true);
  });

  test('getGitStateSync reads repo state correctly', () => {
    const gitFolder = path.join(tempGitDir, '.git');
    fs.mkdirSync(gitFolder);

    const gitState = getGitStateSync(tempGitDir);
    expect(gitState.isGitRepo).toBe(true);
    expect(gitState.repoPath).toBe(tempGitDir);
  });

  test('substituteGitPlaceholders replaces branch, status, and last commit placeholders', () => {
    const mockState = {
      isGitRepo: true,
      branch: 'jules/feat/git-integration',
      status: 'clean',
      lastCommit: 'd89ea35 Implement Git repository integration',
    };

    const cmdTemplate = 'git push origin {git-branch} && echo "Status: {git-status}" && git show {git-last-commit}';
    const result = substituteGitPlaceholders(cmdTemplate, mockState);

    expect(result).toBe('git push origin jules/feat/git-integration && echo "Status: clean" && git show d89ea35 Implement Git repository integration');
  });

  test('hasNonGitPlaceholders accurately distinguishes user input parameters from git placeholders', () => {
    expect(hasNonGitPlaceholders('git push origin {git-branch}')).toBe(false);
    expect(hasNonGitPlaceholders('git pull origin <git-branch>')).toBe(false);
    expect(hasNonGitPlaceholders('git commit -m "<commit-message>" on {git-branch}')).toBe(true);
  });
});
