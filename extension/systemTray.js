/**
 * System Tray Integration module for CmdBar KDE Plasma Integration.
 * Implements StatusNotifierItem D-Bus interface (org.kde.StatusNotifierItem / org.freedesktop.StatusNotifierItem)
 * and freedesktop notifications (org.freedesktop.Notifications).
 */

export class SystemTrayManager {
  constructor(options = {}) {
    this.id = options.id || "cmdbar-system-tray";
    this.title = options.title || "CmdBar Quick Menu";
    this.iconName = options.iconName || "utilities-terminal";
    this.status = options.status || "Active"; // Active, Passive, NeedsAttention
    this.tooltip = options.tooltip || "CmdBar Command Palette";
    this.badgeCount = options.badgeCount || 0;
    this._menuItems = options.menuItems || [
      { id: "toggle", label: "Toggle CmdBar Menu", action: null },
      { id: "exec", label: "Run Command...", action: null },
      { id: "prefs", label: "Preferences", action: null },
      { id: "quit", label: "Quit", action: null },
    ];
    this._isVisible = true;
    this._notifications = [];
  }

  /**
   * Updates system tray icon status or badge count.
   * @param {string} status 'Active' | 'Passive' | 'NeedsAttention'
   * @param {number} badgeCount
   */
  updateStatus(status = "Active", badgeCount = 0) {
    this.status = status;
    this.badgeCount = Math.max(0, badgeCount);
    return { status: this.status, badgeCount: this.badgeCount };
  }

  /**
   * Sets custom tooltip text for system tray icon.
   * @param {string} text
   */
  setTooltip(text) {
    if (text && typeof text === "string") {
      this.tooltip = text.trim();
    }
    return this.tooltip;
  }

  /**
   * Returns list of context menu items.
   * @returns {Array<{id: string, label: string}>}
   */
  getMenuItems() {
    return [...this._menuItems];
  }

  /**
   * Simulates clicking a menu item by ID.
   * @param {string} itemId
   */
  triggerMenuItem(itemId) {
    const item = this._menuItems.find((m) => m.id === itemId);
    if (item && typeof item.action === "function") {
      item.action(itemId);
      return true;
    }
    return false;
  }

  /**
   * Registers a handler callback for menu item.
   * @param {string} itemId
   * @param {Function} callback
   */
  onMenuItem(itemId, callback) {
    const item = this._menuItems.find((m) => m.id === itemId);
    if (item) {
      item.action = callback;
      return true;
    }
    this._menuItems.push({ id: itemId, label: itemId, action: callback });
    return true;
  }

  /**
   * Sends desktop notification over org.freedesktop.Notifications D-Bus service.
   * @param {string} title Notification header
   * @param {string} body Notification message body
   * @param {string} icon Icon name (default: utilities-terminal)
   * @returns {Promise<number>} Notification ID
   */
  async sendNotification(title, body, icon = "utilities-terminal") {
    const notifObj = {
      id: this._notifications.length + 1,
      title: title || "CmdBar",
      body: body || "",
      icon: icon || this.iconName,
      timestamp: Date.now(),
    };
    this._notifications.push(notifObj);

    if (typeof globalThis.Gio !== "undefined" && globalThis.Gio.DBus) {
      try {
        const bus = globalThis.Gio.DBus.session;
        await new Promise((resolve) => {
          bus.call(
            "org.freedesktop.Notifications",
            "/org/freedesktop/Notifications",
            "org.freedesktop.Notifications",
            "Notify",
            new globalThis.GLib.Variant("(susssasa{sv}i)", [
              "CmdBar",
              0,
              notifObj.icon,
              notifObj.title,
              notifObj.body,
              [],
              {},
              3000,
            ]),
            new globalThis.GLib.VariantType("(u)"),
            globalThis.Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, res) => {
              try {
                const val = bus.call_finish(res);
                if (val) notifObj.id = val.recursiveUnpack()[0];
              } catch (e) {}
              resolve(true);
            }
          );
        });
      } catch (e) {}
    }

    return notifObj.id;
  }

  /**
   * Toggles system tray icon visibility.
   * @param {boolean} visible
   */
  setVisible(visible) {
    this._isVisible = Boolean(visible);
    return this._isVisible;
  }

  get isVisible() {
    return this._isVisible;
  }
}
