import fs from 'fs';
import path from 'path';
import os from 'os';
import { jest } from '@jest/globals';

// Mock GI and GNOME Shell modules before importing extension.js
const mockSubprocessNew = jest.fn();
const mockGetenv = jest.fn();
const mockSetText = jest.fn();

jest.unstable_mockModule('gi', () => ({
  St: {
    Clipboard: {
      get_default: () => ({
        set_text: mockSetText,
        get_text: jest.fn(),
      }),
    },
    ClipboardType: {
      CLIPBOARD: 1,
    },
    BoxLayout: class {
      constructor() {
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
      }
      click() {
        if (this._listeners['clicked']) this._listeners['clicked']();
      }
    },
    Entry: class {
      constructor(props) {
        Object.assign(this, props);
        this.text = props ? props.text || '' : '';
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
        if (this._listeners['text-changed']) this._listeners['text-changed']();
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
  },
  GLib: {
    getenv: mockGetenv,
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
  Meta: {},
  Shell: {},
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
  loadClipboardHistory,
  saveClipboardHistory,
  getDefaultClipboardPath,
} = await import('../extension/configSync.js');

const {
  pasteClipboardText,
  copyToClipboard,
} = await import('../extension/extension.js');

describe('Clipboard History Storage in configSync.js', () => {
  let tempDir;
  let clipboardPath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdbar-clip-test-'));
    clipboardPath = path.join(tempDir, 'clipboard.json');
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('loadClipboardHistory returns empty array when file does not exist', async () => {
    const history = await loadClipboardHistory(clipboardPath);
    expect(history).toEqual([]);
  });

  test('saveClipboardHistory saves entries and loadClipboardHistory reads them', async () => {
    const mockData = [
      { text: 'clip 1', pinned: true, timestamp: 1000 },
      { text: 'clip 2', pinned: false, timestamp: 2000 },
    ];
    await saveClipboardHistory(mockData, clipboardPath);

    expect(fs.existsSync(clipboardPath)).toBe(true);

    const loaded = await loadClipboardHistory(clipboardPath);
    expect(loaded.length).toBe(2);
    expect(loaded[0].text).toBe('clip 1');
    expect(loaded[0].pinned).toBe(true);
    expect(loaded[1].text).toBe('clip 2');
    expect(loaded[1].pinned).toBe(false);
  });

  test('loadClipboardHistory handles legacy string array gracefully', async () => {
    fs.writeFileSync(clipboardPath, JSON.stringify(['string item 1', 'string item 2']), 'utf8');

    const loaded = await loadClipboardHistory(clipboardPath);
    expect(loaded.length).toBe(2);
    expect(loaded[0].text).toBe('string item 1');
    expect(loaded[0].pinned).toBe(false);
    expect(loaded[1].text).toBe('string item 2');
  });

  test('saveClipboardHistory throws error on invalid schema', async () => {
    await expect(saveClipboardHistory('invalid-schema', clipboardPath)).rejects.toThrow();
  });
});

describe('pasteClipboardText Helper Function', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('pastes text using wtype on Wayland sessions', () => {
    mockGetenv.mockImplementation((key) => (key === 'WAYLAND_DISPLAY' ? 'wayland-0' : null));

    const mockProc = {
      communicate_utf8_async: jest.fn((input, cancel, cb) => {
        if (cb) cb(mockProc, {});
      }),
    };
    mockSubprocessNew.mockReturnValue(mockProc);

    const result = pasteClipboardText('hello world');

    expect(result).toBe(true);
    expect(mockSubprocessNew).toHaveBeenCalledWith(
      ['wtype', '-M', 'ctrl', 'v'],
      expect.anything()
    );
  });

  test('pastes text using xdotool on X11 sessions', () => {
    mockGetenv.mockImplementation((key) => (key === 'XDG_SESSION_TYPE' ? 'x11' : null));

    const mockProc = {
      communicate_utf8_async: jest.fn((input, cancel, cb) => {
        if (cb) cb(mockProc, {});
      }),
    };
    mockSubprocessNew.mockReturnValue(mockProc);

    const result = pasteClipboardText('x11 text');

    expect(result).toBe(true);
    expect(mockSubprocessNew).toHaveBeenCalledWith(
      ['xdotool', 'key', '--clearmodifiers', 'ctrl+v'],
      expect.anything()
    );
  });
});

describe('Clipboard Indicator Logic Unit Tests', () => {
  let indicator;

  beforeEach(() => {
    indicator = {
      _clipboardHistory: [],
      _lastClipboardText: '',
      _clipboardLimit: 50,
      _persistClipboard: false,
      _enableClipboard: true,
      _clipboardSearchQuery: '',
      _clipboardSection: {
        items: [],
        removeAll() {
          this.items = [];
        },
        addMenuItem(item) {
          this.items.push(item);
        },
      },
      addClipboardItem(text) {
        if (typeof text !== 'string') {
          if (text === null || text === undefined) return;
          text = String(text);
        }
        if (text === '' || text.length === 0) return;

        if (text === this._lastClipboardText) return;
        if (this._clipboardHistory.length > 0 && this._clipboardHistory[0].text === text) {
          this._lastClipboardText = text;
          return;
        }

        this._lastClipboardText = text;

        let existingIndex = this._clipboardHistory.findIndex((item) => item.text === text);
        let isPinned = false;
        if (existingIndex !== -1) {
          isPinned = this._clipboardHistory[existingIndex].pinned;
          this._clipboardHistory.splice(existingIndex, 1);
        }

        let newItem = {
          text: text,
          pinned: isPinned,
          timestamp: Date.now(),
        };
        this._clipboardHistory.unshift(newItem);

        let limit = this._clipboardLimit || 50;
        while (this._clipboardHistory.length > limit) {
          let lastUnpinnedIdx = -1;
          for (let i = this._clipboardHistory.length - 1; i >= 0; i--) {
            if (!this._clipboardHistory[i].pinned) {
              lastUnpinnedIdx = i;
              break;
            }
          }
          if (lastUnpinnedIdx !== -1) {
            this._clipboardHistory.splice(lastUnpinnedIdx, 1);
          } else {
            this._clipboardHistory.pop();
          }
        }

        this._updateClipboardSection();
      },
      clearClipboardHistory() {
        this._clipboardHistory = this._clipboardHistory.filter((item) => item.pinned);
        this._updateClipboardSection();
      },
      togglePinClipboardItem(text) {
        let item = this._clipboardHistory.find((i) => i.text === text);
        if (item) {
          item.pinned = !item.pinned;
          this._updateClipboardSection();
        }
      },
      removeClipboardItem(text) {
        let idx = this._clipboardHistory.findIndex((i) => i.text === text);
        if (idx !== -1) {
          this._clipboardHistory.splice(idx, 1);
          this._updateClipboardSection();
        }
      },
      _updateClipboardSection() {
        if (!this._clipboardSection) return;
        this._clipboardSection.removeAll();

        if (!this._clipboardHistory || this._clipboardHistory.length === 0) {
          return;
        }

        let query = (this._clipboardSearchQuery || '').trim().toLowerCase();
        let items = this._clipboardHistory;
        if (query) {
          items = items.filter((item) => item.text.toLowerCase().includes(query));
        }

        let pinned = items.filter((item) => item.pinned);
        let unpinned = items.filter((item) => !item.pinned);
        let sortedItems = [...pinned, ...unpinned];

        let limit = this._clipboardLimit || 50;
        sortedItems = sortedItems.slice(0, limit);

        sortedItems.forEach((item) => {
          this._clipboardSection.addMenuItem(item);
        });
      },
    };
  });

  test('deduplicates consecutive copies of identical text', () => {
    indicator.addClipboardItem('copy A');
    indicator.addClipboardItem('copy A');
    indicator.addClipboardItem('copy A');

    expect(indicator._clipboardHistory.length).toBe(1);
    expect(indicator._clipboardHistory[0].text).toBe('copy A');
  });

  test('tracks multiple unique items up to history limit of 50', () => {
    for (let i = 1; i <= 60; i++) {
      indicator.addClipboardItem(`item ${i}`);
    }

    expect(indicator._clipboardHistory.length).toBe(50);
    expect(indicator._clipboardHistory[0].text).toBe('item 60');
    expect(indicator._clipboardHistory[49].text).toBe('item 11');
  });

  test('pinned items are preserved when history is cleared', () => {
    indicator.addClipboardItem('unpinned item 1');
    indicator.addClipboardItem('pinned item 1');
    indicator.addClipboardItem('unpinned item 2');

    indicator.togglePinClipboardItem('pinned item 1');
    expect(indicator._clipboardHistory.find(i => i.text === 'pinned item 1').pinned).toBe(true);

    indicator.clearClipboardHistory();

    expect(indicator._clipboardHistory.length).toBe(1);
    expect(indicator._clipboardHistory[0].text).toBe('pinned item 1');
  });

  test('pinned items are not removed when capacity limit is reached', () => {
    indicator.addClipboardItem('important pinned clip');
    indicator.togglePinClipboardItem('important pinned clip');

    for (let i = 1; i <= 60; i++) {
      indicator.addClipboardItem(`normal clip ${i}`);
    }

    expect(indicator._clipboardHistory.length).toBe(50);
    const pinned = indicator._clipboardHistory.find(i => i.text === 'important pinned clip');
    expect(pinned).toBeDefined();
    expect(pinned.pinned).toBe(true);
  });

  test('search query filters clipboard items correctly', () => {
    indicator.addClipboardItem('git commit -m "fix bug"');
    indicator.addClipboardItem('npm run build');
    indicator.addClipboardItem('git push origin main');

    indicator._clipboardSearchQuery = 'git';
    indicator._updateClipboardSection();

    expect(indicator._clipboardSection.items.length).toBe(2);
    expect(indicator._clipboardSection.items.some(i => i.text.includes('git commit'))).toBe(true);
    expect(indicator._clipboardSection.items.some(i => i.text.includes('git push'))).toBe(true);
  });
});

