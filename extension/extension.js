import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

const CommandParamDialog = GObject.registerClass(
class CommandParamDialog extends ModalDialog.ModalDialog {
    _init(commandName, placeholderName, callback) {
        super._init();
        this._callback = callback;

        let contentLayout = this.contentLayout;
        contentLayout.add_style_class_name('cmdbar-dialog-content');

        let label = new St.Label({
            text: `Enter parameter for ${commandName} (${placeholderName}):`,
            style_class: 'cmdbar-dialog-label'
        });
        contentLayout.add_child(label);

        this._entry = new St.Entry({
            style_class: 'cmdbar-dialog-entry',
            can_focus: true
        });
        contentLayout.add_child(this._entry);

        // Autofocus the text entry field immediately
        this.setInitialKeyFocus(this._entry);
        this.initialKeyFocus = this._entry;

        this.addButton({
            label: 'Cancel',
            key: Clutter.KEY_Escape,
            action: () => {
                this.close();
            }
        });

        this.addButton({
            label: 'Run',
            key: Clutter.KEY_Return,
            action: () => {
                let value = this._entry.get_text().trim();
                this.close();
                this._callback(value);
            }
        });

        this._entry.connect('activate', () => {
            let value = this._entry.get_text().trim();
            this.close();
            this._callback(value);
        });

        this.connect('button-press-event', (actor, event) => {
            try {
                let coords = event.get_coords();
                let x, y;
                if (coords.length === 3) {
                    [, x, y] = coords;
                } else {
                    [x, y] = coords;
                }

                let pos = this.dialogLayout.get_transformed_position();
                let size = this.dialogLayout.get_transformed_size();
                let dialogX, dialogY, dialogW, dialogH;
                
                if (pos.length === 3) {
                    [, dialogX, dialogY] = pos;
                } else {
                    [dialogX, dialogY] = pos;
                }
                
                if (size.length === 3) {
                    [, dialogW, dialogH] = size;
                } else {
                    [dialogW, dialogH] = size;
                }

                if (x < dialogX || x > dialogX + dialogW || y < dialogY || y > dialogY + dialogH) {
                    this.close();
                    return Clutter.EVENT_STOP;
                }
            } catch (e) {
                console.error(`CmdBar: Click detection failed: ${e.message}`);
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }
});

function loadConfig(path) {
    try {
        let file = Gio.File.new_for_path(path);
        if (!file.query_exists(null)) {
            return null;
        }
        let [success, contents] = file.load_contents(null);
        if (success) {
            let decoder = new TextDecoder('utf-8');
            let jsonStr = decoder.decode(contents);
            return JSON.parse(jsonStr);
        }
    } catch (e) {
        console.error(`CmdBar: Failed to load config from ${path}: ${e.message}`);
    }
    return null;
}

function executeCommand(commandString) {
    try {
        let proc = Gio.Subprocess.new(
            ['sh', '-c', commandString],
            Gio.SubprocessFlags.NONE
        );
        proc.init(null);
        proc.wait_async(null, (obj, res) => {
            try {
                obj.wait_finish(res);
            } catch (e) {
                console.error(`CmdBar: execution failed: ${e.message}`);
            }
        });
    } catch (e) {
        console.error(`CmdBar: spawn failed: ${e.message}`);
    }
}

function runCommandWithPlaceholders(command, extension) {
    let commandString = command.command;
    let placeholderRegex = /<([^>]+)>/g;
    let matches = [...commandString.matchAll(placeholderRegex)];
    let uniquePlaceholders = [];
    for (let m of matches) {
        if (!uniquePlaceholders.includes(m[0])) {
            uniquePlaceholders.push(m[0]);
        }
    }

    if (uniquePlaceholders.length === 0) {
        executeCommand(commandString);
        return;
    }

    let step = (idx, currentCmd) => {
        if (idx >= uniquePlaceholders.length) {
            executeCommand(currentCmd);
            return;
        }

        let placeholder = uniquePlaceholders[idx];
        let placeholderName = placeholder.slice(1, -1);
        
        let dialog = new CommandParamDialog(command.name, placeholderName, (value) => {
            let updatedCmd = currentCmd.replaceAll(placeholder, value);
            step(idx + 1, updatedCmd);
        });
        dialog.open();
    };

    step(0, commandString);
}

const CmdBarIndicator = GObject.registerClass(
class CmdBarIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'CmdBar');
        this._extension = extension;
        this._monitor = null;
        this._monitoredPath = null;

        let icon = new St.Icon({
            gicon: new Gio.ThemedIcon({ name: 'utilities-terminal-symbolic' }),
            style_class: 'system-status-icon'
        });
        this.add_child(icon);

        this._rebuildMenu();
    }

    _getConfigPath() {
        let userConfigDir = GLib.get_user_config_dir();
        let userConfigPath = GLib.build_filenamev([userConfigDir, 'cmdbar', 'config.json']);
        let userFile = Gio.File.new_for_path(userConfigPath);
        if (userFile.query_exists(null)) {
            return userConfigPath;
        }
        return GLib.build_filenamev([this._extension.path, 'config.json']);
    }

    _setupMonitor(configPath) {
        if (this._monitor) {
            this._monitor.cancel();
            this._monitor = null;
        }

        this._monitoredPath = configPath;
        let file = Gio.File.new_for_path(configPath);
        try {
            this._monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._monitor.connect('changed', (monitor, file, otherFile, eventType) => {
                if (eventType === Gio.FileMonitorEvent.CHANGES_DONE_HINT) {
                    this._rebuildMenu();
                }
            });
        } catch (e) {
            console.error(`CmdBar: Failed to monitor config file at ${configPath}: ${e.message}`);
        }
    }

    _rebuildMenu() {
        this.menu.removeAll();

        let configPath = this._getConfigPath();
        if (configPath !== this._monitoredPath) {
            this._setupMonitor(configPath);
        }

        let config = loadConfig(configPath);
        if (!config || !config.categories || config.categories.length === 0) {
            let item = new PopupMenu.PopupMenuItem(config ? 'No categories found' : 'Error loading config', {
                reactive: false,
                activate: false
            });
            this.menu.addMenuItem(item);
            return;
        }

        for (let category of config.categories) {
            let categoryName = category.name || 'Commands';
            let categoryMenu = new PopupMenu.PopupSubMenuMenuItem(categoryName);
            
            if (category.commands && category.commands.length > 0) {
                for (let command of category.commands) {
                    if (!command.name || !command.command) {
                        continue;
                    }
                    let item = new PopupMenu.PopupMenuItem(command.name);
                    item.connect('activate', () => {
                        this._onCommandSelected(command);
                    });
                    categoryMenu.menu.addMenuItem(item);
                }
            } else {
                let emptyItem = new PopupMenu.PopupMenuItem('No commands', {
                    reactive: false,
                    activate: false
                });
                categoryMenu.menu.addMenuItem(emptyItem);
            }

            this.menu.addMenuItem(categoryMenu);
        }
    }

    _onCommandSelected(command) {
        runCommandWithPlaceholders(command, this._extension);
    }

    destroy() {
        if (this._monitor) {
            this._monitor.cancel();
            this._monitor = null;
        }
        super.destroy();
    }
}
);

export default class CmdBarExtension extends Extension {
    enable() {
        this._indicator = new CmdBarIndicator(this);
        Main.panel.addToStatusArea('cmdbar-indicator', this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
