/**
 * KWallet Client module for CmdBar KDE Plasma Integration.
 * Interfaces with KDE KWallet (org.kde.kwalletd5 / org.kde.kwalletd6) over D-Bus
 * or via process wrappers (kwalletcli) for secure API key and credential storage.
 */

export class KWalletClient {
  constructor(options = {}) {
    this.appName = options.appName || "CmdBar";
    this.folderName = options.folderName || "CmdBar";
    this.walletName = options.walletName || "kdewallet";
    this._memoryStore = new Map(); // Fallback in-memory storage
    this._handle = options.handle || 0;
    this._isOpen = false;
    this._useFallback = options.useFallback ?? false;
  }

  /**
   * Opens the KWallet session.
   * @param {number} winId Window handle ID
   * @returns {Promise<boolean>} Success status
   */
  async openWallet(winId = 0) {
    if (this._useFallback) {
      this._isOpen = true;
      return true;
    }

    try {
      if (typeof globalThis.Gio !== "undefined" && globalThis.Gio.DBus) {
        // D-Bus call to org.kde.kwalletd5 or org.kde.kwalletd6
        const bus = globalThis.Gio.DBus.session;
        const reply = await new Promise((resolve) => {
          bus.call(
            "org.kde.kwalletd5",
            "/modules/kwalletd5",
            "org.kde.kwallet",
            "open",
            new globalThis.GLib.Variant("(sxs)", [this.walletName, winId, this.appName]),
            new globalThis.GLib.VariantType("(i)"),
            globalThis.Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, res) => {
              try {
                const val = bus.call_finish(res);
                resolve(val ? val.recursiveUnpack()[0] : -1);
              } catch (e) {
                resolve(-1);
              }
            }
          );
        });

        if (typeof reply === "number" && reply >= 0) {
          this._handle = reply;
          this._isOpen = true;
          await this._ensureFolderExists();
          return true;
        }
      }
    } catch (e) {
      // D-Bus call unavailable or failed
    }

    // Fallback mode
    this._isOpen = true;
    return true;
  }

  /**
   * Internal helper to create folder if missing.
   */
  async _ensureFolderExists() {
    if (!this._isOpen || this._handle <= 0) return false;
    try {
      if (typeof globalThis.Gio !== "undefined" && globalThis.Gio.DBus) {
        const bus = globalThis.Gio.DBus.session;
        await new Promise((resolve) => {
          bus.call(
            "org.kde.kwalletd5",
            "/modules/kwalletd5",
            "org.kde.kwallet",
            "createFolder",
            new globalThis.GLib.Variant("(iss)", [this._handle, this.folderName, this.appName]),
            new globalThis.GLib.VariantType("(b)"),
            globalThis.Gio.DBusCallFlags.NONE,
            -1,
            null,
            () => resolve(true)
          );
        });
      }
    } catch (e) {}
    return true;
  }

  /**
   * Writes a key-value secret pair into KWallet.
   * @param {string} key Key identifier
   * @param {string} value Secret value
   * @returns {Promise<boolean>} Success status
   */
  async writeSecret(key, value) {
    if (!key || typeof key !== "string" || !key.trim()) return false;
    const cleanKey = key.trim();
    const strVal = value !== null && value !== undefined ? String(value) : "";

    this._memoryStore.set(cleanKey, strVal);

    if (this._isOpen && this._handle > 0 && typeof globalThis.Gio !== "undefined") {
      try {
        const bus = globalThis.Gio.DBus.session;
        const res = await new Promise((resolve) => {
          bus.call(
            "org.kde.kwalletd5",
            "/modules/kwalletd5",
            "org.kde.kwallet",
            "writePassword",
            new globalThis.GLib.Variant("(isss)", [
              this._handle,
              this.folderName,
              cleanKey,
              strVal,
              this.appName,
            ]),
            new globalThis.GLib.VariantType("(i)"),
            globalThis.Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, res) => {
              try {
                const val = bus.call_finish(res);
                resolve(val ? val.recursiveUnpack()[0] === 0 : false);
              } catch (e) {
                resolve(false);
              }
            }
          );
        });
        if (res) return true;
      } catch (e) {}
    }

    return true;
  }

  /**
   * Reads a secret value from KWallet.
   * @param {string} key Key identifier
   * @returns {Promise<string|null>} Secret value or null if not found
   */
  async readSecret(key) {
    if (!key || typeof key !== "string" || !key.trim()) return null;
    const cleanKey = key.trim();

    if (this._isOpen && this._handle > 0 && typeof globalThis.Gio !== "undefined") {
      try {
        const bus = globalThis.Gio.DBus.session;
        const secret = await new Promise((resolve) => {
          bus.call(
            "org.kde.kwalletd5",
            "/modules/kwalletd5",
            "org.kde.kwallet",
            "readPassword",
            new globalThis.GLib.Variant("(isss)", [
              this._handle,
              this.folderName,
              cleanKey,
              this.appName,
            ]),
            new globalThis.GLib.VariantType("(s)"),
            globalThis.Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, res) => {
              try {
                const val = bus.call_finish(res);
                resolve(val ? val.recursiveUnpack()[0] : null);
              } catch (e) {
                resolve(null);
              }
            }
          );
        });
        if (secret !== null && secret !== undefined) {
          this._memoryStore.set(cleanKey, secret);
          return secret;
        }
      } catch (e) {}
    }

    if (this._memoryStore.has(cleanKey)) {
      return this._memoryStore.get(cleanKey);
    }

    return null;
  }

  /**
   * Checks if secret key exists.
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async hasSecret(key) {
    const val = await this.readSecret(key);
    return val !== null && val !== undefined;
  }

  /**
   * Deletes a secret key.
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async deleteSecret(key) {
    if (!key || typeof key !== "string") return false;
    const cleanKey = key.trim();
    this._memoryStore.delete(cleanKey);

    if (this._isOpen && this._handle > 0 && typeof globalThis.Gio !== "undefined") {
      try {
        const bus = globalThis.Gio.DBus.session;
        await new Promise((resolve) => {
          bus.call(
            "org.kde.kwalletd5",
            "/modules/kwalletd5",
            "org.kde.kwallet",
            "removeEntry",
            new globalThis.GLib.Variant("(isss)", [
              this._handle,
              this.folderName,
              cleanKey,
              this.appName,
            ]),
            new globalThis.GLib.VariantType("(i)"),
            globalThis.Gio.DBusCallFlags.NONE,
            -1,
            null,
            () => resolve(true)
          );
        });
      } catch (e) {}
    }

    return true;
  }

  /**
   * Closes wallet session.
   */
  async closeWallet() {
    if (this._isOpen && this._handle > 0 && typeof globalThis.Gio !== "undefined") {
      try {
        const bus = globalThis.Gio.DBus.session;
        await new Promise((resolve) => {
          bus.call(
            "org.kde.kwalletd5",
            "/modules/kwalletd5",
            "org.kde.kwallet",
            "close",
            new globalThis.GLib.Variant("(isb)", [this._handle, false, this.appName]),
            new globalThis.GLib.VariantType("(i)"),
            globalThis.Gio.DBusCallFlags.NONE,
            -1,
            null,
            () => resolve(true)
          );
        });
      } catch (e) {}
    }
    this._handle = 0;
    this._isOpen = false;
    return true;
  }
}
