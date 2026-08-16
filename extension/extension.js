import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import { St, Clutter, Gio, GLib, GObject } from 'gi';

import { validateInput, substituteCommand, hasPlaceholder, tokenizeCommand, substituteTokens } from './commandProcessor.js';
import { loadConfig } from './configSync.js';

function redactSensitiveValues(text, sensitiveValues) {
    if (!text || typeof text !== 'string') return text;
    if (!sensitiveValues || sensitiveValues.length === 0) return text;
    let redacted = text;
    for (let value of sensitiveValues) {
        if (value && value.trim().length > 0) {
            let escaped = value.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            let re = new RegExp(escaped, 'g');
            redacted = redacted.replace(re, '[REDACTED]');
        }
    }
    return redacted;
}

/**
 * Run a command asynchronously and notify the user when done.
 * @param {string} commandName
 * @param {string} commandString
 */
function runCommandAsync(commandName, commandString, sensitiveValues = []) {
    let redactedCommandString = redactSensitiveValues(commandString, sensitiveValues);
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

                let redactedStdout = redactSensitiveValues(stdout, sensitiveValues);
                let redactedStderr = redactSensitiveValues(stderr, sensitiveValues);

                if (success) {
                    let title = `Command Succeeded: ${commandName}`;
                    let body = `Exit status: ${exitStatus}`;
                    if (redactedStdout && redactedStdout.trim()) {
                        body += `\n\nOutput:\n${redactedStdout.trim()}`;
                    }
                    Main.notify(title, body);
                } else {
                    let title = `Command Failed: ${commandName}`;
                    let body = `Exit status: ${exitStatus}`;
                    if (redactedStderr && redactedStderr.trim()) {
                        body += `\n\nError:\n${redactedStderr.trim()}`;
                    } else if (redactedStdout && redactedStdout.trim()) {
                        body += `\n\nOutput:\n${redactedStdout.trim()}`;
                    }
                    Main.notify(title, body);
                }
            } catch (err) {
                let redactedErrorMsg = redactSensitiveValues(err.message, sensitiveValues);
                console.error(`CmdBar: error finishing command: ${redactedErrorMsg}`);
                Main.notify(`Command Error: ${commandName}`, `Failed to execute: ${redactedErrorMsg}`);
            }
        });
    } catch (e) {
        let redactedErrorMsg = redactSensitiveValues(e.message, sensitiveValues);
        console.error(`CmdBar: failed to spawn command: ${redactedErrorMsg}`);
        Main.notify(`Command Launch Failed: ${commandName}`, `Could not start command: ${redactedErrorMsg}`);
    }
}

/**
 * Harvest environment variables on startup.
 */
function harvestEnvironment() {
    // Placeholder for environment harvesting
}

/**
 * Asynchronously executes a shell command and notifies the user on failure.
 * 
 * @param {string} commandLineString The command string to execute.
 */
function _executeCommandAsync(commandLineString, sensitiveValues = []) {
    let redactedCommandLineString = redactSensitiveValues(commandLineString, sensitiveValues);
    try {
        // Parse the command line into argv
        let [ok, argv] = GLib.shell_parse_argv(commandLineString);
        if (!ok || !argv || argv.length === 0) {
            Main.notify("Command Execution Failed", `Could not parse command: "${redactedCommandLineString}"`);
            return;
        }

        // Spawn using Gio.Subprocess to capture stderr
        let proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDERR_PIPE);

        // Async read & status check
        proc.communicate_utf8_async(null, null, (subprocess, result) => {
            try {
                let [stdout, stderr] = subprocess.communicate_utf8_finish(result);

                let redactedStdout = redactSensitiveValues(stdout, sensitiveValues);
                let redactedStderr = redactSensitiveValues(stderr, sensitiveValues);

                if (!subprocess.get_successful()) {
                    let exitStatus = subprocess.get_exit_status();
                    let rawError = redactedStderr ? redactedStderr.trim() : "";
                    let detailedError = rawError || `Process exited with code ${exitStatus}`;

                    // Graceful truncation
                    const MAX_ERR_LENGTH = 200;
                    if (detailedError.length > MAX_ERR_LENGTH) {
                        detailedError = detailedError.substring(0, MAX_ERR_LENGTH) + "...";
                    }

                    Main.notify("Command Execution Failed", detailedError);
                }
            } catch (e) {
                let redactedErrorMsg = redactSensitiveValues(e.message, sensitiveValues);
                console.error(`CmdBar error reading stderr: ${redactedErrorMsg}`);
                Main.notify("Command Execution Failed", redactedErrorMsg);
            }
        });
    } catch (e) {
        let redactedErrorMsg = redactSensitiveValues(e.message, sensitiveValues);
        console.error(`CmdBar parsing/spawn error: ${redactedErrorMsg}`);
        Main.notify("Command Execution Failed", `Failed to start command: ${redactedErrorMsg}`);
    }
}

/**
 * Harvest environment asynchronously on startup using env command.
 */
function harvestEnvironment() {
    try {
        let proc = Gio.Subprocess.new(
            ['/usr/bin/env'],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );

        proc.communicate_utf8_async(null, null, (subprocess, result) => {
            try {
                let [success, stdout, stderr] = subprocess.communicate_utf8_finish(result);
                if (success && subprocess.get_successful()) {
                    let envLines = parseEnv(stdout);
                    // Environment harvested successfully
                }
            } catch (err) {
                console.error(`CmdBar: error harvesting environment: ${err.message}`);
            }
        });
    } catch (e) {
        console.error(`CmdBar: failed to spawn env: ${e.message}`);
    }
}


// Custom menu item with an inline text entry for commands that have placeholders
const CommandInputMenuItem = GObject.registerClass(
class CommandInputMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(indicator, commandName, commandTemplate, placeholderText, secure) {
        super._init({
            reactive: true,
            activate: true
        });

        this._indicator = indicator;
        this._commandName = commandName;
        this._commandTemplate = commandTemplate;
        this._placeholderText = placeholderText || "Enter parameter...";
        this._secure = secure || false;

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
            let zenityArgs = ['zenity', '--entry', '--title', commandName, '--text', `Enter value for ${this._placeholderText}:` ];
            if (this._secure) {
                zenityArgs.push('--hide-text');
            }
            let proc = Gio.Subprocess.new(
                zenityArgs,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );

            proc.communicate_utf8_async(null, null, (subprocess, result) => {
                try {
                    let [success, stdout, stderr] = subprocess.communicate_utf8_finish(result);
                    if (success && subprocess.get_successful()) {
                        let text = stdout ? stdout.trim() : '';
                        if (validateInput(text)) {
                            let substituted = substituteCommand(this._commandTemplate, text);
                            let sensitiveValues = this._secure ? [text] : [];
                            runCommandAsync(this._commandName, substituted, sensitiveValues);
                        }
                    }
                } catch (e) {
                    let redactedErrorMsg = redactSensitiveValues(e.message, this._secure ? [text] : []);
                    console.error(`CmdBar: zenity dialog error: ${redactedErrorMsg}`);
                }
            });
        } catch (e) {
            let redactedErrorMsg = redactSensitiveValues(e.message, this._secure ? [text] : []);
            console.error(`CmdBar: failed to spawn zenity: ${redactedErrorMsg}`);
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

// Standard menu item for parameterless or parameter-prompting commands
const CommandMenuItem = GObject.registerClass(
class CommandMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(indicator, commandName, commandTemplate) {
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

// Active job menu item with cancel button (Requirement 3 & 4)
const JobMenuItem = GObject.registerClass(
class JobMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(jobId, jobName, onCancel) {
        super._init({
            reactive: true,
            activate: false
        });

        this.jobId = jobId;

        this.box = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            style: 'padding: 4px 6px;'
        });

        this.statusIcon = new St.Icon({
            gicon: new Gio.ThemedIcon({ name: 'process-working-symbolic' }),
            styleClass: 'system-status-icon',
            style: 'margin-right: 12px; color: #3584e4;'
        });
        this.box.add_child(this.statusIcon);

        this.label = new St.Label({
            text: jobName,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            style: 'font-size: 0.95em;'
        });
        this.box.add_child(this.label);

        this.cancelButton = new St.Button({
            child: new St.Icon({
                gicon: new Gio.ThemedIcon({ name: 'media-playback-stop-symbolic' }),
                styleClass: 'system-status-icon',
                style: 'color: #e01b24;'
            }),
            style: 'padding: 6px; border-radius: 6px;',
            track_hover: true,
            can_focus: true
        });

        this.cancelButton.connect('clicked', () => {
            if (typeof onCancel === 'function') {
                onCancel(jobId);
            }
        });

        this.box.add_child(this.cancelButton);
        this.add_child(this.box);
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

        // Container box to support text and icon side-by-side
        this._box = new St.BoxLayout({
            style_class: 'panel-status-menu-box',
            pack_start: true,
        });

        // Display icon in the top-bar indicator
        this._icon = new St.Icon({
            gicon: new Gio.ThemedIcon({ name: 'system-run-symbolic' }),
            styleClass: 'system-status-icon'
        });
        this._box.add_child(this._icon);

        // Display text label next to icon (dynamically customized)
        this._label = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'cmdbar-button-label'
        });
        this._box.add_child(this._label);

        this.add_child(this._box);

        // Harvest environment asynchronously on startup
        harvestEnvironment();

        // Load configuration and construct the dynamic menu
        this._reloadMenu();

        // Setup File Monitor for Live Reloading of JSON configuration
        this._setupFileMonitor();
    }

    setButtonLabel(labelText) {
        if (labelText && labelText.trim().length > 0) {
            this._label.text = labelText.trim();
            this._label.visible = true;
        } else {
            this._label.text = '';
            this._label.visible = false;
        }
    }

    _getConfigPath() {
        return GLib.build_filenamev([GLib.get_user_config_dir(), 'cmdbar', 'commands.json']);
    }

    async _reloadMenu() {
        try {
            let configPath = this._getConfigPath();
            let extensionPath = this._extension.path.get_path();
            let config = await loadConfig(configPath, extensionPath);

            // Clear all current items in menu
            this.menu.removeAll();

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
                            let secure = cmd.secure || false;
                            if (cmd.parameters) {
                                if (Array.isArray(cmd.parameters)) {
                                    if (cmd.parameters.some(p => p.secure)) secure = true;
                                } else if (typeof cmd.parameters === 'object') {
                                    if (Object.values(cmd.parameters).some(p => p.secure)) secure = true;
                                }
                            }
                            this.menu.addMenuItem(new CommandInputMenuItem(this, cmd.name, cmd.command, cmd.placeholder, secure));
                        } else {
                            // Ordinary parameterless commands
                            this.menu.addMenuItem(new CommandMenuItem(this, cmd.name, cmd.command));
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

    executeCommand(commandName, commandTemplate, placeholderMap, sensitiveValues = []) {
        let tokens = tokenizeCommand(commandTemplate);
        let argv = substituteTokens(tokens, placeholderMap);

        if (argv.length === 0) {
            this._showNotification("Execution Error", "Command template parsed to empty argument list.");
            return;
        }

        let jobId = String(this._nextJobId++);
        let jobName = redactSensitiveValues(`${commandName} (${argv.join(' ')})`, sensitiveValues);

        try {
            let proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);

            let job = {
                id: jobId,
                name: jobName,
                process: proc,
                commandName: commandName,
                cancelled: false,
                startTime: Date.now(),
                sensitiveValues: sensitiveValues
            };

            this._activeJobs.set(jobId, job);

            // Dynamically add to the jobs section without redrawing everything (Requirement 3 & 4)
            if (this._activeJobs.size === 1) {
                this._jobsSectionSeparator = new PopupMenu.PopupSeparatorMenuItem();
                this._jobsSection.addMenuItem(this._jobsSectionSeparator);
                
                this._jobsSectionHeader = new PopupMenu.PopupMenuItem("Active Background Jobs", { reactive: false });
                this._jobsSectionHeader.label.style = 'font-weight: bold; color: #888888; font-size: 0.9em;';
                this._jobsSection.addMenuItem(this._jobsSectionHeader);
            }

            let jobMenuItem = new JobMenuItem(jobId, jobName, (id) => this._cancelJob(id));
            this._jobsSection.addMenuItem(jobMenuItem);
            this._jobMenuItems.set(jobId, jobMenuItem);

            // Execute asynchronously and non-blocking (Requirement 2 & 5)
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    let [success, stdout, stderr] = p.communicate_utf8_finish(res);
                    this._onJobFinished(jobId, success, stdout, stderr);
                } catch (e) {
                    this._onJobFinished(jobId, false, '', e.message);
                }
            });

        } catch (e) {
            let redactedErrorMsg = redactSensitiveValues(e.message, sensitiveValues);
            console.error(`CmdBar: failed to execute command: ${redactedErrorMsg}`);
            this._showNotification(`Execution Failed: ${commandName}`, redactedErrorMsg);
        }
    }

    _onJobFinished(jobId, success, stdout, stderr) {
        let job = this._activeJobs.get(jobId);
        if (!job) {
            return;
        }

        let sensitiveValues = job.sensitiveValues || [];

        // Clean up UI and job tracking
        let item = this._jobMenuItems.get(jobId);
        if (item) {
            item.destroy();
            this._jobMenuItems.delete(jobId);
        }
        this._activeJobs.delete(jobId);

        if (this._activeJobs.size === 0) {
            if (this._jobsSectionSeparator) {
                this._jobsSectionSeparator.destroy();
                this._jobsSectionSeparator = null;
            }
            if (this._jobsSectionHeader) {
                this._jobsSectionHeader.destroy();
                this._jobsSectionHeader = null;
            }
        }

        // Display detailed execution notification (Requirement 5)
        let title = "";
        let body = "";

        let redactedStdout = redactSensitiveValues(stdout, sensitiveValues);
        let redactedStderr = redactSensitiveValues(stderr, sensitiveValues);

        if (job.cancelled) {
            title = `Command Cancelled: ${job.commandName}`;
            body = `The process was stopped by the user.`;
        } else if (success) {
            title = `Command Succeeded: ${job.commandName}`;
            body = redactedStdout ? redactedStdout.trim() : 'Execution completed successfully.';
        } else {
            title = `Command Failed: ${job.commandName}`;
            body = redactedStderr ? redactedStderr.trim() : (redactedStdout ? redactedStdout.trim() : 'Execution failed with non-zero exit status.');
        }

        if (body.length > 300) {
            body = body.substring(0, 297) + '...';
        }

        this._showNotification(title, body);
    }

    _cancelJob(jobId) {
        let job = this._activeJobs.get(jobId);
        if (!job) {
            return;
        }

        job.cancelled = true;

        try {
            let proc = job.process;
            let pid = proc.get_identifier();
            
            // Force exit the main process (Requirement 4 & Guardrail: No Residual Processes)
            proc.force_exit();

            // Spawn pkill -P <pid> asynchronously to terminate child processes
            if (pid) {
                let pkillProc = Gio.Subprocess.new(['pkill', '-P', String(pid)], Gio.SubprocessFlags.NONE);
                pkillProc.communicate_utf8_async(null, null, null);
            }
        } catch (e) {
            console.error(`CmdBar: error cancelling job ${jobId}: ${e.message}`);
        }

        this._onJobFinished(jobId, false, '', 'Process cancelled by user.');
    }

    _showNotification(title, body) {
        try {
            if (Main && typeof Main.notify === 'function') {
                Main.notify(title, body);
            } else {
                let proc = Gio.Subprocess.new(['notify-send', title, body], Gio.SubprocessFlags.NONE);
                proc.communicate_utf8_async(null, null, null);
            }
        } catch (e) {
            console.error(`CmdBar notification error: ${e.message}`);
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
        this._settings = this.getSettings();

        this._indicator = new CmdBarIndicator(this);
        // Add to the system status bar panel
        Main.panel.addToStatusArea('cmdbar-indicator', this._indicator);

        // Apply initial configuration values
        this._updateIndicatorVisibility(this._settings.get_boolean('show-indicator'));
        this._updateButtonLabel(this._settings.get_string('button-label'));

        // Listen for live GSettings changes
        this._showIndicatorId = this._settings.connect('changed::show-indicator', (settings, key) => {
            const visible = settings.get_boolean(key);
            this._updateIndicatorVisibility(visible);
        });

        this._buttonLabelId = this._settings.connect('changed::button-label', (settings, key) => {
            const labelText = settings.get_string(key);
            this._updateButtonLabel(labelText);
        });

        this._placeholderTextId = this._settings.connect('changed::placeholder-text', () => {
            if (this._indicator) {
                this._indicator._reloadMenu();
            }
        });
    }

    _updateIndicatorVisibility(visible) {
        if (this._indicator) {
            this._indicator.visible = visible;
        }
    }

    _updateButtonLabel(labelText) {
        if (this._indicator) {
            this._indicator.setButtonLabel(labelText);
        }
    }

    disable() {
        // Clean up GSettings connections
        if (this._settings) {
            if (this._showIndicatorId) {
                this._settings.disconnect(this._showIndicatorId);
                this._showIndicatorId = 0;
            }
            if (this._buttonLabelId) {
                this._settings.disconnect(this._buttonLabelId);
                this._buttonLabelId = 0;
            }
            if (this._placeholderTextId) {
                this._settings.disconnect(this._placeholderTextId);
                this._placeholderTextId = 0;
            }
            this._settings = null;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
