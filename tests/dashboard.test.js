import {
  state,
  sanitizeConfig,
  mergeConfigurations,
  moveCategory,
  moveShortcut,
  renderEditorCategories,
  renderLivePreview
} from '../dashboard/app.js';

function createMockElement(tagName = 'div') {
  const children = [];
  const listeners = {};
  const classList = new Set();

  const el = {
    tagName: tagName.toUpperCase(),
    innerHTML: '',
    textContent: '',
    className: '',
    draggable: false,
    dataset: {},
    children,
    style: {},
    classList: {
      add: (cls) => classList.add(cls),
      remove: (cls) => classList.delete(cls),
      contains: (cls) => classList.has(cls)
    },
    appendChild: (child) => {
      children.push(child);
      return child;
    },
    querySelector: (selector) => {
      if (selector.startsWith('.')) {
        const clsName = selector.slice(1);
        return children.find(c => c.classList.contains && c.classList.contains(clsName)) || createMockElement('div');
      }
      return createMockElement('div');
    },
    querySelectorAll: (selector) => {
      if (selector.startsWith('.')) {
        const clsName = selector.slice(1);
        return children.filter(c => c.classList.contains && c.classList.contains(clsName));
      }
      return children;
    },
    addEventListener: (event, handler) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    }
  };
  return el;
}

// Global DOM Mocks for Node / Jest environment
const mockCategoryContainer = createMockElement('div');
const mockPreviewContent = createMockElement('div');
const mockWorkspaceList = createMockElement('div');

global.document = {
  createElement: (tag) => createMockElement(tag),
  getElementById: (id) => {
    if (id === 'categoryContainer') return mockCategoryContainer;
    if (id === 'previewMenuContent') return mockPreviewContent;
    if (id === 'workspaceList') return mockWorkspaceList;
    return createMockElement('div');
  },
  documentElement: {
    setAttribute: () => {},
    getAttribute: () => 'dark'
  },
  body: createMockElement('body')
};

global.window = {
  addEventListener: () => {}
};

global.navigator = {
  serviceWorker: {
    register: () => Promise.resolve()
  },
  clipboard: {
    writeText: () => Promise.resolve()
  }
};

global.localStorage = {
  getItem: () => null,
  setItem: () => {}
};

describe('CmdBar Web Dashboard Unit Tests', () => {
  beforeEach(() => {
    mockCategoryContainer.children.length = 0;
    mockPreviewContent.children.length = 0;

    state.config = {
      categories: [
        {
          name: "Category 1",
          commands: [
            { name: "Command 1A", command: "echo 1A" },
            { name: "Command 1B", command: "echo 1B" }
          ]
        },
        {
          name: "Category 2",
          commands: [
            { name: "Command 2A", command: "echo 2A" }
          ]
        }
      ]
    };
    state.previewFilter = "";
  });

  describe('Configuration Sanitization & Schema Normalization', () => {
    test('sanitizeConfig converts legacy shortcuts property to commands array', () => {
      const legacy = {
        categories: [
          { name: "Legacy Cat", shortcuts: [{ name: "Test", command: "test" }] }
        ]
      };
      const result = sanitizeConfig(legacy);
      expect(result.categories[0].commands).toBeDefined();
      expect(result.categories[0].shortcuts).toBeUndefined();
      expect(result.categories[0].commands[0].name).toBe("Test");
    });

    test('sanitizeConfig handles null/empty configs gracefully', () => {
      expect(sanitizeConfig(null)).toEqual({ categories: [] });
      expect(sanitizeConfig({})).toEqual({ categories: [] });
    });
  });

  describe('Drag and Drop Reordering Logic', () => {
    test('moveCategory reorders categories correctly', () => {
      const cats = state.config.categories;
      const reordered = moveCategory(cats, 0, 1);
      expect(reordered[0].name).toBe("Category 2");
      expect(reordered[1].name).toBe("Category 1");
    });

    test('moveShortcut moves shortcut within or between categories', () => {
      const cats = state.config.categories;
      const updated = moveShortcut(cats, 0, 0, 1, 1);
      expect(updated[0].commands.length).toBe(1);
      expect(updated[0].commands[0].name).toBe("Command 1B");
      expect(updated[1].commands.length).toBe(2);
      expect(updated[1].commands[1].name).toBe("Command 1A");
    });
  });

  describe('Team Collaboration 2-Way Merge', () => {
    test('mergeConfigurations merges remote categories and shortcuts without duplicates', () => {
      const local = {
        categories: [
          { name: "DevOps", commands: [{ name: "Deploy", command: "deploy.sh" }] }
        ]
      };
      const remote = {
        categories: [
          { name: "DevOps", commands: [{ name: "Deploy", command: "deploy.sh" }, { name: "Logs", command: "logs.sh" }] },
          { name: "QA", commands: [{ name: "Run Tests", command: "npm test" }] }
        ]
      };

      const merged = mergeConfigurations(local, remote);
      expect(merged.categories.length).toBe(2);
      const devOpsCat = merged.categories.find(c => c.name === "DevOps");
      expect(devOpsCat.commands.length).toBe(2);
      expect(merged.categories.find(c => c.name === "QA").commands.length).toBe(1);
    });
  });

  describe('DOM Rendering Engine', () => {
    test('renderEditorCategories renders category cards', () => {
      renderEditorCategories();
      expect(mockCategoryContainer.children.length).toBe(2);
    });

    test('renderLivePreview renders top-bar preview items', () => {
      renderLivePreview();
      expect(mockPreviewContent.children.length).toBe(5); // 2 headers + 3 items
    });
  });
});
