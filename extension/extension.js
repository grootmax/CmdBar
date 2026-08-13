import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const CmdBarDialog = GObject.registerClass(
class CmdBarDialog extends ModalDialog.ModalDialog {
    _init(shortcut, onExecute) {
        super._init();
        this._shortcut = shortcut;
        this._onExecute = onExecute;
        this._entries = {};
        this._errorLabels = {};

        // Main vertical box
        let mainBox = new St.BoxLayout({
            vertical: true,
            style_class: 'cmdbar-dialog'
        });

        // Title
        let title = new St.Label({
            text: `Run: ${shortcut.name}`,
            style_class: 'cmdbar-title'
        });
        mainBox.add_child(title);

        // Parameters
        let params = shortcut.parameters || [];
        for (let param of params) {
            let label = new St.Label({
                text: `${param.name}:`,
                style_class: 'cmdbar-label'
            });
            mainBox.add_child(label);

            let entry = new St.Entry({
                style_class: 'cmdbar-entry',
                can_focus: true
            });
            mainBox.add_child(entry);
            this._entries[param.name] = entry;

            let errLabel = new St.Label({
                style_class: 'cmdbar-error-message',
                text: ''
            });
            mainBox.add_child(errLabel);
            this._errorLabels[param.name] = errLabel;

            // Real-time validation on change
            entry.clutter_text.connect('text-changed', () => {
                this._validateAll();
            });
        }

        // Preview Area
        let previewHeader = new St.Label({
            text: 'Visual Dry-Run Preview:',
            style_class: 'cmdbar-preview-header'
        });
        mainBox.add_child(previewHeader);

        this._previewLabel = new St.Label({
            style_class: 'cmdbar-preview',
            text: ''
        });
        mainBox.add_child(this._previewLabel);

        // Buttons
        let buttonBox = new St.BoxLayout({
            style_class: 'cmdbar-button-box',
            x_align: Clutter.ActorAlign.END
        });

        let cancelBtn = new St.Button({
            label: 'Cancel',
            style_class: 'button dialog-button',
            can_focus: true
        });
        cancelBtn.connect('clicked', () => {
            this.close();
        });
        buttonBox.add_child(cancelBtn);

        this._runBtn = new St.Button({
            label: 'Execute',
            style_class: 'button dialog-button default',
            can_focus: true
        });
        this._runBtn.connect('clicked', () => {
            if (this._isValid) {
                this.close();
                let vals = {};
                for (let k in this._entries) {
                    vals[k] = this._entries[k].get_text().trim();
                }
                this._onExecute(vals);
            }
        });
        buttonBox.add_child(this._runBtn);
        mainBox.add_child(buttonBox);

        this.contentLayout.add_child(mainBox);

        // Initial validation to set states
        this._validateAll();
    }

    _validateAll() {
        let allValid = true;
        let forbidden = [';', '&&', '||', '|', '&', '`', '$', '(', ')', '>', '<'];
        let params = this._shortcut.parameters || [];
        let vals = {};

        for (let param of params) {
            let entry = this._entries[param.name];
            let errLabel = this._errorLabels[param.name];
            let val = entry.get_text().trim();
            vals[param.name] = val;

            let hasForbidden = false;
            let forbiddenChar = '';
            for (let f of forbidden) {
                if (val.includes(f)) {
                    hasForbidden = true;
                    forbiddenChar = f;
                    break;
                }
            }

            if (hasForbidden) {
                allValid = false;
                errLabel.set_text(`Forbidden character: '${forbiddenChar}'`);
                entry.add_style_class_name('cmdbar-entry-error');
            } else if (param.regex) {
                let rx = new RegExp(param.regex);
                if (!rx.test(val)) {
                    allValid = false;
                    errLabel.set_text(param.error_message || "Invalid input format!");
                    entry.add_style_class_name('cmdbar-entry-error');
                } else {
                    errLabel.set_text('');
                    entry.remove_style_class_name('cmdbar-entry-error');
                }
            } else {
                errLabel.set_text('');
                entry.remove_style_class_name('cmdbar-entry-error');
            }
        }

        this._isValid = allValid;
        this._runBtn.reactive = allValid;
        if (allValid) {
            this._runBtn.remove_style_class_name('disabled');
        } else {
            this._runBtn.add_style_class_name('disabled');
        }

        // Live preview
        let previewText = '';
        if (this._shortcut.mode === 'shell-quoted') {
            let resolved = this._shortcut.command;
            for (let param of params) {
                let val = vals[param.name] || '';
                let quotedVal = GLib.shell_quote(val);
                resolved = resolved.replaceAll(`<${param.name}>`, quotedVal);
            }
            previewText = `[shell-quoted]\n${resolved}`;
        } else {
            // direct-array
            let success, argv;
            try {
                [success, argv] = GLib.shell_parse_argv(this._shortcut.command);
            } catch (e) {
                success = false;
            }
            if (!success) {
                argv = this._shortcut.command.split(' ');
            }
            let resolvedArgv = argv.map(arg => {
                for (let param of params) {
                    arg = arg.replaceAll(`<${param.name}>`, vals[param.name] || '');
                }
                return arg;
            });
            previewText = `[direct-array]\nArgs: ${JSON.stringify(resolvedArgv)}`;
        }
        this._previewLabel.set_text(previewText);
    }
});

export default class CmdBarExtension extends Extension {
    enable() {
        this._indicator = null;
        this._monitor = null;

        // Path setup
        let configDir = GLib.get_user_config_dir() + '/cmdbar';
        this._configPath = configDir + '/config.json';
        this._configFile = Gio.File.new_for_path(this._configPath);

        // Ensure default config file exists
        this._ensureConfigFile();

        // Create status bar menu button
        this._indicator = new PanelMenu.Button(0.0, 'CmdBar', false);
        let icon = new St.Icon({
            icon_name: 'utilities-terminal-symbolic',
            style_class: 'system-status-icon'
        });
        this._indicator.add_child(icon);
        Main.panel.addToStatusArea('cmdbar', this._indicator);

        // Initialize file monitor for live reloads
        try {
            this._monitor = this._configFile.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._monitor.connect('changed', (monitor, file, other_file, event_type) => {
                if (event_type === Gio.FileMonitorEvent.CHANGES_DONE_HINT || event_type === Gio.FileMonitorEvent.CREATED) {
                    this._reloadMenu();
                }
            });
        } catch (e) {
            console.error(`CmdBar: Monitor setup failed: ${e.message}`);
        }

        // Initial menu build
        this._reloadMenu();
    }

    disable() {
        if (this._monitor) {
            this._monitor.cancel();
            this._monitor = null;
        }
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    _ensureConfigFile() {
        try {
            if (!this._configFile.query_exists(null)) {
                let parent = this._configFile.get_parent();
                if (!parent.query_exists(null)) {
                    parent.make_directory_with_parents(null);
                }
                let defaultData = JSON.stringify({
                    "categories": [
                        {
                            "name": "System Utilities",
                            "shortcuts": [
                                {
                                    "name": "Ping Host",
                                    "command": "ping -c 3 <host>",
                                    "mode": "shell-quoted",
                                    "parameters": [
                                        {
                                            "name": "host",
                                            "regex": "^[a-zA-Z0-9.-]+$",
                                            "error_message": "Invalid host format! Must contain only alphanumeric, dots, and dashes."
                                        }
                                    ]
                                },
                                {
                                    "name": "Direct Exec",
                                    "command": "/usr/bin/echo \"Hello\" <arg>",
                                    "mode": "direct-array",
                                    "parameters": [
                                        {
                                            "name": "arg",
                                            "regex": "^[a-zA-Z0-9_]+$",
                                            "error_message": "Invalid argument format! Must be alphanumeric or underscore."
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }, null, 2);

                this._configFile.replace_contents(
                    defaultData,
                    null,
                    false,
                    Gio.FileCreateFlags.NONE,
                    null
                );
            }
        } catch (e) {
            console.error(`CmdBar: Failed to ensure config file: ${e.message}`);
        }
    }

    _reloadMenu() {
        if (!this._indicator) return;

        // Clean existing menu
        this._indicator.menu.removeAll();

        let configData;
        try {
            let [success, contents] = this._configFile.load_contents(null);
            if (success) {
                // Decode Uint8Array contents to string
                let decoder = new TextDecoder();
                configData = JSON.parse(decoder.decode(contents));
            }
        } catch (e) {
            console.error(`CmdBar: Error loading config, using empty: ${e.message}`);
        }

        if (!configData || !configData.categories) {
            let item = new PopupMenu.PopupMenuItem("No configurations loaded");
            this._indicator.menu.addMenuItem(item);
            return;
        }

        // Add menu header / title
        let titleItem = new PopupMenu.PopupMenuItem("CmdBar Shortcuts");
        titleItem.sensitive = false;
        this._indicator.menu.addMenuItem(titleItem);
        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Grouping by categories
        for (let category of configData.categories) {
            let categorySub = new PopupMenu.PopupSubMenuMenuItem(category.name);
            this._indicator.menu.addMenuItem(categorySub);

            let shortcuts = category.shortcuts || [];
            if (shortcuts.length === 0) {
                let emptyItem = new PopupMenu.PopupMenuItem("(Empty)");
                emptyItem.sensitive = false;
                categorySub.menu.addMenuItem(emptyItem);
            } else {
                for (let shortcut of shortcuts) {
                    let item = new PopupMenu.PopupMenuItem(shortcut.name);
                    item.connect('activate', () => {
                        this._handleShortcutActivation(shortcut);
                    });
                    categorySub.menu.addMenuItem(item);
                }
            }
        }
    }

    _handleShortcutActivation(shortcut) {
        if (!shortcut.parameters || shortcut.parameters.length === 0) {
            this._executeCommand(shortcut, {});
        } else {
            let dialog = new CmdBarDialog(shortcut, (vals) => {
                this._executeCommand(shortcut, vals);
            });
            dialog.open();
        }
    }

    _executeCommand(shortcut, vals) {
        let params = shortcut.parameters || [];
        if (shortcut.mode === 'shell-quoted') {
            let resolved = shortcut.command;
            for (let param of params) {
                let val = vals[param.name] || '';
                let quotedVal = GLib.shell_quote(val);
                resolved = resolved.replaceAll(`<${param.name}>`, quotedVal);
            }
            try {
                Gio.Subprocess.new(
                    ['/bin/sh', '-c', resolved],
                    Gio.SubprocessFlags.NONE
                );
            } catch (err) {
                console.error(`CmdBar: Failed to execute shell-quoted command: ${err.message}`);
            }
        } else {
            // direct-array
            let success, argv;
            try {
                [success, argv] = GLib.shell_parse_argv(shortcut.command);
            } catch (e) {
                success = false;
            }
            if (!success) {
                argv = shortcut.command.split(' ');
            }
            let resolvedArgv = argv.map(arg => {
                for (let param of params) {
                    arg = arg.replaceAll(`<${param.name}>`, vals[param.name] || '');
                }
                return arg;
            });
            try {
                Gio.Subprocess.new(
                    resolvedArgv,
                    Gio.SubprocessFlags.NONE
                );
            } catch (err) {
                console.error(`CmdBar: Failed to execute direct-array command: ${err.message}`);
            }
        }
    }
}
