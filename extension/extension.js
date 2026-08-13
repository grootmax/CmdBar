import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import { St, Clutter, Gio, GLib, GObject } from 'gi';

import { validateInput, substituteCommand, hasPlaceholder, tokenizeCommand, getPlaceholders, substituteTokens } from './commandProcessor.js';

// Dialog box for dynamic parameters (Requirement 1 & User Scenario 1)
const CommandParameterDialog = GObject.registerClass(
class CommandParameterDialog extends ModalDialog.ModalDialog {
    _init(commandName, commandTemplate, placeholders, onSubmit) {
        super._init({
            styleClass: 'cmdbar-parameter-dialog'
        });

        this._commandName = commandName;
        this._commandTemplate = commandTemplate;
        this._placeholders = placeholders;
        this._onSubmit = onSubmit;

        // Content Box
        let contentBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style: 'padding: 24px; width: 400px;'
        });

        // Title
        let titleLabel = new St.Label({
            text: `Run: ${commandName}`,
            style: 'font-weight: bold; font-size: 1.25em; margin-bottom: 12px; color: #ffffff;'
        });
        contentBox.add_child(titleLabel);

        // Subtitle / Template
        let templateLabel = new St.Label({
            text: `Template: ${commandTemplate}`,
            style: 'font-size: 0.9em; color: #aaaaaa; margin-bottom: 16px;',
            line_wrap: true
        });
        contentBox.add_child(templateLabel);

        // Input Entries for each placeholder
        this._entries = {};
        for (const placeholder of placeholders) {
            let label = new St.Label({
                text: `Parameter: ${placeholder}`,
                style: 'font-weight: bold; margin-bottom: 6px; font-size: 0.95em;'
            });
            contentBox.add_child(label);

            let entry = new St.Entry({
                hint_text: `Enter value for ${placeholder}...`,
                can_focus: true,
                style: 'padding: 8px; margin-bottom: 16px; background-color: #2e2e2e; border: 1px solid #444444; border-radius: 6px; color: #ffffff;'
            });
            contentBox.add_child(entry);
            this._entries[placeholder] = entry;
        }

        this.contentLayout.add_child(contentBox);

        // Buttons
        this.setButtons([
            {
                label: 'Cancel',
                action: () => {
                    this.close();
                },
                key: Clutter.KEY_Escape
            },
            {
                label: 'Execute',
                action: () => {
                    this._onExecute();
                },
                key: Clutter.KEY_Return
            }
        ]);
    }

    _onExecute() {
        let values = {};
        let isValid = true;

        for (const placeholder of this._placeholders) {
            let entry = this._entries[placeholder];
            let val = entry.get_text();
            if (!validateInput(val)) {
                isValid = false;
                entry.style = 'padding: 8px; margin-bottom: 16px; background-color: #2e2e2e; border: 1px solid #ff3333; border-radius: 6px; color: #ffffff;';
            } else {
                entry.style = 'padding: 8px; margin-bottom: 16px; background-color: #2e2e2e; border: 1px solid #444444; border-radius: 6px; color: #ffffff;';
                values[placeholder] = val.trim();
            }
        }

        if (!isValid) {
            return;
        }

        this.close();
        if (typeof this._onSubmit === 'function') {
            this._onSubmit(values);
        }
    }
}
);

// Custom menu item with an inline text entry for commands that have placeholders
const CommandInputMenuItem = GObject.registerClass(
class CommandInputMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(indicator, commandName, commandTemplate, placeholderText) {
        super._init({
            reactive: true,
            activate: false // prevent automatic closing on item click
        });

        this._indicator = indicator;
        this._commandName = commandName;
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

        // Perform template substitution safely
        let placeholders = getPlaceholders(this._commandTemplate);
        let placeholder = placeholders[0] || '<task-id>';
        let mapping = { [placeholder]: text.trim() };

        // Execute via indicator (non-blocking, tokenized, secure!)
        this._indicator.executeCommand(this._commandName, this._commandTemplate, mapping);

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

// Standard menu item for parameterless or parameter-prompting commands
const CommandMenuItem = GObject.registerClass(
class CommandMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(indicator, commandName, commandTemplate) {
        super._init({
            reactive: true,
            activate: true
        });

        this._indicator = indicator;
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
            if (hasPlaceholder(this._commandTemplate)) {
                let placeholders = getPlaceholders(this._commandTemplate);
                let dialog = new CommandParameterDialog(this._commandName, this._commandTemplate, placeholders, (mapping) => {
                    this._indicator.executeCommand(this._commandName, this._commandTemplate, mapping);
                });
                dialog.open();
            } else {
                this._indicator.executeCommand(this._commandName, this._commandTemplate, {});
            }
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
        this._activeJobs = new Map();
        this._jobMenuItems = new Map();
        this._nextJobId = 1;

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
                        this.menu.addMenuItem(new CommandInputMenuItem(this, cmd.name, cmd.command, cmd.placeholder));
                    } else {
                        // Ordinary parameterless commands
                        this.menu.addMenuItem(new CommandMenuItem(this, cmd.name, cmd.command));
                    }
                });
            }
        });

        // Recreate the active jobs section (Requirement 3)
        this._jobsSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._jobsSection);

        if (this._activeJobs.size > 0) {
            this._jobsSectionSeparator = new PopupMenu.PopupSeparatorMenuItem();
            this._jobsSection.addMenuItem(this._jobsSectionSeparator);

            this._jobsSectionHeader = new PopupMenu.PopupMenuItem("Active Background Jobs", { reactive: false });
            this._jobsSectionHeader.label.style = 'font-weight: bold; color: #888888; font-size: 0.9em;';
            this._jobsSection.addMenuItem(this._jobsSectionHeader);

            for (let [jobId, job] of this._activeJobs) {
                let item = new JobMenuItem(jobId, job.name, (id) => this._cancelJob(id));
                this._jobsSection.addMenuItem(item);
                this._jobMenuItems.set(jobId, item);
            }
        }
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
                    this._reloadMenu();
                }
            });
        } catch (e) {
            console.error(`CmdBar: failed to initialize file monitor: ${e.message}`);
        }
    }

    executeCommand(commandName, commandTemplate, placeholderMap) {
        let tokens = tokenizeCommand(commandTemplate);
        let argv = substituteTokens(tokens, placeholderMap);

        if (argv.length === 0) {
            this._showNotification("Execution Error", "Command template parsed to empty argument list.");
            return;
        }

        let jobId = String(this._nextJobId++);
        let jobName = `${commandName} (${argv.join(' ')})`;

        try {
            let proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);

            let job = {
                id: jobId,
                name: jobName,
                process: proc,
                commandName: commandName,
                cancelled: false,
                startTime: Date.now()
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
            console.error(`CmdBar: failed to execute command: ${e.message}`);
            this._showNotification(`Execution Failed: ${commandName}`, e.message);
        }
    }

    _onJobFinished(jobId, success, stdout, stderr) {
        let job = this._activeJobs.get(jobId);
        if (!job) {
            return;
        }

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

        if (job.cancelled) {
            title = `Command Cancelled: ${job.commandName}`;
            body = `The process was stopped by the user.`;
        } else if (success) {
            title = `Command Succeeded: ${job.commandName}`;
            body = stdout ? stdout.trim() : 'Execution completed successfully.';
        } else {
            title = `Command Failed: ${job.commandName}`;
            body = stderr ? stderr.trim() : (stdout ? stdout.trim() : 'Execution failed with non-zero exit status.');
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
        // Cancel all active jobs on extension unload/destroy (Guardrail: No Residual Processes)
        for (let [jobId, job] of this._activeJobs) {
            try {
                job.process.force_exit();
                let pid = job.process.get_identifier();
                if (pid) {
                    let pkillProc = Gio.Subprocess.new(['pkill', '-P', String(pid)], Gio.SubprocessFlags.NONE);
                    pkillProc.communicate_utf8_async(null, null, null);
                }
            } catch (e) {
                // Ignore errors on shutdown
            }
        }
        this._activeJobs.clear();
        this._jobMenuItems.clear();

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
