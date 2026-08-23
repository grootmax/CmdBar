/**
 * Comprehensive Unit Tests for Lazy Loading, Virtual List Widget, Category Cache, and Search Performance.
 */

import { jest } from '@jest/globals';

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
      get_children() {
        return this.children;
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
      connect() {
        return 1;
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
    ActorAlign: { CENTER: 0 },
  },
  Gio: {
    Subprocess: {
      new: mockSubprocessNew,
    },
    SubprocessFlags: {
      NONE: 0,
      STDOUT_PIPE: 1,
      STDERR_PIPE: 2,
    },
  },
  GLib: {
    getenv: mockGetenv,
    timeout_add: (priority, delay, cb) => {
      if (typeof cb === 'function') cb();
      return 0;
    },
    PRIORITY_DEFAULT: 0,
  },
  GObject: {
    registerClass: (cls) => {
      return class extends cls {
        constructor(...args) {
          super(...args);
          if (typeof this._init === 'function') {
            this._init(...args);
          }
        }
      };
    },
  },
  Meta: {},
  Shell: {},
}), { virtual: true });

jest.unstable_mockModule('resource:///org/gnome/shell/extensions/extension.js', () => ({
  Extension: class {},
}), { virtual: true });

jest.unstable_mockModule('resource:///org/gnome/shell/ui/main.js', () => ({}), { virtual: true });
jest.unstable_mockModule('resource:///org/gnome/shell/ui/panelMenu.js', () => ({ Button: class {} }), { virtual: true });
jest.unstable_mockModule('resource:///org/gnome/shell/ui/modalDialog.js', () => ({ ModalDialog: class {} }), { virtual: true });
jest.unstable_mockModule('resource:///org/gnome/shell/ui/popupMenu.js', () => ({
  PopupBaseMenuItem: class {
    constructor() {
      this._items = [];
    }
    _init(params) {}
    connect(sig, cb) {
      this._cb = cb;
      return 1;
    }
    disconnect() {}
    destroy() {}
    add_child(child) {}
  },
  PopupMenuItem: class {
    constructor(label) {
      this.label = { text: label };
    }
  },
  PopupSeparatorMenuItem: class {},
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
}), { virtual: true });

const {
  CategoryCache,
  ProgressiveLoadingMenuItem,
  LoadMoreMenuItem,
  VirtualListWidget,
  LazyCategoryHeaderMenuItem,
  SearchMenuItem,
} = await import('../extension/extension.js');

describe('Lazy Loading & Virtual Scrolling Unit Tests', () => {

  describe('CategoryCache', () => {
    test('should cache and retrieve commands by category name', () => {
      const cache = new CategoryCache();
      expect(cache.has('Projects')).toBe(false);

      const mockCommands = [{ name: 'Build', command: 'make' }];
      cache.set('Projects', mockCommands);

      expect(cache.has('Projects')).toBe(true);
      expect(cache.get('Projects')).toEqual(mockCommands);
    });

    test('should manage loading states and clear cache', () => {
      const cache = new CategoryCache();
      expect(cache.isLoading('Infrastructure')).toBe(false);

      cache.setLoading('Infrastructure', true);
      expect(cache.isLoading('Infrastructure')).toBe(true);

      cache.set('Infrastructure', [{ name: 'Deploy', command: 'deploy.sh' }]);
      cache.clear();

      expect(cache.has('Infrastructure')).toBe(false);
      expect(cache.isLoading('Infrastructure')).toBe(false);
    });
  });

  describe('ProgressiveLoadingMenuItem', () => {
    test('should initialize with default or custom message', () => {
      const item = new ProgressiveLoadingMenuItem('Loading test commands...');
      expect(item.label.text).toBe('Loading test commands...');

      item.setMessage('Updated loading status...');
      expect(item.label.text).toBe('Updated loading status...');
    });
  });

  describe('VirtualListWidget', () => {
    test('should paginate large lists into pages/chunks', () => {
      const totalItems = Array.from({ length: 55 }, (_, i) => ({
        name: `Command ${i + 1}`,
        command: `echo ${i + 1}`,
      }));

      const targetMenu = {
        items: [],
        addMenuItem(item) {
          this.items.push(item);
        },
      };

      const virtualList = new VirtualListWidget({
        pageSize: 20,
        renderItem: (item) => ({ name: item.name }),
      });

      virtualList.setItems(totalItems);
      expect(virtualList.hasMore()).toBe(true);

      // Render initial chunk
      const page1 = virtualList.renderInitialPage(targetMenu);
      expect(page1.length).toBe(20);
      expect(virtualList.renderedCount).toBe(20);
      expect(virtualList.hasMore()).toBe(true);
      expect(virtualList.loadMoreItem).not.toBeNull();

      // Render second chunk
      const page2 = virtualList.renderNextChunk(targetMenu);
      expect(page2.length).toBe(20);
      expect(virtualList.renderedCount).toBe(40);
      expect(virtualList.hasMore()).toBe(true);

      // Render final chunk
      const page3 = virtualList.renderNextChunk(targetMenu);
      expect(page3.length).toBe(15);
      expect(virtualList.renderedCount).toBe(55);
      expect(virtualList.hasMore()).toBe(false);
      expect(virtualList.loadMoreItem).toBeNull();
    });
  });

  describe('LazyCategoryHeaderMenuItem', () => {
    test('should start collapsed and expand lazily on demand', async () => {
      const categoryCache = new CategoryCache();
      const mockCategory = {
        name: 'DevOps',
        commands: [
          { name: 'K8s Status', command: 'kubectl get pods' },
          { name: 'Helm List', command: 'helm list' },
        ],
      };

      const addedItems = [];
      const mockIndicator = {
        menu: {
          addMenuItem(item) {
            addedItems.push(item);
          },
        },
      };

      const lazyHeader = new LazyCategoryHeaderMenuItem(
        mockIndicator,
        mockCategory,
        categoryCache,
        { pageSize: 10 }
      );

      expect(lazyHeader.isExpanded).toBe(false);

      // Expand category
      await lazyHeader.expand();
      expect(lazyHeader.isExpanded).toBe(true);
      expect(categoryCache.has('DevOps')).toBe(true);

      // Collapse category
      lazyHeader.collapse();
      expect(lazyHeader.isExpanded).toBe(false);
    });
  });

  describe('Search/Filter with 100+ Commands', () => {
    test('should filter 150+ commands quickly and virtualize results', () => {
      const cache = new CategoryCache();
      const commands = Array.from({ length: 150 }, (_, i) => ({
        name: `Service Task ${i + 1}`,
        command: `systemctl status service-${i + 1}`,
      }));

      cache.set('Services', commands);

      const virtualList = new VirtualListWidget({
        pageSize: 20,
        renderItem: (cmd) => cmd,
      });

      const startTime = performance.now();
      const filterQuery = 'Service Task 1';
      const matches = commands.filter((c) => c.name.includes(filterQuery));

      virtualList.setItems(matches);
      const targetMenu = {
        items: [],
        addMenuItem(item) {
          this.items.push(item);
        },
      };
      virtualList.renderInitialPage(targetMenu);
      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(100); // Fast execution (<100ms)
      expect(virtualList.renderedCount).toBe(20);
      expect(matches.length).toBeGreaterThan(10);
    });
  });
});
