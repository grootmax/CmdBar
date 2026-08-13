import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

// Interactive parameter dialog for commands with placeholders
class ParameterDialog extends ModalDialog.ModalDialog {
    constructor(command, placeholders, callback) {
        super();

        this._command = command;
        this._placeholders = placeholders;
        this._callback = callback;

        // Content layout
        let contentLayout = this.contentLayout;
        contentLayout.add_style_class_name('cmdbar-dialog-content');
        contentLayout.set_style('spacing: 15px; padding: 20px; width: 400px;');

        // Title
        let titleLabel = new St.Label({
            text: `Execute: ${command.name}`,
            style_class: 'cmdbar-dialog-title',
            style: 'font-weight: bold; font-size: 1.2em; margin-bottom: 10px;'
        });
        contentLayout.add_child(titleLabel);

        this._entries = {};
        this._warningLabels = {};

        // For each placeholder, create entry and label
        for (let ph of placeholders) {
            let phLayout = new St.BoxLayout({
                vertical: true,
                style: 'spacing: 5px; margin-bottom: 10px;'
            });

            let labelText = ph;
            let paramConfig = command.parameters && command.parameters[ph];
            if (paramConfig && paramConfig.placeholder) {
                labelText = `${ph} (${paramConfig.placeholder})`;
            }
            let phLabel = new St.Label({
                text: labelText,
                style_class: 'cmdbar-dialog-label',
                style: 'font-weight: bold;'
            });
            phLayout.add_child(phLabel);

            let entry = new St.Entry({
                can_focus: true,
                style_class: 'cmdbar-dialog-entry',
                style: 'padding: 8px; border: 1px solid #ccc; border-radius: 4px; background-color: #333; color: #fff;'
            });
            phLayout.add_child(entry);
            this._entries[ph] = entry;

            let warningLabel = new St.Label({
                text: '',
                style_class: 'cmdbar-dialog-warning',
                style: 'color: #ff6666; font-size: 0.9em; min-height: 1.2em;'
            });
            phLayout.add_child(warningLabel);
            this._warningLabels[ph] = warningLabel;

            // Real-time validation
            entry.clutter_text.connect('text-changed', () => {
                this._validateInputs();
            });

            contentLayout.add_child(phLayout);
        }

        // Run button (default action)
        this._runButton = this.addButton({
            label: 'Run',
            action: () => {
                if (this._validateInputs()) {
                    let values = {};
                    for (let ph of this._placeholders) {
                        values[ph] = this._entries[ph].get_text();
                    }
                    this.close();
                    this._callback(values);
                }
            },
            key: Clutter.KEY_Return,
        });

        // Cancel button
        this.addButton({
            label: 'Cancel',
            action: () => {
                this.close();
            },
            key: Clutter.KEY_Escape,
        });

        // Grab focus on the first entry
        if (placeholders.length > 0) {
            let firstPh = placeholders[0];
            this._entries[firstPh].grab_key_focus();
        }

        // Perform initial validation
        this._validateInputs();
    }

    _validateInputs() {
        let allValid = true;

        for (let ph of this._placeholders) {
            let entry = this._entries[ph];
            let warningLabel = this._warningLabels[ph];
            let val = entry.get_text();

            let paramConfig = this._command.parameters && this._command.parameters[ph];
            let pattern = (paramConfig && paramConfig.regex) ? paramConfig.regex : "^[a-zA-Z0-9_\\-]+$";

            try {
                let regex = new RegExp(pattern);
                if (!regex.test(val)) {
                    allValid = false;
                    entry.add_style_class_name('invalid');
                    // Fallback styling in case stylesheet isn't fully active
                    entry.set_style('padding: 8px; border: 1.5px solid #ff6666; border-radius: 4px; background-color: #422; color: #fff;');
                    warningLabel.set_text(`Input must match: ${pattern}`);
                } else {
                    entry.remove_style_class_name('invalid');
                    entry.set_style('padding: 8px; border: 1px solid #666; border-radius: 4px; background-color: #333; color: #fff;');
                    warningLabel.set_text('');
                }
            } catch (err) {
                allValid = false;
                entry.add_style_class_name('invalid');
                entry.set_style('padding: 8px; border: 1.5px solid #ff6666; border-radius: 4px; background-color: #422; color: #fff;');
                warningLabel.set_text('Invalid validation regex configured');
            }
        }

        // Control run button state based on validation status
        this._runButton.reactive = allValid;
        this._runButton.opacity = allValid ? 255 : 128;

        return allValid;
    }
}

// Indicator widget on top bar panel
class CmdBarIndicator extends PanelMenu.Button {
    constructor(extensionPath, metadata) {
        super(0.0, 'CmdBar Indicator');

        this._extensionPath = extensionPath;
        
        // Setup Icon
        let icon = new St.Icon({
            icon_name: 'utilities-terminal-symbolic',
            style_class: 'system-status-icon'
        });
        this.add_child(icon);

        // Get config path (supports CMDBAR_CONFIG_PATH override for testing)
        let envPath = GLib.getenv('CMDBAR_CONFIG_PATH');
        if (envPath) {
            this._configPath = envPath;
        } else {
            this._configPath = GLib.build_filenamev([
                GLib.get_user_config_dir(),
                'cmdbar',
                'config.json'
            ]);
        }

        this._timeoutId = 0;

        // Initialize file monitor & populate menu
        this._initMonitor();
        this._reloadMenu();
    }

    _initMonitor() {
        let file = Gio.File.new_for_path(this._configPath);
        
        // Ensure parent directory exists
        let parentDir = file.get_parent();
        if (!parentDir.query_exists(null)) {
            try {
                parentDir.make_directory_with_parents(null);
            } catch (e) {
                // Ignore if unable to create parent directory in testing
            }
        }

        // Seed with a default configuration if not present
        if (!file.query_exists(null)) {
            try {
                let defaultConfig = {
                    "categories": [
                        {
                            "name": "Projects",
                            "commands": [
                                {
                                    "name": "Git Checkout",
                                    "template": "git checkout {branch}",
                                    "parameters": {
                                        "branch": {
                                            "regex": "^[a-zA-Z0-9_\\-/\\.]+$",
                                            "placeholder": "Enter branch name"
                                        }
                                    }
                                },
                                {
                                    "name": "Docker Logs",
                                    "template": "docker logs {container_id}",
                                    "parameters": {
                                        "container_id": {
                                            "placeholder": "Enter container ID"
                                        }
                                    }
                                }
                            ]
                        }
                    ]
                };
                let encoder = new TextEncoder();
                let bytes = encoder.encode(JSON.stringify(defaultConfig, null, 4));
                file.replace_contents(bytes, null, false, Gio.FileCreateFlags.NONE, null);
            } catch (e) {
                // Ignore if read-only filesystem or in tests
            }
        }

        try {
            this._monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._monitorId = this._monitor.connect('changed', (monitor, file, other_file, event_type) => {
                if (event_type === Gio.FileMonitorEvent.CHANGES_DONE_HINT || 
                    event_type === Gio.FileMonitorEvent.CREATED) {
                    // Debounce reload
                    if (this._timeoutId) {
                        GLib.source_remove(this._timeoutId);
                    }
                    this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                        this._reloadMenu();
                        this._timeoutId = 0;
                        return GLib.SOURCE_REMOVE;
                    });
                }
            });
        } catch (e) {
            // Monitor might fail in environments without Gio file monitors (like headless container environments)
        }
    }

    _reloadMenu() {
        // Clear all existing menu items
        this.menu.removeAll();

        let file = Gio.File.new_for_path(this._configPath);
        if (!file.query_exists(null)) {
            this._addErrorItem("Config not found");
            return;
        }

        try {
            let [success, contents] = file.load_contents(null);
            if (!success) {
                this._addErrorItem("Failed to load config file");
                return;
            }
            let decoder = new TextDecoder();
            let config = JSON.parse(decoder.decode(contents));

            if (!config || !config.categories || config.categories.length === 0) {
                this._addErrorItem("No categories configured");
                return;
            }

            for (let category of config.categories) {
                // Create a sub-menu for each category
                let categoryMenu = new PopupMenu.PopupSubMenuMenuItem(category.name);
                this.menu.addMenuItem(categoryMenu);

                for (let command of category.commands) {
                    let cmdItem = new PopupMenu.PopupMenuItem(command.name);
                    cmdItem.connect('activate', () => {
                        this._handleCommandActivation(command);
                    });
                    categoryMenu.menu.addMenuItem(cmdItem);
                }
            }
        } catch (e) {
            this._addErrorItem("Config JSON Format Error");
        }
    }

    _addErrorItem(message) {
        let item = new PopupMenu.PopupMenuItem(`Error: ${message}`);
        item.sensitive = false;
        this.menu.addMenuItem(item);
    }

    _handleCommandActivation(command) {
        let template = command.template;
        let placeholders = [];
        let regex = /\{([^}]+)\}/g;
        let match;
        while ((match = regex.exec(template)) !== null) {
            placeholders.push(match[1]);
        }

        if (placeholders.length === 0) {
            // No placeholders, run command directly
            this._executeCommand(template);
        } else {
            // Parameterized template, display inputs dialog
            let dialog = new ParameterDialog(command, placeholders, (values) => {
                let finalCmd = template;
                for (let ph of placeholders) {
                    let escapedVal = GLib.shell_quote(values[ph]);
                    finalCmd = finalCmd.replace(new RegExp(`\\{${ph}\\}`, 'g'), escapedVal);
                }
                this._executeCommand(finalCmd);
            });
            dialog.open();
        }
    }

    _executeCommand(cmdStr) {
        try {
            // Securely execute using shell wrapper
            let [success, argv] = GLib.shell_parse_argv(`/bin/sh -c ${GLib.shell_quote(cmdStr)}`);
            if (success) {
                let subprocess = new Gio.Subprocess({
                    argv: argv,
                    flags: Gio.SubprocessFlags.NONE,
                });
                subprocess.init(null);
                subprocess.run_async(null, null);
            }
        } catch (e) {
            // Fail silently or log error
        }
    }

    destroy() {
        if (this._monitor) {
            if (this._monitorId) {
                this._monitor.disconnect(this._monitorId);
            }
            this._monitor.cancel();
            this._monitor = null;
        }
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
        }
        super.destroy();
    }
}

// Extension entry point
export default class CmdBarExtension extends Extension {
    enable() {
        this._indicator = new CmdBarIndicator(this.path, this.metadata);
        Main.panel.addToStatusArea('cmdbar-indicator', this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
