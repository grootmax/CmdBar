import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { St, Clutter, Gio, GLib, GObject } from 'gi';

import { validateInput, substituteCommand, hasPlaceholder, parseEnv } from './commandProcessor.js';

let cachedEnv = null;
let isHarvesting = false;

function harvestEnvironment() {
    if (isHarvesting) {
        return;
    }
    isHarvesting = true;
    try {
        const shell = GLib.getenv('SHELL') || '/bin/sh';
        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        });
        const proc = launcher.spawnv([shell, '-l', '-c', 'env']);
        proc.communicate_utf8_async(null, null, (obj, res) => {
            try {
                const [stdout, stderr] = obj.communicate_utf8_finish(res);
                if (stdout) {
                    cachedEnv = parseEnv(stdout);
                }
            } catch (err) {
                console.error(`CmdBar: failed to harvest environment: ${err.message}`);
            } finally {
                isHarvesting = false;
            }
        });
    } catch (e) {
        console.error(`CmdBar: failed to spawn environment harvest: ${e.message}`);
        isHarvesting = false;
    }
}

function runCommand(commandString) {
    try {
        const shell = GLib.getenv('SHELL') || '/bin/sh';
        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.NONE
        });
        if (cachedEnv) {
            launcher.set_environ(cachedEnv);
        }
        launcher.spawnv([shell, '-c', commandString]);
    } catch (e) {
        console.error(`CmdBar: failed to run command: ${e.message}`);
    }
}


// Custom menu item with an inline text entry for commands that have placeholders
const CommandInputMenuItem = GObject.registerClass(
class CommandInputMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(commandName, commandTemplate, placeholderText) {
        super._init({
            reactive: true,
            activate: false // prevent automatic closing on item click
        });

        this._commandTemplate = commandTemplate;
        this._placeholderText = placeholderText || "Enter parameter...";

        this.box = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            y_expand: true
        });

        this.label = new St.Label({
            text: commandName,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true
        });
        this.box.add_child(this.label);

        this.entry = new St.Entry({
            hint_text: this._placeholderText,
            track_hover: true,
            can_focus: true,
            style: 'width: 150px; margin-left: 10px; padding: 2px 6px;'
        });

        // Prevent mouse clicks inside the text entry from triggering general menu click/close handlers
        this.entry.connect('button-press-event', (actor, event) => {
            this.entry.grab_key_focus();
            return Clutter.EVENT_STOP;
        });

        this.connect('key-focus-in', () => {
            this.entry.grab_key_focus();
        });

        // Trigger action on Enter keypress (clutter_text 'activate' signal)
        let clutterText = this.entry.clutter_text;
        this._activateId = clutterText.connect('activate', () => {
            this._onSubmit();
        });

        this.box.add_child(this.entry);
        this.add_child(this.box);
    }

    _onSubmit() {
        let text = this.entry.get_text();
        
        // Inline validation: check if text is empty or only whitespace
        if (!validateInput(text)) {
            // Keep the menu open and block command execution
            return;
        }

        // Perform template substitution
        let substituted = substituteCommand(this._commandTemplate, text.trim());

        // Spawn command line asynchronously via standard shell with environment variables injected
        runCommand(substituted);

        // Close the system menu
        let parent = this;
        while (parent && typeof parent.close !== 'function') {
            parent = parent.parent;
        }
        if (parent && typeof parent.close === 'function') {
            parent.close(true); // close with animation
        }
    }

    destroy() {
        if (this._activateId) {
            this.entry.clutter_text.disconnect(this._activateId);
            this._activateId = 0;
        }
        super.destroy();
    }
}
);

// Standard menu item for parameterless commands
const CommandMenuItem = GObject.registerClass(
class CommandMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(commandName, commandTemplate) {
        super._init({
            reactive: true,
            activate: true
        });

        this._commandTemplate = commandTemplate;

        this.box = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true
        });

        this.label = new St.Label({
            text: commandName,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true
        });
        this.box.add_child(this.label);

        this.add_child(this.box);

        this._activateId = this.connect('activate', () => {
            runCommand(this._commandTemplate);
        });
    }

    destroy() {
        if (this._activateId) {
            this.disconnect(this._activateId);
            this._activateId = 0;
        }
        super.destroy();
    }
}
);

// Menu item for group/category headers
const CategoryHeaderMenuItem = GObject.registerClass(
class CategoryHeaderMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(categoryName) {
        super._init({
            reactive: false,
            activate: false
        });

        this.box = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            styleClass: 'cmdbar-category-header',
            x_expand: true
        });

        this.label = new St.Label({
            text: categoryName,
            style: 'font-weight: bold; color: #888888; font-size: 0.95em; margin-top: 6px; margin-bottom: 2px;'
        });
        this.box.add_child(this.label);

        this.add_child(this.box);
    }
}
);

// The top bar status area panel indicator
const CmdBarIndicator = GObject.registerClass(
class CmdBarIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'CmdBar');

        this._extension = extension;
        this._monitor = null;

        // Display icon in the top-bar indicator
        let icon = new St.Icon({
            gicon: new Gio.ThemedIcon({ name: 'system-run-symbolic' }),
            styleClass: 'system-status-icon'
        });
        this.add_child(icon);

        // Harvest environment asynchronously on startup
        harvestEnvironment();

        // Load configuration and construct the dynamic menu
        this._reloadMenu();

        // Setup File Monitor for Live Reloading of JSON configuration
        this._setupFileMonitor();
    }

    _getConfigPath() {
        return GLib.build_filenamev([GLib.get_user_config_dir(), 'cmdbar', 'commands.json']);
    }

    _loadConfig() {
        let path = this._getConfigPath();
        let file = Gio.File.new_for_path(path);

        if (!file.query_exists(null)) {
            try {
                // Ensure parent directory structure exists
                let parentDir = Gio.File.new_for_path(GLib.path_get_dirname(path));
                if (!parentDir.query_exists(null)) {
                    parentDir.make_directory_with_parents(null);
                }

                // Copy default template commands.json from extension pack to config path
                let defaultFile = Gio.File.new_for_path(
                    GLib.build_filenamev([this._extension.path.get_path(), 'commands.json'])
                );

                if (defaultFile.query_exists(null)) {
                    defaultFile.copy(file, Gio.FileCopyFlags.NONE, null, null);
                }
            } catch (e) {
                console.error(`CmdBar: error creating initial commands.json config: ${e.message}`);
            }
        }

        // Try reading configuration
        if (file.query_exists(null)) {
            try {
                let [success, contents] = file.load_contents(null);
                if (success) {
                    let decoder = new TextDecoder('utf-8');
                    let jsonString = decoder.decode(contents);
                    return JSON.parse(jsonString);
                }
            } catch (e) {
                console.error(`CmdBar: failed to parse config file: ${e.message}`);
            }
        }

        // Robust Fallback: load default commands directly from extension package
        try {
            let defaultFile = Gio.File.new_for_path(
                GLib.build_filenamev([this._extension.path.get_path(), 'commands.json'])
            );
            if (defaultFile.query_exists(null)) {
                let [success, contents] = defaultFile.load_contents(null);
                if (success) {
                    let decoder = new TextDecoder('utf-8');
                    let jsonString = decoder.decode(contents);
                    return JSON.parse(jsonString);
                }
            }
        } catch (e) {
            console.error(`CmdBar: fallback parsing failed: ${e.message}`);
        }

        return { categories: [] };
    }

    _reloadMenu() {
        // Clear all current items in menu
        this.menu.removeAll();

        let config = this._loadConfig();

        if (!config || !config.categories || config.categories.length === 0) {
            let infoItem = new PopupMenu.PopupMenuItem("No commands configured");
            this.menu.addMenuItem(infoItem);
            return;
        }

        config.categories.forEach((category, catIndex) => {
            // Category header
            if (catIndex > 0) {
                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            }
            this.menu.addMenuItem(new CategoryHeaderMenuItem(category.name));

            // Category commands
            if (category.commands && Array.isArray(category.commands)) {
                category.commands.forEach(cmd => {
                    if (hasPlaceholder(cmd.command)) {
                        // Commands requiring text inputs (Requirement 1 & 2)
                        this.menu.addMenuItem(new CommandInputMenuItem(cmd.name, cmd.command, cmd.placeholder));
                    } else {
                        // Ordinary parameterless commands
                        this.menu.addMenuItem(new CommandMenuItem(cmd.name, cmd.command));
                    }
                });
            }
        });
    }

    _setupFileMonitor() {
        let path = this._getConfigPath();
        let file = Gio.File.new_for_path(path);

        try {
            this._monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._monitorId = this._monitor.connect('changed', (monitor, file, otherFile, eventType) => {
                // Trigger dynamic live reload on modifications or updates
                if (eventType === Gio.FileMonitorEvent.CHANGES_DONE_HINT || 
                    eventType === Gio.FileMonitorEvent.CREATED) {
                    harvestEnvironment();
                    this._reloadMenu();
                }
            });
        } catch (e) {
            console.error(`CmdBar: failed to initialize file monitor: ${e.message}`);
        }
    }

    destroy() {
        if (this._monitor) {
            if (this._monitorId) {
                this._monitor.disconnect(this._monitorId);
                this._monitorId = 0;
            }
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
        // Add to the system status bar panel
        Main.panel.addToStatusArea('cmdbar-indicator', this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
