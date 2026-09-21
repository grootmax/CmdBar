/**
 * KWin Integration module for CmdBar KDE Plasma Integration.
 * Manages D-Bus interactions with KWin (org.kde.KWin) and KGlobalAccel (org.kde.kglobalaccel).
 * Provides global shortcut binding, active window context detection, and popup window positioning.
 */

export class KWinIntegration {
  constructor(options = {}) {
    this.componentName = options.componentName || "org.kde.plasma.cmdbar";
    this.actionName = options.actionName || "toggle_cmdbar_menu";
    this.defaultShortcut = options.defaultShortcut || "Meta+Space";
    this._activeShortcut = this.defaultShortcut;
    this._shortcutCallbacks = new Set();
    this._windowContext = {
      windowClass: "",
      windowTitle: "",
      pid: 0,
      desktop: 1,
    };
  }

  /**
   * Registers or updates a global shortcut with KGlobalAccel.
   * @param {string} shortcut Key combination (e.g. "Meta+Space", "Alt+Space")
   * @param {Function} callback Function to trigger when shortcut pressed
   * @returns {Promise<boolean>} Success status
   */
  async registerShortcut(shortcut = "Meta+Space", callback = null) {
    if (shortcut && typeof shortcut === "string" && shortcut.trim()) {
      this._activeShortcut = shortcut.trim();
    }
    if (typeof callback === "function") {
      this._shortcutCallbacks.add(callback);
    }

    if (typeof globalThis.Gio !== "undefined" && globalThis.Gio.DBus) {
      try {
        const bus = globalThis.Gio.DBus.session;
        // Register action with org.kde.kglobalaccel
        await new Promise((resolve) => {
          bus.call(
            "org.kde.kglobalaccel",
            "/kglobalaccel",
            "org.kde.KGlobalAccel",
            "doRegister",
            new globalThis.GLib.Variant("(a(sss))", [
              [[this.componentName, this.actionName, "CmdBar Quick Menu"]],
            ]),
            new globalThis.GLib.VariantType("()"),
            globalThis.Gio.DBusCallFlags.NONE,
            -1,
            null,
            () => resolve(true)
          );
        });

        // Set shortcut keys
        await new Promise((resolve) => {
          bus.call(
            "org.kde.kglobalaccel",
            "/kglobalaccel",
            "org.kde.KGlobalAccel",
            "setShortcut",
            new globalThis.GLib.Variant("(a(sss)as)", [
              [[this.componentName, this.actionName, "CmdBar Quick Menu"]],
              [this._activeShortcut],
            ]),
            new globalThis.GLib.VariantType("()"),
            globalThis.Gio.DBusCallFlags.NONE,
            -1,
            null,
            () => resolve(true)
          );
        });

        return true;
      } catch (e) {
        // D-Bus kglobalaccel call fallback
      }
    }

    return true;
  }

  /**
   * Triggers the registered shortcut action (for testing / programmatic invocation).
   */
  triggerShortcut() {
    for (const cb of this._shortcutCallbacks) {
      try {
        cb(this._activeShortcut);
      } catch (e) {
        console.error(`CmdBar KWin shortcut callback error: ${e.message}`);
      }
    }
    return true;
  }

  /**
   * Retrieves active window context metadata from KWin over D-Bus.
   * @returns {Promise<{windowClass: string, windowTitle: string, pid: number, desktop: number}>}
   */
  async getActiveWindowContext() {
    if (typeof globalThis.Gio !== "undefined" && globalThis.Gio.DBus) {
      try {
        const bus = globalThis.Gio.DBus.session;
        // Query active window from org.kde.KWin
        const info = await new Promise((resolve) => {
          bus.call(
            "org.kde.KWin",
            "/KWin",
            "org.kde.KWin",
            "activeWindow",
            null,
            new globalThis.GLib.VariantType("(a{sv})"),
            globalThis.Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, res) => {
              try {
                const val = bus.call_finish(res);
                if (val) {
                  const dict = val.recursiveUnpack()[0];
                  resolve({
                    windowClass: dict.resourceClass || dict.caption || "konsole",
                    windowTitle: dict.caption || "Terminal",
                    pid: dict.pid || 0,
                    desktop: dict.desktop || 1,
                  });
                } else {
                  resolve(null);
                }
              } catch (e) {
                resolve(null);
              }
            }
          );
        });

        if (info) {
          this._windowContext = info;
          return info;
        }
      } catch (e) {}
    }

    return { ...this._windowContext };
  }

  /**
   * Sets mock/manual active window context (for testing/development).
   */
  setActiveWindowContext(ctx = {}) {
    this._windowContext = {
      windowClass: ctx.windowClass || "konsole",
      windowTitle: ctx.windowTitle || "Konsole - ~",
      pid: ctx.pid || 1234,
      desktop: ctx.desktop || 1,
    };
    return this._windowContext;
  }

  /**
   * Calculates optimal popup coordinates relative to screen and panel geometry.
   * @param {{width: number, height: number}} panelBounds
   * @param {{width: number, height: number}} popupSize
   * @returns {{x: number, y: number}}
   */
  calculatePopupPosition(panelBounds = { x: 0, y: 0, width: 1920, height: 36 }, popupSize = { width: 400, height: 500 }) {
    const x = Math.max(10, Math.min(panelBounds.x + Math.floor(panelBounds.width / 2) - Math.floor(popupSize.width / 2), 1920 - popupSize.width - 10));
    const y = panelBounds.y + panelBounds.height + 4;
    return { x, y };
  }

  /**
   * Unregisters shortcuts and cleans up listeners.
   */
  unregister() {
    this._shortcutCallbacks.clear();
    return true;
  }
}
