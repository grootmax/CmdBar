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
      }),
    },
    ClipboardType: {
      CLIPBOARD: 1,
    },
    BoxLayout: class {},
    Icon: class {},
    Label: class {},
    Button: class {},
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
    },
  },
  GLib: {
    getenv: mockGetenv,
  },
  GObject: {
    registerClass: (cls) => cls,
  },
}), { virtual: true });

jest.unstable_mockModule('resource:///org/gnome/shell/extensions/extension.js', () => ({
  Extension: class {},
}), { virtual: true });

jest.unstable_mockModule('resource:///org/gnome/shell/ui/main.js', () => ({}), { virtual: true });
jest.unstable_mockModule('resource:///org/gnome/shell/ui/panelMenu.js', () => ({ Button: class {} }), { virtual: true });
jest.unstable_mockModule('resource:///org/gnome/shell/ui/popupMenu.js', () => ({ PopupBaseMenuItem: class {} }), { virtual: true });
jest.unstable_mockModule('resource:///org/gnome/shell/ui/modalDialog.js', () => ({ ModalDialog: class {} }), { virtual: true });

const { copyToClipboard } = await import('../extension/extension.js');

describe('copyToClipboard Helper Function', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('copies text using wl-copy on Wayland sessions', () => {
    mockGetenv.mockImplementation((key) => (key === 'WAYLAND_DISPLAY' ? 'wayland-0' : null));

    const mockProc = {
      communicate_utf8_async: jest.fn((text, cancellable, callback) => {
        if (callback) callback(mockProc, {});
      }),
    };
    mockSubprocessNew.mockReturnValue(mockProc);

    const result = copyToClipboard('echo hello');

    expect(result).toBe(true);
    expect(mockSubprocessNew).toHaveBeenCalledWith(
      ['wl-copy'],
      expect.anything()
    );
    expect(mockProc.communicate_utf8_async).toHaveBeenCalledWith('echo hello', null, expect.any(Function));
  });

  test('copies text using xclip on X11 sessions', () => {
    mockGetenv.mockImplementation((key) => (key === 'XDG_SESSION_TYPE' ? 'x11' : null));

    const mockProc = {
      communicate_utf8_async: jest.fn((text, cancellable, callback) => {
        if (callback) callback(mockProc, {});
      }),
    };
    mockSubprocessNew.mockReturnValue(mockProc);

    const result = copyToClipboard('git status');

    expect(result).toBe(true);
    expect(mockSubprocessNew).toHaveBeenCalledWith(
      ['xclip', '-selection', 'clipboard'],
      expect.anything()
    );
    expect(mockProc.communicate_utf8_async).toHaveBeenCalledWith('git status', null, expect.any(Function));
  });

  test('falls back to xclip if wl-copy spawn fails on Wayland', () => {
    mockGetenv.mockImplementation((key) => (key === 'WAYLAND_DISPLAY' ? 'wayland-0' : null));

    const mockProc = {
      communicate_utf8_async: jest.fn(),
    };
    mockSubprocessNew.mockImplementation((argv) => {
      if (argv[0] === 'wl-copy') {
        throw new Error('wl-copy not found');
      }
      return mockProc;
    });

    const result = copyToClipboard('ls -la');

    expect(result).toBe(true);
    expect(mockSubprocessNew).toHaveBeenCalledWith(['wl-copy'], expect.anything());
    expect(mockSubprocessNew).toHaveBeenCalledWith(['xclip', '-selection', 'clipboard'], expect.anything());
  });
});
