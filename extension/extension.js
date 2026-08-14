import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { St, Clutter, Gio, GLib, GObject } from 'gi';

import { validateInput, substituteCommand, hasPlaceholder } from './commandProcessor.js';

/**
 * Run a command asynchronously and notify the user when done.
 * @param {string} commandName
 * @param {string} commandString
 */
function runCommandAsync(commandName, commandString) {
    try {
        let proc = Gio.Subprocess.new(
            ['/bin/sh', '-c', commandString],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );

        proc.communicate_utf8_async(null, null, (subprocess, result) => {
            try {
                let [stdout, stderr] = subprocess.communicate_utf8_finish(result);
                
                let success = subprocess.get_successful();
                let exitStatus = 'unknown';
                if (subprocess.get_if_exited()) {
                    exitStatus = String(subprocess.get_exit_status());
                } else if (subprocess.get_if_signaled()) {
                    exitStatus = `Killed by signal ${subprocess.get_term_sig()}`;
                }

                if (success) {
                    let title = `Command Succeeded: ${commandName}`;
                    let body = `Exit status: ${exitStatus}`;
                    if (stdout && stdout.trim()) {
                        body += `\n\nOutput:\n${stdout.trim()}`;
                    }
                    Main.notify(title, body);
                } else {
                    let title = `Command Failed: ${commandName}`;
                    let body = `Exit status: ${exitStatus}`;
                    if (stderr && stderr.trim()) {
                        body += `\n\nError:\n${stderr.trim()}`;
                    } else if (stdout && stdout.trim()) {
                        body += `\n\nOutput:\n${stdout.trim()}`;
                    }
                    Main.notify(title, body);
                }
            } catch (err) {
                console.error(`CmdBar: error finishing command: ${err.message}`);
                Main.notify(`Command Error: ${commandName}`, `Failed to execute: ${err.message}`);
            }
        });
    } catch (e) {
        console.error(`CmdBar: failed to spawn command: ${e.message}`);
        Main.notify(`Command Launch Failed: ${commandName}`, `Could not start command: ${e.message}`);
    }
}

// Custom menu item with an inline text entry for commands that have placeholders
const CommandInputMenuItem = GObject.registerClass(
class CommandInputMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(commandName, commandTemplate, placeholderText) {
        super._init({
            reactive: true,
            activate: true
        });

        this._commandName = commandName;
        this._commandTemplate = commandTemplate;
        this._placeholderText = placeholderText || "Enter parameter...";

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
            this._onSubmit(commandName);
        });
    }

    _onSubmit(commandName) {
        try {
            let proc = Gio.Subprocess.new(
                ['zenity', '--entry', '--title', commandName, '--text', `Enter value for ${this._placeholderText}:`],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );

            proc.communicate_utf8_async(null, null, (subprocess, result) => {
                try {
                    let [success, stdout, stderr] = subprocess.communicate_utf8_finish(result);
                    if (success && subprocess.get_successful()) {
                        let text = stdout ? stdout.trim() : '';
                        if (validateInput(text)) {
                            let substituted = substituteCommand(this._commandTemplate, text);
                            GLib.spawn_command_line_async(substituted);
                        }
                    }
                } catch (e) {
                    console.error(`CmdBar: zenity dialog error: ${e.message}`);
                }
            });
        } catch (e) {
            console.error(`CmdBar: failed to spawn zenity: ${e.message}`);
        }
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

// Standard menu item for parameterless commands
const CommandMenuItem = GObject.registerClass(
class CommandMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(commandName, commandTemplate) {
        super._init({
            reactive: true,
            activate: true
        });

        this._commandName = commandName;
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
            runCommandAsync(this._commandName, this._commandTemplate);
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
        this._cachedConfig = null;
        this._timeoutId = 0;

        // Display icon in the top-bar indicator
        let icon = new St.Icon({
            gicon: new Gio.ThemedIcon({ name: 'system-run-symbolic' }),
            styleClass: 'system-status-icon'
        });
        this.add_child(icon);

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
                    let parsed = JSON.parse(jsonString);
                    if (parsed && parsed.categories && Array.isArray(parsed.categories)) {
                        this._cachedConfig = parsed;
                        return parsed;
                    } else {
                        console.error(`CmdBar: invalid config structure, 'categories' must be an array`);
                    }
                }
            } catch (e) {
                console.error(`CmdBar: failed to parse config file: ${e.message}`);
            }
        }

        // Retain the last successfully loaded configuration in memory to use as a fallback when new edits are unparseable
        if (this._cachedConfig) {
            console.warn(`CmdBar: loading fallback configuration due to parsing/structure error.`);
            return this._cachedConfig;
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
                    let defaultConfig = JSON.parse(jsonString);
                    if (defaultConfig && defaultConfig.categories && Array.isArray(defaultConfig.categories)) {
                        this._cachedConfig = defaultConfig;
                        return defaultConfig;
                    }
                }
            }
        } catch (e) {
            console.error(`CmdBar: fallback parsing failed: ${e.message}`);
        }

        return { categories: [] };
    }

    _reloadMenu() {
        try {
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
        } catch (e) {
            console.error(`CmdBar: error reloading menu: ${e.message}`);
        }
    }

    _setupFileMonitor() {
        let path = this._getConfigPath();
        let file = Gio.File.new_for_path(path);

        try {
            this._monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._timeoutId = 0;
            this._monitorId = this._monitor.connect('changed', (monitor, file, otherFile, eventType) => {
                // Trigger dynamic live reload on modifications or updates
                if (eventType === Gio.FileMonitorEvent.CHANGES_DONE_HINT || 
                    eventType === Gio.FileMonitorEvent.CREATED ||
                    eventType === Gio.FileMonitorEvent.CHANGED ||
                    eventType === Gio.FileMonitorEvent.ATTRIBUTE_CHANGED) {
                    
                    if (this._timeoutId) {
                        GLib.Source.remove(this._timeoutId);
                        this._timeoutId = 0;
                    }
                    this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                        this._timeoutId = 0;
                        this._reloadMenu();
                        return GLib.SOURCE_REMOVE !== undefined ? GLib.SOURCE_REMOVE : false;
                    });
                }
            });
        } catch (e) {
            console.error(`CmdBar: failed to initialize file monitor: ${e.message}`);
        }
    }

    destroy() {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }
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
