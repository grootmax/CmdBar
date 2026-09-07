/**
 * Numpad Macro Pad Manager and Visual Overlay HUD for CmdBar.
 * Manages 10 instant commands per layer (0-9), layer switching, and visual overlay HUD.
 */

export const DEFAULT_NUMPAD_CONFIG = {
  enabled: true,
  active_layer: 0,
  overlay_visible: false,
  layers: [
    {
      id: "default",
      name: "Default",
      bindings: {
        "0": { name: "System Status", command: "top -b -n 1 | head -n 10" },
        "1": { name: "Build Project", command: "make build" },
        "2": { name: "Run Tests", command: "npm test" },
        "3": { name: "Deploy Staging", command: "echo Deploying to staging" },
        "4": { name: "Mute Audio", command: "pactl set-sink-mute @DEFAULT_SINK@ toggle" },
        "5": { name: "Play/Pause Media", command: "playerctl play-pause" },
        "6": { name: "Screenshot Region", command: "gnome-screenshot -a" },
        "7": { name: "Toggle Terminal", command: "gnome-terminal" },
        "8": { name: "Git Status", command: "git status" },
        "9": { name: "Clear Cache", command: "sync; echo 3 > /proc/sys/vm/drop_caches" }
      }
    },
    {
      id: "gaming",
      name: "Gaming",
      bindings: {
        "0": { name: "Mute Mic", command: "pactl set-source-mute @DEFAULT_SOURCE@ toggle" },
        "1": { name: "FPS Overlay", command: "mangohud --toggle" },
        "2": { name: "Record Replay", command: "obs-cli replay-save" },
        "3": { name: "Discord Overlay", command: "discord-overlay-toggle" },
        "4": { name: "Volume Down", command: "pactl set-sink-volume @DEFAULT_SINK@ -5%" },
        "5": { name: "Volume Up", command: "pactl set-sink-volume @DEFAULT_SINK@ +5%" },
        "6": { name: "Game Mode Toggle", command: "gamemoded -t" },
        "7": { name: "Performance Mode", command: "powerprofilesctl set performance" },
        "8": { name: "Balanced Mode", command: "powerprofilesctl set balanced" },
        "9": { name: "Power Saver Mode", command: "powerprofilesctl set power-saver" }
      }
    },
    {
      id: "dev",
      name: "Developer",
      bindings: {
        "0": { name: "Git Pull", command: "git pull origin main" },
        "1": { name: "Git Push", command: "git push origin" },
        "2": { name: "Docker PS", command: "docker ps" },
        "3": { name: "Docker Up", command: "docker-compose up -d" },
        "4": { name: "Docker Down", command: "docker-compose down" },
        "5": { name: "Logs Tail", command: "journalctl -f -u cmdbar" },
        "6": { name: "Lint Code", command: "npm run lint" },
        "7": { name: "Build Docs", command: "make compile" },
        "8": { name: "Serve Docs", command: "python3 scripts/serve_docs.py" },
        "9": { name: "Clean Build", command: "make clean" }
      }
    }
  ]
};

export class NumpadManager {
  constructor(options = {}) {
    this._config = options.config || null;
    this._onExecuteCommand = options.onExecuteCommand || null;
    this._overlayActor = null;
    this._isVisible = false;
  }

  setConfig(config) {
    this._config = config;
    if (this._overlayActor && this._isVisible) {
      this.updateOverlay();
    }
  }

  getConfig() {
    return this._config || {};
  }

  getNumpadConfig() {
    const cfg = this.getConfig();
    if (!cfg.numpad || typeof cfg.numpad !== "object") {
      cfg.numpad = JSON.parse(JSON.stringify(DEFAULT_NUMPAD_CONFIG));
    }
    const np = cfg.numpad;
    if (!Array.isArray(np.layers)) {
      np.layers = JSON.parse(JSON.stringify(DEFAULT_NUMPAD_CONFIG.layers));
    }
    return np;
  }

  isEnabled() {
    const np = this.getNumpadConfig();
    return np.enabled !== false;
  }

  setEnabled(enabled) {
    const np = this.getNumpadConfig();
    np.enabled = Boolean(enabled);
  }

  getLayers() {
    const np = this.getNumpadConfig();
    return Array.isArray(np.layers) ? np.layers : [];
  }

  getActiveLayerIndex() {
    const np = this.getNumpadConfig();
    const layers = this.getLayers();
    if (layers.length === 0) return 0;
    let idx = typeof np.active_layer === "number" ? np.active_layer : 0;
    if (typeof np.active_layer === "string") {
      const foundIdx = layers.findIndex(
        (l) => l.id === np.active_layer || l.name === np.active_layer
      );
      if (foundIdx !== -1) idx = foundIdx;
      else idx = parseInt(np.active_layer, 10) || 0;
    }
    if (idx < 0 || idx >= layers.length) {
      idx = 0;
    }
    return idx;
  }

  getActiveLayer() {
    const layers = this.getLayers();
    const idx = this.getActiveLayerIndex();
    return layers[idx] || null;
  }

  switchLayer(target) {
    const np = this.getNumpadConfig();
    const layers = this.getLayers();
    if (layers.length === 0) return 0;

    let newIdx = 0;
    if (typeof target === "number") {
      newIdx = target % layers.length;
      if (newIdx < 0) newIdx += layers.length;
    } else if (typeof target === "string") {
      const foundIdx = layers.findIndex(
        (l) => l.id === target || l.name === target
      );
      if (foundIdx !== -1) {
        newIdx = foundIdx;
      } else {
        const parsed = parseInt(target, 10);
        newIdx = isNaN(parsed) ? 0 : Math.abs(parsed) % layers.length;
      }
    }
    np.active_layer = newIdx;
    if (this._isVisible) {
      this.updateOverlay();
    }
    return newIdx;
  }

  cycleLayer() {
    const layers = this.getLayers();
    if (layers.length === 0) return 0;
    const currentIdx = this.getActiveLayerIndex();
    const nextIdx = (currentIdx + 1) % layers.length;
    return this.switchLayer(nextIdx);
  }

  getBinding(keyDigit) {
    const keyStr = String(keyDigit);
    const activeLayer = this.getActiveLayer();
    if (!activeLayer || !activeLayer.bindings) return null;
    return activeLayer.bindings[keyStr] || null;
  }

  setBinding(layerIndexOrId, keyDigit, bindingObj) {
    const layers = this.getLayers();
    let layer = null;
    if (typeof layerIndexOrId === "number" && layerIndexOrId >= 0 && layerIndexOrId < layers.length) {
      layer = layers[layerIndexOrId];
    } else if (typeof layerIndexOrId === "string") {
      layer = layers.find((l) => l.id === layerIndexOrId || l.name === layerIndexOrId);
      if (!layer) {
        const parsed = parseInt(layerIndexOrId, 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed < layers.length) {
          layer = layers[parsed];
        }
      }
    }
    if (!layer) return false;
    if (!layer.bindings || typeof layer.bindings !== "object") {
      layer.bindings = {};
    }
    layer.bindings[String(keyDigit)] = bindingObj;
    if (this._isVisible) {
      this.updateOverlay();
    }
    return true;
  }

  triggerKey(keyDigit) {
    if (!this.isEnabled()) {
      return { success: false, reason: "Numpad disabled" };
    }
    const binding = this.getBinding(keyDigit);
    if (!binding || (!binding.command && !binding.template)) {
      return { success: false, reason: `No binding for key ${keyDigit}` };
    }
    const name = binding.name || `Numpad Key ${keyDigit}`;
    const cmd = binding.command || binding.template;

    if (typeof this._onExecuteCommand === "function") {
      this._onExecuteCommand(name, cmd, binding);
    }
    return { success: true, key: parseInt(keyDigit, 10), name, command: cmd };
  }

  toggleOverlay() {
    this._isVisible = !this._isVisible;
    const np = this.getNumpadConfig();
    np.overlay_visible = this._isVisible;
    if (this._isVisible) {
      this.showOverlay();
    } else {
      this.hideOverlay();
    }
    return this._isVisible;
  }

  isOverlayVisible() {
    return this._isVisible;
  }

  getOverlayData() {
    const layer = this.getActiveLayer();
    const layers = this.getLayers();
    const activeIdx = this.getActiveLayerIndex();
    const bindings = (layer && layer.bindings) ? layer.bindings : {};

    const gridKeys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0"];
    const grid = gridKeys.map((k) => {
      const b = bindings[k] || null;
      const cmd = b ? (b.command || b.template || "") : "";
      return {
        key: k,
        name: b ? (b.name || "Command") : "Unbound",
        command: cmd,
        bound: Boolean(b && cmd),
      };
    });

    return {
      enabled: this.isEnabled(),
      activeLayerIndex: activeIdx,
      activeLayerName: layer ? layer.name : "None",
      layerCount: layers.length,
      layers: layers.map((l, i) => ({
        index: i,
        name: l.name || `Layer ${i}`,
        id: l.id || `layer-${i}`,
        active: i === activeIdx,
      })),
      grid,
    };
  }

  formatOverlayAscii() {
    const data = this.getOverlayData();
    let lines = [];
    lines.push("+---------------------------------------------+");
    lines.push(`| CmdBar Numpad Macro Pad - Layer: ${data.activeLayerName.slice(0, 11).padEnd(11)}|`);
    lines.push("+---------------------------------------------+");
    const findKey = (k) => data.grid.find((item) => item.key === k) || { name: "Unbound" };

    const k7 = findKey("7"), k8 = findKey("8"), k9 = findKey("9");
    lines.push(`| [7] ${k7.name.slice(0, 10).padEnd(10)} | [8] ${k8.name.slice(0, 10).padEnd(10)} | [9] ${k9.name.slice(0, 10).padEnd(10)} |`);

    const k4 = findKey("4"), k5 = findKey("5"), k6 = findKey("6");
    lines.push(`| [4] ${k4.name.slice(0, 10).padEnd(10)} | [5] ${k5.name.slice(0, 10).padEnd(10)} | [6] ${k6.name.slice(0, 10).padEnd(10)} |`);

    const k1 = findKey("1"), k2 = findKey("2"), k3 = findKey("3");
    lines.push(`| [1] ${k1.name.slice(0, 10).padEnd(10)} | [2] ${k2.name.slice(0, 10).padEnd(10)} | [3] ${k3.name.slice(0, 10).padEnd(10)} |`);

    const k0 = findKey("0");
    lines.push(`| [0] ${k0.name.slice(0, 38).padEnd(38)} |`);
    lines.push("+---------------------------------------------+");
    return lines.join("\n");
  }

  showOverlay() {
    this._isVisible = true;
    this.updateOverlay();
  }

  hideOverlay() {
    this._isVisible = false;
    if (this._overlayActor) {
      try {
        if (typeof this._overlayActor.destroy === "function") {
          this._overlayActor.destroy();
        }
      } catch (e) {}
      this._overlayActor = null;
    }
  }

  updateOverlay() {
    if (!this._isVisible) return;
    try {
      let StModule = typeof St !== "undefined" ? St : null;
      let MainModule = typeof Main !== "undefined" ? Main : null;

      if (!StModule || !MainModule) {
        if (typeof globalThis !== "undefined") {
          StModule = globalThis.St || StModule;
          MainModule = globalThis.Main || MainModule;
        }
      }

      if (StModule && MainModule && MainModule.layoutManager && MainModule.layoutManager.uiGroup) {
        if (this._overlayActor) {
          try {
            this._overlayActor.destroy();
          } catch (e) {}
          this._overlayActor = null;
        }

        const data = this.getOverlayData();

        let box = new StModule.BoxLayout({
          vertical: true,
          style_class: "cmdbar-numpad-overlay-box",
          style: "background-color: rgba(20, 20, 25, 0.92); border-radius: 12px; padding: 16px; border: 2px solid #3584e4; min-width: 360px;",
        });

        // Header
        let headerBox = new StModule.BoxLayout({
          vertical: false,
          style: "margin-bottom: 12px;",
        });
        let layerLabel = new StModule.Label({
          text: `Numpad Macro Pad: ${data.activeLayerName}`,
          style: "font-weight: bold; font-size: 1.1em; color: #ffffff;",
          x_expand: true,
        });
        headerBox.add_child(layerLabel);

        let statusLabel = new StModule.Label({
          text: data.enabled ? "ACTIVE" : "OFF",
          style: `font-size: 0.85em; font-weight: bold; color: ${data.enabled ? '#33d17a' : '#e01b24'};`,
        });
        headerBox.add_child(statusLabel);
        box.add_child(headerBox);

        // Layer pills
        if (data.layerCount > 1) {
          let layersBox = new StModule.BoxLayout({
            vertical: false,
            style: "margin-bottom: 12px;",
          });
          data.layers.forEach((l) => {
            let pill = new StModule.Label({
              text: ` ${l.name} `,
              style: l.active
                ? "background-color: #3584e4; color: white; border-radius: 6px; margin-right: 6px; font-weight: bold;"
                : "background-color: rgba(255,255,255,0.1); color: #ccc; border-radius: 6px; margin-right: 6px;",
            });
            layersBox.add_child(pill);
          });
          box.add_child(layersBox);
        }

        // 10-key grid
        const gridBox = new StModule.BoxLayout({
          vertical: true,
          style: "margin-bottom: 8px;",
        });

        const rows = [
          ["7", "8", "9"],
          ["4", "5", "6"],
          ["1", "2", "3"],
          ["0"]
        ];

        rows.forEach((rowKeys) => {
          let rowBox = new StModule.BoxLayout({
            vertical: false,
            style: "margin-bottom: 6px;",
          });
          rowKeys.forEach((key) => {
            const item = data.grid.find((g) => g.key === key) || { name: "Unbound", bound: false };
            let keyBox = new StModule.BoxLayout({
              vertical: true,
              style: item.bound
                ? "background-color: rgba(53, 132, 228, 0.25); border: 1px solid #3584e4; border-radius: 8px; padding: 8px; margin: 3px; min-width: 100px;"
                : "background-color: rgba(255, 255, 255, 0.05); border: 1px dashed rgba(255,255,255,0.2); border-radius: 8px; padding: 8px; margin: 3px; min-width: 100px;",
              x_expand: key === "0",
            });

            let kLabel = new StModule.Label({
              text: `[Key ${key}]`,
              style: "font-weight: bold; color: #3584e4; font-size: 0.8em;",
            });
            let nLabel = new StModule.Label({
              text: item.name,
              style: item.bound ? "color: #ffffff; font-weight: bold;" : "color: #888888;",
            });

            keyBox.add_child(kLabel);
            keyBox.add_child(nLabel);
            rowBox.add_child(keyBox);
          });
          gridBox.add_child(rowBox);
        });

        box.add_child(gridBox);

        // Help text
        let helpLabel = new StModule.Label({
          text: "Press Super+KP_Add to switch layer | Super+KP_Subtract to hide",
          style: "font-size: 0.8em; color: #aaaaaa; font-style: italic;",
        });
        box.add_child(helpLabel);

        this._overlayActor = box;
        MainModule.layoutManager.uiGroup.add_child(this._overlayActor);

        const monitor = MainModule.layoutManager.primaryMonitor;
        if (monitor) {
          this._overlayActor.set_position(
            monitor.x + Math.floor((monitor.width - 380) / 2),
            monitor.y + Math.floor((monitor.height - 300) / 2)
          );
        }
      }
    } catch (e) {
      console.warn("NumpadOverlay render notice:", e.message);
    }
  }

  destroy() {
    this.hideOverlay();
    this._config = null;
    this._onExecuteCommand = null;
  }
}
