import { NumpadManager, DEFAULT_NUMPAD_CONFIG } from "../extension/numpadManager.js";

describe("NumpadManager", () => {
  let mgr;
  let testConfig;

  beforeEach(() => {
    testConfig = JSON.parse(JSON.stringify({
      categories: [],
      numpad: DEFAULT_NUMPAD_CONFIG,
    }));
    mgr = new NumpadManager({ config: testConfig });
  });

  test("initializes with default numpad config and 3 layers", () => {
    const layers = mgr.getLayers();
    expect(layers.length).toBe(3);
    expect(layers[0].id).toBe("default");
    expect(layers[1].id).toBe("gaming");
    expect(layers[2].id).toBe("dev");
  });

  test("handles empty config fallback automatically", () => {
    const emptyMgr = new NumpadManager();
    expect(emptyMgr.getLayers().length).toBe(3);
    expect(emptyMgr.getActiveLayerIndex()).toBe(0);
    expect(emptyMgr.getConfig()).toEqual({});
  });

  test("manages enabled state correctly", () => {
    expect(mgr.isEnabled()).toBe(true);
    mgr.setEnabled(false);
    expect(mgr.isEnabled()).toBe(false);
    mgr.setEnabled(true);
    expect(mgr.isEnabled()).toBe(true);
  });

  test("retrieves active layer index and active layer object", () => {
    expect(mgr.getActiveLayerIndex()).toBe(0);
    expect(mgr.getActiveLayer().name).toBe("Default");
  });

  test("switches layers by index, id, name, and string index", () => {
    mgr.switchLayer(1);
    expect(mgr.getActiveLayerIndex()).toBe(1);
    expect(mgr.getActiveLayer().id).toBe("gaming");

    mgr.switchLayer("dev");
    expect(mgr.getActiveLayerIndex()).toBe(2);
    expect(mgr.getActiveLayer().name).toBe("Developer");

    mgr.switchLayer("Default");
    expect(mgr.getActiveLayerIndex()).toBe(0);

    mgr.switchLayer("2");
    expect(mgr.getActiveLayerIndex()).toBe(2);

    mgr.switchLayer("nonexistent_layer");
    expect(mgr.getActiveLayerIndex()).toBe(0);

    // Out of bounds wrapping
    mgr.switchLayer(5); // 5 % 3 = 2
    expect(mgr.getActiveLayerIndex()).toBe(2);
  });

  test("cycles through layers sequentially", () => {
    mgr.switchLayer(0);
    expect(mgr.getActiveLayerIndex()).toBe(0);

    mgr.cycleLayer();
    expect(mgr.getActiveLayerIndex()).toBe(1);

    mgr.cycleLayer();
    expect(mgr.getActiveLayerIndex()).toBe(2);

    mgr.cycleLayer();
    expect(mgr.getActiveLayerIndex()).toBe(0);
  });

  test("retrieves key bindings for active layer", () => {
    mgr.switchLayer("default");
    const binding0 = mgr.getBinding("0");
    expect(binding0).toBeDefined();
    expect(binding0.name).toBe("System Status");

    const binding1 = mgr.getBinding(1);
    expect(binding1).toBeDefined();
    expect(binding1.name).toBe("Build Project");
  });

  test("sets key binding for specific layer and key", () => {
    const customBinding = { name: "Custom Action", command: "echo Hello World" };
    let success = mgr.setBinding("gaming", 0, customBinding);
    expect(success).toBe(true);

    mgr.switchLayer("gaming");
    let b0 = mgr.getBinding(0);
    expect(b0.name).toBe("Custom Action");
    expect(b0.command).toBe("echo Hello World");

    // Set by numeric index
    success = mgr.setBinding(0, "9", { name: "Root Key 9", command: "echo 9" });
    expect(success).toBe(true);
    mgr.switchLayer(0);
    expect(mgr.getBinding(9).name).toBe("Root Key 9");

    // Invalid layer returns false
    expect(mgr.setBinding(99, 0, customBinding)).toBe(false);
  });

  test("triggers instant key commands and invokes callback", () => {
    let executedCmd = null;
    let executedName = null;

    const customMgr = new NumpadManager({
      config: testConfig,
      onExecuteCommand: (name, cmd) => {
        executedName = name;
        executedCmd = cmd;
      },
    });

    const res = customMgr.triggerKey(1);
    expect(res.success).toBe(true);
    expect(res.key).toBe(1);
    expect(res.name).toBe("Build Project");
    expect(res.command).toBe("make build");
    expect(executedName).toBe("Build Project");
    expect(executedCmd).toBe("make build");
  });

  test("fails to trigger key when numpad is disabled", () => {
    mgr.setEnabled(false);
    const res = mgr.triggerKey(1);
    expect(res.success).toBe(false);
    expect(res.reason).toBe("Numpad disabled");
  });

  test("fails to trigger unbound key", () => {
    mgr.setBinding(0, 9, null);
    const res = mgr.triggerKey(9);
    expect(res.success).toBe(false);
    expect(res.reason).toContain("No binding");
  });

  test("toggles visual overlay HUD and formats ASCII representation", () => {
    expect(mgr.isOverlayVisible()).toBe(false);
    mgr.toggleOverlay();
    expect(mgr.isOverlayVisible()).toBe(true);

    const overlayData = mgr.getOverlayData();
    expect(overlayData.enabled).toBe(true);
    expect(overlayData.activeLayerName).toBe("Default");
    expect(overlayData.grid.length).toBe(10);

    const ascii = mgr.formatOverlayAscii();
    expect(ascii).toContain("CmdBar Numpad Macro Pad");
    expect(ascii).toContain("Layer: Default");
    expect(ascii).toContain("[7]");
    expect(ascii).toContain("[0]");

    mgr.toggleOverlay();
    expect(mgr.isOverlayVisible()).toBe(false);
  });

  test("showOverlay, hideOverlay, updateOverlay and destroy lifecycle", () => {
    mgr.showOverlay();
    expect(mgr.isOverlayVisible()).toBe(true);

    mgr.hideOverlay();
    expect(mgr.isOverlayVisible()).toBe(false);

    // Mock St and Main globals to test updateOverlay rendering logic
    class MockWidget {
      constructor() {
        this.children = [];
      }
      add_child(child) {
        this.children.push(child);
      }
      destroy() {}
      set_position() {}
    }

    globalThis.St = {
      BoxLayout: MockWidget,
      Label: MockWidget,
    };
    globalThis.Main = {
      layoutManager: {
        uiGroup: new MockWidget(),
        primaryMonitor: { x: 0, y: 0, width: 1920, height: 1080 },
      },
    };

    mgr.showOverlay();
    expect(mgr.isOverlayVisible()).toBe(true);
    expect(globalThis.Main.layoutManager.uiGroup.children.length).toBeGreaterThan(0);

    mgr.destroy();
    expect(mgr.isOverlayVisible()).toBe(false);

    delete globalThis.St;
    delete globalThis.Main;
  });
});
