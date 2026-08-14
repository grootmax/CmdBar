import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class CmdBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: _('General'),
            iconName: 'preferences-system-symbolic',
        });
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: _('Indicator Settings'),
        });
        page.add(group);

        const showRow = new Adw.SwitchRow({
            title: _('Show Indicator'),
            subtitle: _('Toggle CmdBar in the top panel'),
        });
        group.add(showRow);
        settings.bind('show-indicator', showRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        const placeholderRow = new Adw.EntryRow({
            title: _('Default Placeholder Text'),
            show_apply_button: false,
        });
        group.add(placeholderRow);
        settings.bind('placeholder-text', placeholderRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        const labelRow = new Adw.EntryRow({
            title: _('Button Label'),
            show_apply_button: false,
        });
        group.add(labelRow);
        settings.bind('button-label', labelRow, 'text', Gio.SettingsBindFlags.DEFAULT);
    }
}
