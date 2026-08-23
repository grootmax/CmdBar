/**
 * Numpad Macro Pad Manager and Visual Overlay Controller.
 * Handles numpad key bindings, configurable multi-layer macro pads, instant command execution,
 * and visual HUD overlay for GNOME Shell.
 */

import { DEFAULT_CONFIG } from "./configSync.js";

let St, Clutter, ModalDialog, Main, Gio;

try {
  const giModule = await import("gi");
  St = giModule.St || (giModule.default && giModule.default.St);
  Clutter = giModule.Clutter || (giModule.default && giModule.default.Clutter);
  Gio = giModule.Gio || (giModule.default && giModule.default.Gio);
  
  if (typeof window === "undefined" && typeof globalThis !== "undefined") {
    try {
      Main = await import("resource:///org/gnome/shell/ui/main.js");
      ModalDialog = await import("resource:///org/gnome/shell/ui/modalDialog.js");
    } catch (e) {}
  }
} catch (e) {}

/**
 * Normalizes Numpad configuration object from global config or returns default.
 * @param {object} config 
 * @returns {object}
 */
export function getNormalizedNumpadConfig(config) {
  if (!config || typeof config !== "object") {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG.numpad));
  }
  if (!config.numpad || typeof config.numpad !== "object") {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG.numpad));
  }

  const numpad = config.numpad;
  const enabled = numpad.enabled !== false;
  let activeLayer = typeof numpad.active_layer === "number" ? numpad.active_layer : 0;
  let layers = Array.isArray(numpad.layers) && numpad.layers.length > 0
    ? numpad.layers
    : DEFAULT_CONFIG.numpad.layers;

  if (activeLayer < 0 || activeLayer >= layers.length) {
    activeLayer = 0;
  }

  const normalizedLayers = layers.map((layer, idx) => {
    const layerName = (layer && typeof layer.name === "string" && layer.name.trim())
      ? layer.name.trim()
      : `Layer ${idx + 1}`;
    
    let rawKeys = (layer && typeof layer.keys === "object" && layer.keys) ? layer.keys : {};
    let normKeys = {};

    for (let k = 0; k <= 9; k++) {
      const keyStr = String(k);
      let keyVal = rawKeys[keyStr] || rawKeys[k];
      if (keyVal && typeof keyVal === "object") {
        normKeys[keyStr] = {
          name: keyVal.name || `Command ${keyStr}`,
          command: keyVal.command || "",
        };
      } else if (typeof keyVal === "string") {
        normKeys[keyStr] = {
          name: keyVal || `Command ${keyStr}`,
          command: keyVal,
        };
      } else {
        normKeys[keyStr] = {
          name: `Unassigned Key ${keyStr}`,
          command: "",
        };
      }
    }

    return {
      name: layerName,
      keys: normKeys,
    };
  });

  return {
    enabled,
    active_layer: activeLayer,
    layers: normalizedLayers,
  };
}

/**
 * Gets currently active numpad layer details.
 * @param {object} config 
 * @returns {{index: number, name: string, keys: object, totalLayers: number}}
 */
export function getActiveLayer(config) {
  const norm = getNormalizedNumpadConfig(config);
  const activeIdx = norm.active_layer;
  const layer = norm.layers[activeIdx] || norm.layers[0];
  return {
    index: activeIdx,
    name: layer.name,
    keys: layer.keys,
    totalLayers: norm.layers.length,
  };
}

/**
 * Updates active layer index in config within bounds.
 * @param {object} config 
 * @param {number} layerIndex 
 * @returns {number} New active layer index
 */
export function setActiveLayerIndex(config, layerIndex) {
  const norm = getNormalizedNumpadConfig(config);
  if (!config.numpad) {
    config.numpad = norm;
  }
  let targetIdx = parseInt(layerIndex, 10);
  if (isNaN(targetIdx)) targetIdx = 0;

  if (targetIdx < 0) targetIdx = 0;
  if (targetIdx >= norm.layers.length) targetIdx = norm.layers.length - 1;

  config.numpad.active_layer = targetIdx;
  return targetIdx;
}

/**
 * Cycles to the next numpad layer.
 * @param {object} config 
 * @returns {{index: number, name: string}}
 */
export function cycleActiveLayer(config) {
  const norm = getNormalizedNumpadConfig(config);
  if (!config.numpad) {
    config.numpad = norm;
  }
  const nextIdx = (norm.active_layer + 1) % norm.layers.length;
  config.numpad.active_layer = nextIdx;
  return {
    index: nextIdx,
    name: norm.layers[nextIdx].name,
  };
}

/**
 * Retrieves the command mapped to key (0-9) on active layer.
 * @param {object} config 
 * @param {number|string} keyIndex 
 * @returns {{key: string, name: string, command: string}|null}
 */
export function getNumpadKeyCommand(config, keyIndex) {
  const active = getActiveLayer(config);
  const kStr = String(keyIndex);
  if (!active.keys || !active.keys[kStr]) {
    return null;
  }
  const item = active.keys[kStr];
  return {
    key: kStr,
    name: item.name || `Key ${kStr}`,
    command: item.command || "",
  };
}

/**
 * Returns a structured 2D grid representation of the numpad macro pad for visual rendering.
 * Layout:
 * Row 0: 7, 8, 9
 * Row 1: 4, 5, 6
 * Row 2: 1, 2, 3
 * Row 3: 0
 * @param {object} config 
 * @returns {Array<Array<{key: string, label: string, name: string, command: string}>>}
 */
export function getNumpadGrid(config) {
  const active = getActiveLayer(config);
  const keys = active.keys;

  const makeCell = (k) => ({
    key: String(k),
    label: `KP_${k}`,
    name: keys[String(k)] ? keys[String(k)].name : `Key ${k}`,
    command: keys[String(k)] ? keys[String(k)].command : "",
  });

  return [
    [makeCell(7), makeCell(8), makeCell(9)],
    [makeCell(4), makeCell(5), makeCell(6)],
    [makeCell(1), makeCell(2), makeCell(3)],
    [makeCell(0)],
  ];
}

/**
 * Visual Overlay Dialog UI for GNOME Shell.
 */
export class NumpadOverlay {
  constructor(indicator) {
    this._indicator = indicator;
    this._dialog = null;
    this._isVisible = false;
  }

  isShowing() {
    return this._isVisible;
  }

  async toggle() {
    if (this._isVisible) {
      this.close();
    } else {
      await this.show();
    }
  }

  async show() {
    if (this._isVisible) return;
    if (!ModalDialog || !St) {
      console.log("CmdBar NumpadOverlay: ModalDialog or St not available (non-GNOME environment).");
      this._isVisible = true;
      return;
    }

    try {
      const DialogClass = ModalDialog.ModalDialog || (ModalDialog.default && ModalDialog.default.ModalDialog);
      if (!DialogClass) return;

      this._dialog = new DialogClass({ styleClass: "cmdbar-numpad-overlay-dialog" });

      const config = this._indicator && typeof this._indicator._getConfig === "function"
        ? await this._indicator._getConfig()
        : DEFAULT_CONFIG;

      const activeLayer = getActiveLayer(config);
      const grid = getNumpadGrid(config);

      const mainBox = new St.BoxLayout({
        vertical: true,
        style_class: "cmdbar-numpad-overlay-box",
      });

      // Header Bar with Layer Info
      const headerBox = new St.BoxLayout({
        vertical: false,
        style_class: "cmdbar-numpad-header-box",
        x_expand: true,
      });

      const titleLabel = new St.Label({
        text: `Numpad Macro Pad: ${activeLayer.name} (${activeLayer.index + 1}/${activeLayer.totalLayers})`,
        style_class: "cmdbar-numpad-title",
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
      });
      headerBox.add_child(titleLabel);

      const prevBtn = new St.Button({
        label: "‹ Prev Layer",
        style_class: "cmdbar-numpad-layer-btn",
      });
      prevBtn.connect("clicked", async () => {
        let currentIdx = activeLayer.index;
        let newIdx = (currentIdx - 1 + activeLayer.totalLayers) % activeLayer.totalLayers;
        setActiveLayerIndex(config, newIdx);
        if (this._indicator && typeof this._indicator._saveCurrentConfig === "function") {
          await this._indicator._saveCurrentConfig(config);
        }
        this.refresh();
      });
      headerBox.add_child(prevBtn);

      const nextBtn = new St.Button({
        label: "Next Layer ›",
        style_class: "cmdbar-numpad-layer-btn",
      });
      nextBtn.connect("clicked", async () => {
        cycleActiveLayer(config);
        if (this._indicator && typeof this._indicator._saveCurrentConfig === "function") {
          await this._indicator._saveCurrentConfig(config);
        }
        this.refresh();
      });
      headerBox.add_child(nextBtn);

      mainBox.add_child(headerBox);

      // Grid Container
      const gridBox = new St.BoxLayout({
        vertical: true,
        style_class: "cmdbar-numpad-grid-box",
      });

      for (let row of grid) {
        const rowBox = new St.BoxLayout({
          vertical: false,
          style_class: "cmdbar-numpad-row-box",
          x_expand: true,
        });

        for (let cell of row) {
          const isZero = cell.key === "0";
          const tileBtn = new St.Button({
            style_class: isZero ? "cmdbar-numpad-tile cmdbar-numpad-tile-wide" : "cmdbar-numpad-tile",
            x_expand: true,
          });

          const tileContent = new St.BoxLayout({ vertical: true, x_expand: true });

          const keyNumLabel = new St.Label({
            text: `[KP ${cell.key}]`,
            style_class: "cmdbar-numpad-key-num",
          });
          tileContent.add_child(keyNumLabel);

          const nameLabel = new St.Label({
            text: cell.name || "Unassigned",
            style_class: "cmdbar-numpad-key-name",
          });
          tileContent.add_child(nameLabel);

          if (cell.command) {
            const cmdLabel = new St.Label({
              text: cell.command,
              style_class: "cmdbar-numpad-key-cmd",
            });
            tileContent.add_child(cmdLabel);
          }

          tileBtn.set_child(tileContent);

          tileBtn.connect("clicked", () => {
            this.close();
            if (cell.command && this._indicator && typeof this._indicator.executeCommand === "function") {
              this._indicator.executeCommand(cell.name, cell.command, {}, { name: cell.name, command: cell.command });
            }
          });

          rowBox.add_child(tileBtn);
        }

        gridBox.add_child(rowBox);
      }

      mainBox.add_child(gridBox);

      // Footer Instructions
      const footerLabel = new St.Label({
        text: "Press [0-9] on Numpad to trigger instant command | [KP_Divide] Switch Layer | [Esc] Close",
        style_class: "cmdbar-numpad-footer",
        x_expand: true,
      });
      mainBox.add_child(footerLabel);

      this._dialog.contentLayout.add_child(mainBox);

      // Keyboard event handler
      this._dialog.connect("key-press-event", (actor, event) => {
        const symbol = event.get_key_symbol();

        if (symbol === Clutter.KEY_Escape) {
          this.close();
          return Clutter.EVENT_STOP;
        }

        if (symbol === Clutter.KEY_KP_Divide || symbol === Clutter.KEY_slash) {
          cycleActiveLayer(config);
          if (this._indicator && typeof this._indicator._saveCurrentConfig === "function") {
            this._indicator._saveCurrentConfig(config);
          }
          this.refresh();
          return Clutter.EVENT_STOP;
        }

        let pressedKey = null;
        if (symbol >= Clutter.KEY_KP_0 && symbol <= Clutter.KEY_KP_9) {
          pressedKey = String(symbol - Clutter.KEY_KP_0);
        } else if (symbol >= Clutter.KEY_0 && symbol <= Clutter.KEY_9) {
          pressedKey = String(symbol - Clutter.KEY_0);
        }

        if (pressedKey !== null) {
          const cmdInfo = getNumpadKeyCommand(config, pressedKey);
          this.close();
          if (cmdInfo && cmdInfo.command && this._indicator && typeof this._indicator.executeCommand === "function") {
            this._indicator.executeCommand(cmdInfo.name, cmdInfo.command, {}, { name: cmdInfo.name, command: cmdInfo.command });
          }
          return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
      });

      this._dialog.open();
      this._isVisible = true;
    } catch (e) {
      console.error(`CmdBar NumpadOverlay error: ${e.message}`);
    }
  }

  async refresh() {
    if (this._isVisible) {
      this.close();
      await this.show();
    }
  }

  close() {
    if (this._dialog) {
      try {
        this._dialog.close();
      } catch (e) {}
      this._dialog = null;
    }
    this._isVisible = false;
  }
}
