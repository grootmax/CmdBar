import { jest } from "@jest/globals";
import {
  getNormalizedNumpadConfig,
  getActiveLayer,
  setActiveLayerIndex,
  cycleActiveLayer,
  getNumpadKeyCommand,
  getNumpadGrid,
} from "../extension/numpadManager.js";
import { CmdBarDBusService } from "../extension/dbusService.js";

describe("Numeric Keypad Shortcuts & Macro Pad Tests", () => {
  const sampleConfig = {
    categories: [],
    numpad: {
      enabled: true,
      active_layer: 0,
      layers: [
        {
          name: "Default",
          keys: {
            "0": { name: "Mute", command: "pactl set-sink-mute toggle" },
            "1": { name: "Vol Down", command: "pactl set-sink-volume -5%" },
            "2": { name: "Vol Up", command: "pactl set-sink-volume +5%" },
            "7": { name: "Monitor", command: "gnome-system-monitor" },
          },
        },
        {
          name: "Gaming",
          keys: {
            "0": { name: "Mic Mute", command: "pactl set-source-mute toggle" },
            "1": { name: "FPS Counter", command: "echo fps" },
          },
        },
      ],
    },
  };

  test("getNormalizedNumpadConfig should handle missing or empty config gracefully", () => {
    const norm = getNormalizedNumpadConfig(null);
    expect(norm.enabled).toBe(true);
    expect(norm.active_layer).toBe(0);
    expect(Array.isArray(norm.layers)).toBe(true);
    expect(norm.layers.length).toBeGreaterThan(0);
    expect(norm.layers[0].keys["0"]).toBeDefined();
  });

  test("getNormalizedNumpadConfig should normalize custom layers and fill missing keys 0-9", () => {
    const norm = getNormalizedNumpadConfig(sampleConfig);
    expect(norm.layers.length).toBe(2);
    expect(norm.layers[0].name).toBe("Default");
    expect(norm.layers[0].keys["0"].name).toBe("Mute");
    expect(norm.layers[0].keys["3"].name).toContain("Unassigned Key 3");
  });

  test("getActiveLayer should return correct active layer details", () => {
    const active = getActiveLayer(sampleConfig);
    expect(active.index).toBe(0);
    expect(active.name).toBe("Default");
    expect(active.totalLayers).toBe(2);
    expect(active.keys["0"].command).toBe("pactl set-sink-mute toggle");
  });

  test("setActiveLayerIndex should clamp active layer index to valid bounds", () => {
    const cfg = JSON.parse(JSON.stringify(sampleConfig));
    let idx = setActiveLayerIndex(cfg, 1);
    expect(idx).toBe(1);
    expect(cfg.numpad.active_layer).toBe(1);

    idx = setActiveLayerIndex(cfg, 99);
    expect(idx).toBe(1);

    idx = setActiveLayerIndex(cfg, -5);
    expect(idx).toBe(0);
  });

  test("cycleActiveLayer should cycle sequentially through layers and wrap around", () => {
    const cfg = JSON.parse(JSON.stringify(sampleConfig));
    let res = cycleActiveLayer(cfg);
    expect(res.index).toBe(1);
    expect(res.name).toBe("Gaming");

    res = cycleActiveLayer(cfg);
    expect(res.index).toBe(0);
    expect(res.name).toBe("Default");
  });

  test("getNumpadKeyCommand should return mapped command or null", () => {
    const cmd0 = getNumpadKeyCommand(sampleConfig, 0);
    expect(cmd0).not.toBeNull();
    expect(cmd0.key).toBe("0");
    expect(cmd0.name).toBe("Mute");
    expect(cmd0.command).toBe("pactl set-sink-mute toggle");

    const cmd7 = getNumpadKeyCommand(sampleConfig, "7");
    expect(cmd7.name).toBe("Monitor");
  });

  test("getNumpadGrid should format a 4-row 2D grid representation", () => {
    const grid = getNumpadGrid(sampleConfig);
    expect(grid.length).toBe(4);
    // Row 0: 7, 8, 9
    expect(grid[0].map((cell) => cell.key)).toEqual(["7", "8", "9"]);
    // Row 1: 4, 5, 6
    expect(grid[1].map((cell) => cell.key)).toEqual(["4", "5", "6"]);
    // Row 2: 1, 2, 3
    expect(grid[2].map((cell) => cell.key)).toEqual(["1", "2", "3"]);
    // Row 3: 0
    expect(grid[3].map((cell) => cell.key)).toEqual(["0"]);
  });

  test("CmdBarDBusService numpad methods work correctly", async () => {
    const mockIndicator = {
      _getConfigPath: () => "/tmp/mock_config.json",
      _reloadMenu: jest.fn(),
      executeCommand: jest.fn(),
      _numpadOverlay: {
        toggle: jest.fn().mockResolvedValue(true),
      },
    };

    const service = new CmdBarDBusService(mockIndicator);
    const layersJsonStr = await service.GetNumpadLayers();
    expect(typeof layersJsonStr).toBe("string");
    const layersObj = JSON.parse(layersJsonStr);
    expect(layersObj.enabled).toBeDefined();

    const setRes = await service.SetActiveNumpadLayer(1);
    expect(setRes).toBe(true);

    const toggleRes = await service.ToggleNumpadOverlay();
    expect(toggleRes).toBe(true);
    expect(mockIndicator._numpadOverlay.toggle).toHaveBeenCalled();
  });
});
