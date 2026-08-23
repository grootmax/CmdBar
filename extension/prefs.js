import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";
import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

/**
 * Format GSettings accelerator string into human-readable shortcut hint.
 * @param {string|string[]} accel
 * @returns {string}
 */
function formatShortcutHint(accel) {
  let str = Array.isArray(accel) ? (accel[0] || "") : (accel || "");
  if (!str) return "Super+Space";

  let parts = [];
  if (/<Control>/i.test(str) || /<Ctrl>/i.test(str)) parts.push("Ctrl");
  if (/<Alt>/i.test(str)) parts.push("Alt");
  if (/<Super>/i.test(str) || /<Meta>/i.test(str)) parts.push("Super");
  if (/<Shift>/i.test(str)) parts.push("Shift");

  let baseKey = str.replace(/<[^>]+>/g, "").trim();
  if (baseKey) {
    if (baseKey.toLowerCase() === "space") {
      baseKey = "Space";
    } else if (baseKey.length === 1) {
      baseKey = baseKey.toUpperCase();
    } else {
      baseKey = baseKey.charAt(0).toUpperCase() + baseKey.slice(1);
    }
    parts.push(baseKey);
  }

  return parts.join("+") || "Super+Space";
}

/**
 * Parse user-entered keybinding string or shortcut into GSettings accelerator array.
 * Handles modifier keys (Ctrl, Alt, Super, Shift).
 * @param {string} text
 * @returns {string[]}
 */
function parseAccel(text) {
  if (!text || !text.trim()) return ["<Super>space"];

  let input = text.trim();
  if (input.startsWith("<") && input.includes(">")) {
    return [input];
  }

  let parts = input.split("+").map((p) => p.trim());
  let modifiers = "";
  let baseKey = "";

  for (let part of parts) {
    let lower = part.toLowerCase();
    if (lower === "super" || lower === "meta") {
      modifiers += "<Super>";
    } else if (lower === "alt") {
      modifiers += "<Alt>";
    } else if (lower === "ctrl" || lower === "control") {
      modifiers += "<Control>";
    } else if (lower === "shift") {
      modifiers += "<Shift>";
    } else {
      baseKey = lower;
    }
  }

  if (!baseKey) baseKey = "space";
  if (!modifiers) modifiers = "<Super>";

  return [`${modifiers}${baseKey}`];
}

/**
 * CmdBarExtension preferences UI window configuration.
 */
export default class CmdBarPreferences extends ExtensionPreferences {
  /**
   * Fill the preferences window with settings controls.
   * @param {Adw.PreferencesWindow} window
   */
  fillPreferencesWindow(window) {
    const settings = this.getSettings();

    const page = new Adw.PreferencesPage({
      title: _("General"),
      iconName: "preferences-system-symbolic",
    });
    window.add(page);

    const group = new Adw.PreferencesGroup({
      title: _("Indicator Settings"),
    });
    page.add(group);

    const showRow = new Adw.SwitchRow({
      title: _("Show Indicator"),
      subtitle: _("Toggle CmdBar in the top panel"),
    });
    group.add(showRow);
    settings.bind(
      "show-indicator",
      showRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );

    const placeholderRow = new Adw.EntryRow({
      title: _("Default Placeholder Text"),
      show_apply_button: false,
    });
    group.add(placeholderRow);
    settings.bind(
      "placeholder-text",
      placeholderRow,
      "text",
      Gio.SettingsBindFlags.DEFAULT,
    );

    const labelRow = new Adw.EntryRow({
      title: _("Button Label"),
      show_apply_button: false,
    });
    group.add(labelRow);
    settings.bind(
      "button-label",
      labelRow,
      "text",
      Gio.SettingsBindFlags.DEFAULT,
    );

    // Keyboard Shortcut Group
    const shortcutGroup = new Adw.PreferencesGroup({
      title: _("Keyboard Shortcut"),
      description: _("Global shortcut to open CmdBar menu from anywhere"),
    });
    page.add(shortcutGroup);

    const presets = [
      { label: _("Super+Space (Default)"), accel: "<Super>space" },
      { label: _("Alt+Space"), accel: "<Alt>space" },
      { label: _("Super+Shift+Space"), accel: "<Super><Shift>space" },
      { label: _("Custom Keybinding"), accel: null },
    ];

    const modelList = new Gtk.StringList();
    presets.forEach((p) => modelList.append(p.label));

    const comboRow = new Adw.ComboRow({
      title: _("Shortcut Preset"),
      model: modelList,
    });
    shortcutGroup.add(comboRow);

    const customRow = new Adw.EntryRow({
      title: _("Custom Shortcut"),
      subtitle: _("e.g. <Control><Alt>space or Super+Shift+Space"),
      show_apply_button: true,
    });
    shortcutGroup.add(customRow);

    let updatingUI = false;

    const syncUIFromSettings = () => {
      updatingUI = true;
      let currentStrv = settings.get_strv("shortcut");
      let currentAccel =
        Array.isArray(currentStrv) && currentStrv.length > 0
          ? currentStrv[0]
          : "<Super>space";

      let matchedIndex = presets.findIndex(
        (p) => p.accel && p.accel.toLowerCase() === currentAccel.toLowerCase(),
      );

      if (matchedIndex >= 0) {
        comboRow.selected = matchedIndex;
      } else {
        comboRow.selected = 3; // Custom Keybinding
      }

      customRow.text = formatShortcutHint(currentAccel);
      updatingUI = false;
    };

    syncUIFromSettings();

    comboRow.connect("notify::selected", () => {
      if (updatingUI) return;
      let selectedIdx = comboRow.selected;
      if (selectedIdx >= 0 && selectedIdx < 3) {
        let selectedAccel = presets[selectedIdx].accel;
        settings.set_strv("shortcut", [selectedAccel]);
        syncUIFromSettings();
      }
    });

    customRow.connect("apply", () => {
      if (updatingUI) return;
      let text = customRow.text;
      let parsed = parseAccel(text);
      settings.set_strv("shortcut", parsed);
      syncUIFromSettings();
    });

    // Numpad Macro Pad Group
    const numpadGroup = new Adw.PreferencesGroup({
      title: _("Numpad Macro Pad"),
      description: _("10 instant macro commands (0-9) with configurable layers and visual overlay HUD"),
    });
    page.add(numpadGroup);

    const numpadEnableRow = new Adw.SwitchRow({
      title: _("Enable Numpad Macro Pad"),
      subtitle: _("Enable instant numpad keybindings (0-9) and macro mode"),
    });
    numpadGroup.add(numpadEnableRow);
    settings.bind(
      "numpad-enabled",
      numpadEnableRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );

    const numpadOverlayRow = new Adw.SwitchRow({
      title: _("Show Visual Overlay HUD"),
      subtitle: _("Display visual overlay showing 10 numpad bindings and active layer"),
    });
    numpadGroup.add(numpadOverlayRow);
    settings.bind(
      "numpad-overlay-visible",
      numpadOverlayRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
  }
}
