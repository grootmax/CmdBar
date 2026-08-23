import Adw from "gi://Adw";
import Gio from "gi://Gio";
import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

export default class CmdBarPreferences extends ExtensionPreferences {
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

    // AI Translation Settings Group
    const aiGroup = new Adw.PreferencesGroup({
      title: _("AI Natural Language Command Translator"),
    });
    page.add(aiGroup);

    const providerRow = new Adw.EntryRow({
      title: _("Provider (openai, anthropic, ollama)"),
      show_apply_button: false,
    });
    aiGroup.add(providerRow);
    settings.bind(
      "ai-provider",
      providerRow,
      "text",
      Gio.SettingsBindFlags.DEFAULT,
    );

    const modelRow = new Adw.EntryRow({
      title: _("Model Name (e.g. gpt-4o, claude-3-5-sonnet, llama3)"),
      show_apply_button: false,
    });
    aiGroup.add(modelRow);
    settings.bind(
      "ai-model",
      modelRow,
      "text",
      Gio.SettingsBindFlags.DEFAULT,
    );

    const apiKeyRow = new Adw.PasswordEntryRow({
      title: _("API Key (Securely stored)"),
    });
    aiGroup.add(apiKeyRow);
    settings.bind(
      "ai-api-key",
      apiKeyRow,
      "text",
      Gio.SettingsBindFlags.DEFAULT,
    );

    const confirmRow = new Adw.SwitchRow({
      title: _("Require Confirmation Before Execution"),
      subtitle: _("Prompt to review AI generated command before running"),
    });
    aiGroup.add(confirmRow);
    settings.bind(
      "ai-require-confirmation",
      confirmRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
  }
}
