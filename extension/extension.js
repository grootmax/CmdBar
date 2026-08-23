import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as ModalDialog from "resource:///org/gnome/shell/ui/modalDialog.js";
import { St, Clutter, Gio, GLib, GObject, Meta, Shell } from "gi";

import {
  validateInput,
  substituteCommand,
  hasPlaceholder,
  tokenizeCommand,
  substituteTokens,
  getPlaceholders,
  getPreviewTokens,
  formatShortcutHint,
  parseAccel,
} from "./commandProcessor.js";
import { loadConfig } from "./configSync.js";

// Native GNOME Shell Modal Dialog for command execution confirmation
const ExecutionConfirmationDialog = GObject.registerClass(
  class ExecutionConfirmationDialog extends ModalDialog.ModalDialog {
    _init(commandName, binaryPath, argsList, onConfirm, onCancel) {
      super._init({ style_class: "cmdbar-confirmation-dialog" });

      this._onConfirm = onConfirm;
      this._onCancel = onCancel;
      this._executed = false;

      let mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        style_class: "cmdbar-dialog-content",
        style: "padding: 16px; min-width: 320px;",
      });

      let headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        style: "margin-bottom: 8px;",
      });

      let icon = new St.Icon({
        icon_name: "dialog-warning-symbolic",
        style_class: "popup-menu-icon",
        style: "margin-right: 8px;",
        y_align: Clutter.ActorAlign.CENTER,
      });
      headerBox.add_child(icon);

      let titleLabel = new St.Label({
        text: `Confirm Execution: ${commandName}`,
        style: "font-weight: bold; font-size: 1.1em;",
        y_align: Clutter.ActorAlign.CENTER,
      });
      headerBox.add_child(titleLabel);

      mainBox.add_child(headerBox);

      let descLabel = new St.Label({
        text: "This command is unverified. Please review execution details:",
        style: "margin-bottom: 12px; color: #aaaaaa; font-size: 0.9em;",
      });
      mainBox.add_child(descLabel);

      let binaryLabel = new St.Label({
        text: `Binary Path: ${binaryPath}`,
        style: "font-family: monospace; font-weight: bold; margin-bottom: 6px;",
      });
      mainBox.add_child(binaryLabel);

      let argsText =
        argsList && argsList.length > 0 ? argsList.join(" ") : "(None)";
      let argsLabel = new St.Label({
        text: `Arguments: ${argsText}`,
        style: "font-family: monospace; margin-bottom: 16px;",
      });
      mainBox.add_child(argsLabel);

      this.contentLayout.add_child(mainBox);

      this.addButton({
        label: "Cancel",
        action: () => {
          this.close();
          if (!this._executed && this._onCancel) {
            this._onCancel();
          }
        },
        key: Clutter.KEY_Escape,
      });

      this.addButton({
        label: "Execute",
        action: () => {
          this._executed = true;
          this.close();
          if (this._onConfirm) {
            this._onConfirm();
          }
        },
        default: true,
      });
    }
  },
);

function requestCommandConfirmation(
  commandName,
  argv,
  previewArgv,
  cmdObj,
  onConfirm,
  onCancel,
) {
  if (cmdObj && cmdObj.verified === true) {
    onConfirm();
    return;
  }

  let binaryPath = argv[0] || "";
  let argsList = previewArgv ? previewArgv.slice(1) : argv.slice(1);

  try {
    if (Main && Main.uiGroup) {
      let dialog = new ExecutionConfirmationDialog(
        commandName,
        binaryPath,
        argsList,
        onConfirm,
        onCancel,
      );
      dialog.open();
      return;
    }
  } catch (e) {
    console.warn(
      `CmdBar: ModalDialog unavailable, falling back to Zenity confirmation: ${e.message}`,
    );
  }

  try {
    let text = `Unverified Command Invocation:\n\nBinary Path: ${binaryPath}\nArguments: ${argsList.join(" ")}\n\nDo you want to execute this command?`;
    let proc = Gio.Subprocess.new(
      [
        "zenity",
        "--question",
        "--title",
        `Confirm Execution: ${commandName}`,
        "--text",
        text,
      ],
      Gio.SubprocessFlags.NONE,
    );
    proc.wait_async(null, (subprocess, res) => {
      try {
        subprocess.wait_finish(res);
        if (subprocess.get_successful()) {
          onConfirm();
        } else {
          if (onCancel) onCancel();
        }
      } catch (err) {
        if (onCancel) onCancel();
      }
    });
  } catch (e) {
    console.error(`CmdBar: Failed to show confirmation modal: ${e.message}`);
    if (onCancel) onCancel();
  }
}

/**
 * Run a command asynchronously as a direct tokenized array and notify the user when done.
 * @param {string} commandName
 * @param {string|string[]} commandString
 * @param {object} [cmdObj]
 * @param {object} [placeholderMap]
 */
function runCommandAsync(commandName, commandString, cmdObj, placeholderMap) {
  let tokens = Array.isArray(commandString)
    ? commandString
    : tokenizeCommand(commandString);
  let argv = substituteTokens(tokens, placeholderMap);
  if (argv.length === 0) {
    Main.notify(
      "Command Execution Failed",
      "Command parsed to empty argument list.",
    );
    return;
  }

  let previewArgv = getPreviewTokens(
    argv,
    placeholderMap,
    cmdObj ? cmdObj.parameters : [],
  );

  requestCommandConfirmation(
    commandName,
    argv,
    previewArgv,
    cmdObj,
    () => {
      try {
        let proc = Gio.Subprocess.new(
          argv,
          Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        );

        proc.communicate_utf8_async(null, null, (subprocess, result) => {
          try {
            let [stdout, stderr] = subprocess.communicate_utf8_finish(result);
            let success = subprocess.get_successful();
            let exitStatus = "unknown";
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
            Main.notify(
              `Command Error: ${commandName}`,
              `Failed to execute: ${err.message}`,
            );
          }
        });
      } catch (e) {
        console.error(`CmdBar: failed to spawn command: ${e.message}`);
        Main.notify(
          `Command Launch Failed: ${commandName}`,
          `Could not start command: ${e.message}`,
        );
      }
    },
    () => {
      console.log(
        `CmdBar: Command execution cancelled by user: ${commandName}`,
      );
    },
  );
}

/**
 * Asynchronously executes a shell command and notifies the user on failure.
 *
 * @param {string|string[]} commandLineString The command string to execute.
 * @param {object} [cmdObj]
 */
function _executeCommandAsync(commandLineString, cmdObj) {
  try {
    let argv = Array.isArray(commandLineString)
      ? commandLineString
      : tokenizeCommand(commandLineString);
    if (!argv || argv.length === 0) {
      Main.notify(
        "Command Execution Failed",
        `Could not parse command: "${commandLineString}"`,
      );
      return;
    }

    let previewArgv = getPreviewTokens(
      argv,
      {},
      cmdObj ? cmdObj.parameters : [],
    );

    requestCommandConfirmation(
      "Command",
      argv,
      previewArgv,
      cmdObj,
      () => {
        let proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDERR_PIPE);
        proc.communicate_utf8_async(null, null, (subprocess, result) => {
          try {
            let [stdout, stderr] = subprocess.communicate_utf8_finish(result);

            if (!subprocess.get_successful()) {
              let exitStatus = subprocess.get_exit_status();
              let rawError = stderr ? stderr.trim() : "";
              let detailedError =
                rawError || `Process exited with code ${exitStatus}`;

              const MAX_ERR_LENGTH = 200;
              if (detailedError.length > MAX_ERR_LENGTH) {
                detailedError =
                  detailedError.substring(0, MAX_ERR_LENGTH) + "...";
              }

              Main.notify("Command Execution Failed", detailedError);
            }
          } catch (e) {
            console.error(`CmdBar error reading stderr: ${e.message}`);
            Main.notify("Command Execution Failed", e.message);
          }
        });
      },
      () => {
        console.log("CmdBar: Command execution cancelled by user.");
      },
    );
  } catch (e) {
    console.error(`CmdBar parsing/spawn error: ${e.message}`);
    Main.notify(
      "Command Execution Failed",
      `Failed to start command: ${e.message}`,
    );
  }
}

/**
 * Harvest environment asynchronously on startup using env command.
 */
function harvestEnvironment() {
  try {
    let proc = Gio.Subprocess.new(
      ["/usr/bin/env"],
      Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    );

    proc.communicate_utf8_async(null, null, (subprocess, result) => {
      try {
        let [stdout, stderr] = subprocess.communicate_utf8_finish(result);
        if (subprocess.get_successful()) {
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
    _init(indicator, commandName, commandTemplate, placeholderText, cmdObj) {
      super._init({
        reactive: true,
        activate: false,
      });

      this._indicator = indicator;
      this._commandName = commandName;
      this._commandTemplate = commandTemplate;
      this._placeholderText = placeholderText || "Enter parameter...";
      this._cmdObj = cmdObj || {};

      this.box = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
      });

      let inputIconName =
        (this._cmdObj && this._cmdObj.icon) || "edit-find-symbolic";
      this.icon = new St.Icon({
        icon_name: inputIconName,
        style_class: "popup-menu-icon",
        style: "margin-right: 8px;",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this.box.add_child(this.icon);

      this.label = new St.Label({
        text: commandName,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
      });
      this.box.add_child(this.label);

      this.add_child(this.box);

      this._activateId = this.connect("activate", () => {
        this._onSubmit(commandName);
      });
    }

    _onSubmit(commandName) {
      try {
        let proc = Gio.Subprocess.new(
          [
            "zenity",
            "--entry",
            "--title",
            commandName,
            "--text",
            `Enter value for ${this._placeholderText}:`,
          ],
          Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        );

        proc.communicate_utf8_async(null, null, (subprocess, result) => {
          try {
            let [stdout, stderr] = subprocess.communicate_utf8_finish(result);
            if (subprocess.get_successful()) {
              let text = stdout ? stdout.trim() : "";
              if (validateInput(text)) {
                let tokens = Array.isArray(this._commandTemplate)
                  ? this._commandTemplate
                  : tokenizeCommand(this._commandTemplate);
                let placeholders = getPlaceholders(this._commandTemplate);
                let placeholderMap = {};
                placeholders.forEach((ph) => {
                  placeholderMap[ph] = text;
                });
                let argv = substituteTokens(tokens, placeholderMap);

                if (argv.length === 0) {
                  console.warn(
                    `CmdBar: Command template parsed to empty argument list: ${this._commandTemplate}`,
                  );
                  Main.notify(
                    "Execution Error",
                    "Command template parsed to empty argument list.",
                  );
                  return;
                }

                let previewArgv = getPreviewTokens(
                  argv,
                  placeholderMap,
                  this._cmdObj.parameters,
                );

                requestCommandConfirmation(
                  commandName,
                  argv,
                  previewArgv,
                  this._cmdObj,
                  () => {
                    try {
                      let cmdProc = Gio.Subprocess.new(
                        argv,
                        Gio.SubprocessFlags.NONE,
                      );
                      if (
                        this._indicator &&
                        this._indicator.menu &&
                        typeof this._indicator.menu.close === "function"
                      ) {
                        this._indicator.menu.close();
                      }
                    } catch (err) {
                      console.error(
                        `CmdBar: failed to spawn command: ${err.message}`,
                      );
                      Main.notify(
                        "Command Execution Failed",
                        `Failed to start command: ${err.message}`,
                      );
                    }
                  },
                  () => {
                    console.log(
                      `CmdBar: Command execution cancelled by user: ${commandName}`,
                    );
                  },
                );
              } else {
                console.warn(
                  `CmdBar: Empty input validation failed for command: ${commandName}`,
                );
                Main.notify(
                  "Command Validation Failed",
                  `Parameter input cannot be empty.`,
                );
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
  },
);

// Standard menu item for parameterless or parameter-prompting commands
const CommandMenuItem = GObject.registerClass(
  class CommandMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(indicator, commandName, commandTemplate, cmdObj) {
      super._init({
        reactive: true,
        activate: true,
      });

      this._commandName = commandName;
      this._commandTemplate = commandTemplate;
      this._cmdObj = cmdObj || {};

      this.box = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
      });

      let cmdIconName =
        (this._cmdObj && this._cmdObj.icon) || "utilities-terminal-symbolic";
      this.icon = new St.Icon({
        icon_name: cmdIconName,
        style_class: "popup-menu-icon",
        style: "margin-right: 8px;",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this.box.add_child(this.icon);

      this.label = new St.Label({
        text: commandName,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
      });
      this.box.add_child(this.label);

      this.add_child(this.box);

      this._activateId = this.connect("activate", () => {
        runCommandAsync(this._commandName, this._commandTemplate, this._cmdObj);
      });
    }

    destroy() {
      if (this._activateId) {
        this.disconnect(this._activateId);
        this._activateId = 0;
      }
      super.destroy();
    }
  },
);

// Active job menu item with cancel button (Requirement 3 & 4)
const JobMenuItem = GObject.registerClass(
  class JobMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(jobId, jobName, onCancel) {
      super._init({
        reactive: true,
        activate: false,
      });

      this.jobId = jobId;

      this.box = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        style: "padding: 4px 6px;",
      });

      this.statusIcon = new St.Icon({
        icon_name: "process-working-symbolic",
        style_class: "system-status-icon",
        style: "margin-right: 12px; color: #3584e4;",
      });
      this.box.add_child(this.statusIcon);

      this.label = new St.Label({
        text: jobName,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        style: "font-size: 0.95em;",
      });
      this.box.add_child(this.label);

      this.cancelButton = new St.Button({
        child: new St.Icon({
          icon_name: "media-playback-stop-symbolic",
          style_class: "system-status-icon",
          style: "color: #e01b24;",
        }),
        style: "padding: 6px; border-radius: 6px;",
        track_hover: true,
        can_focus: true,
      });

      this.cancelButton.connect("clicked", () => {
        if (typeof onCancel === "function") {
          onCancel(jobId);
        }
      });

      this.box.add_child(this.cancelButton);
      this.add_child(this.box);
    }
  },
);

// Menu item for group/category headers
const CategoryHeaderMenuItem = GObject.registerClass(
  class CategoryHeaderMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(categoryName) {
      super._init({
        reactive: false,
        activate: false,
      });

      this.box = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        style_class: "cmdbar-category-header",
        x_expand: true,
      });

      this.icon = new St.Icon({
        icon_name: "folder-symbolic",
        style_class: "popup-menu-icon",
        style: "margin-right: 8px; margin-top: 6px; margin-bottom: 2px;",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this.box.add_child(this.icon);

      this.label = new St.Label({
        text: categoryName,
        style:
          "font-weight: bold; color: #888888; font-size: 0.95em; margin-top: 6px; margin-bottom: 2px;",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this.box.add_child(this.label);

      this.add_child(this.box);
    }
  },
);

// The top bar status area panel indicator
const CmdBarIndicator = GObject.registerClass(
  class CmdBarIndicator extends PanelMenu.Button {
    _init(extension) {
      super._init(0.0, "CmdBar");

      this._extension = extension;
      this._monitor = null;
      this._cachedConfig = null;
      this._timeoutId = 0;

      // Container box to support text and icon side-by-side
      this._box = new St.BoxLayout({
        style_class: "panel-status-menu-box",
      });

      // Display icon in the top-bar indicator
      this._icon = new St.Icon({
        icon_name: "system-run-symbolic",
        style_class: "system-status-icon",
      });
      this._box.add_child(this._icon);

      // Display text label next to icon (dynamically customized)
      this._label = new St.Label({
        text: "",
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "cmdbar-button-label",
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
        this._label.text = "";
        this._label.visible = false;
      }
    }

    /**
     * Update indicator button tooltip with shortcut hint.
     * @param {string|string[]} accelStr
     */
    updateShortcutTooltip(accelStr) {
      let hint = formatShortcutHint(accelStr);
      let tooltipText = `CmdBar (${hint})`;
      if (typeof this.set_tooltip_text === "function") {
        this.set_tooltip_text(tooltipText);
      }
      this.tooltip_text = tooltipText;
    }

    _getConfigPath() {
      return GLib.build_filenamev([
        GLib.get_user_config_dir(),
        "cmdbar",
        "config.json",
      ]);
    }

    async _reloadMenu() {
      try {
        let configPath = this._getConfigPath();
        let extensionPath = this._extension.dir.get_path();
        let config = await loadConfig(configPath, extensionPath);

        if (config && config._isInvalid) {
          this._showNotification(
            "CmdBar Configuration Error",
            "Invalid configuration file detected. Using in-memory default settings without overwriting your file.",
          );
        }

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
            category.commands.forEach((cmd) => {
              if (hasPlaceholder(cmd.command)) {
                // Commands requiring text inputs (Requirement 1 & 2)
                this.menu.addMenuItem(
                  new CommandInputMenuItem(
                    this,
                    cmd.name,
                    cmd.command,
                    cmd.placeholder,
                    cmd,
                  ),
                );
              } else {
                // Ordinary parameterless commands
                this.menu.addMenuItem(
                  new CommandMenuItem(this, cmd.name, cmd.command, cmd),
                );
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
        this._monitorId = this._monitor.connect(
          "changed",
          (monitor, file, otherFile, eventType) => {
            // Trigger dynamic live reload on modifications or updates
            if (
              eventType === Gio.FileMonitorEvent.CHANGES_DONE_HINT ||
              eventType === Gio.FileMonitorEvent.CREATED ||
              eventType === Gio.FileMonitorEvent.CHANGED ||
              eventType === Gio.FileMonitorEvent.ATTRIBUTE_CHANGED
            ) {
              if (this._timeoutId) {
                GLib.Source.remove(this._timeoutId);
                this._timeoutId = 0;
              }
              this._timeoutId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                200,
                () => {
                  this._timeoutId = 0;
                  this._reloadMenu();
                  return GLib.SOURCE_REMOVE !== undefined
                    ? GLib.SOURCE_REMOVE
                    : false;
                },
              );
            }
          },
        );
      } catch (e) {
        console.error(
          `CmdBar: failed to initialize file monitor: ${e.message}`,
        );
      }
    }

    executeCommand(commandName, commandTemplate, placeholderMap, cmdObj) {
      let tokens = Array.isArray(commandTemplate)
        ? commandTemplate
        : tokenizeCommand(commandTemplate);
      let argv = substituteTokens(tokens, placeholderMap);

      if (argv.length === 0) {
        this._showNotification(
          "Execution Error",
          "Command template parsed to empty argument list.",
        );
        return;
      }

      let previewArgv = getPreviewTokens(
        argv,
        placeholderMap,
        cmdObj ? cmdObj.parameters : [],
      );

      requestCommandConfirmation(
        commandName,
        argv,
        previewArgv,
        cmdObj,
        () => {
          let jobId = String(this._nextJobId++);
          let jobName = `${commandName} (${argv.join(" ")})`;

          try {
            let proc = Gio.Subprocess.new(
              argv,
              Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            );

            let job = {
              id: jobId,
              name: jobName,
              process: proc,
              commandName: commandName,
              cancelled: false,
              startTime: Date.now(),
            };

            this._activeJobs.set(jobId, job);

            // Dynamically add to the jobs section without redrawing everything (Requirement 3 & 4)
            if (this._activeJobs.size === 1) {
              this._jobsSectionSeparator =
                new PopupMenu.PopupSeparatorMenuItem();
              this._jobsSection.addMenuItem(this._jobsSectionSeparator);

              this._jobsSectionHeader = new PopupMenu.PopupMenuItem(
                "Active Background Jobs",
                { reactive: false },
              );
              this._jobsSectionHeader.label.style =
                "font-weight: bold; color: #888888; font-size: 0.9em;";
              this._jobsSection.addMenuItem(this._jobsSectionHeader);
            }

            let jobMenuItem = new JobMenuItem(jobId, jobName, (id) =>
              this._cancelJob(id),
            );
            this._jobsSection.addMenuItem(jobMenuItem);
            this._jobMenuItems.set(jobId, jobMenuItem);

            // Execute asynchronously and non-blocking (Requirement 2 & 5)
            proc.communicate_utf8_async(null, null, (p, res) => {
              try {
                let [stdout, stderr] = p.communicate_utf8_finish(res);
                let success = p.get_successful();
                this._onJobFinished(jobId, success, stdout, stderr);
              } catch (e) {
                this._onJobFinished(jobId, false, "", e.message);
              }
            });
          } catch (e) {
            console.error(`CmdBar: failed to execute command: ${e.message}`);
            this._showNotification(
              `Execution Failed: ${commandName}`,
              e.message,
            );
          }
        },
        () => {
          console.log(`CmdBar: Execution of '${commandName}' canceled.`);
        },
      );
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
        body = stdout ? stdout.trim() : "Execution completed successfully.";
      } else {
        title = `Command Failed: ${job.commandName}`;
        body = stderr
          ? stderr.trim()
          : stdout
            ? stdout.trim()
            : "Execution failed with non-zero exit status.";
      }

      if (body.length > 300) {
        body = body.substring(0, 297) + "...";
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
          let pkillProc = Gio.Subprocess.new(
            ["pkill", "-P", String(pid)],
            Gio.SubprocessFlags.NONE,
          );
          pkillProc.communicate_utf8_async(null, null, null);
        }
      } catch (e) {
        console.error(`CmdBar: error cancelling job ${jobId}: ${e.message}`);
      }

      this._onJobFinished(jobId, false, "", "Process cancelled by user.");
    }

    _showNotification(title, body) {
      try {
        if (Main && typeof Main.notify === "function") {
          Main.notify(title, body);
        } else {
          let proc = Gio.Subprocess.new(
            ["notify-send", title, body],
            Gio.SubprocessFlags.NONE,
          );
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
  },
);

export default class CmdBarExtension extends Extension {
  /**
   * Enable the extension, add panel indicator, and register keybindings.
   */
  enable() {
    this._settings = this.getSettings();

    this._indicator = new CmdBarIndicator(this);
    // Add to the system status bar panel
    Main.panel.addToStatusArea("cmdbar-indicator", this._indicator);

    // Apply initial configuration values
    this._updateIndicatorVisibility(
      this._settings.get_boolean("show-indicator"),
    );
    this._updateButtonLabel(this._settings.get_string("button-label"));

    // Apply initial keybinding shortcut hint
    const initialAccel = this._settings.get_strv("shortcut");
    if (this._indicator) {
      this._indicator.updateShortcutTooltip(initialAccel);
    }

    // Register global keybinding
    this._registerKeybinding();

    // Listen for live GSettings changes
    this._showIndicatorId = this._settings.connect(
      "changed::show-indicator",
      (settings, key) => {
        const visible = settings.get_boolean(key);
        this._updateIndicatorVisibility(visible);
      },
    );

    this._buttonLabelId = this._settings.connect(
      "changed::button-label",
      (settings, key) => {
        const labelText = settings.get_string(key);
        this._updateButtonLabel(labelText);
      },
    );

    this._placeholderTextId = this._settings.connect(
      "changed::placeholder-text",
      () => {
        if (this._indicator) {
          this._indicator._reloadMenu();
        }
      },
    );

    this._shortcutId = this._settings.connect(
      "changed::shortcut",
      (settings, key) => {
        const accel = settings.get_strv(key);
        if (this._indicator) {
          this._indicator.updateShortcutTooltip(accel);
        }
        this._registerKeybinding();
      },
    );
  }

  /**
   * Register global GNOME keybinding to toggle CmdBar menu.
   */
  _registerKeybinding() {
    try {
      if (Main && Main.wm && typeof Main.wm.addKeybinding === "function") {
        let flags =
          typeof Meta !== "undefined" && Meta.KeyBindingFlags
            ? Meta.KeyBindingFlags.NONE
            : 0;
        let mode =
          typeof Shell !== "undefined" && Shell.ActionMode
            ? Shell.ActionMode.ALL
            : 1;

        try {
          if (typeof Main.wm.removeKeybinding === "function") {
            Main.wm.removeKeybinding("shortcut");
          }
        } catch (e) {}

        Main.wm.addKeybinding(
          "shortcut",
          this._settings,
          flags,
          mode,
          () => {
            this._toggleMenu();
          },
        );
      }
    } catch (e) {
      console.error(`CmdBar: Failed to register keybinding: ${e.message}`);
    }
  }

  /**
   * Unregister global GNOME keybinding.
   */
  _unregisterKeybinding() {
    try {
      if (Main && Main.wm && typeof Main.wm.removeKeybinding === "function") {
        Main.wm.removeKeybinding("shortcut");
      }
    } catch (e) {
      console.error(`CmdBar: Failed to unregister keybinding: ${e.message}`);
    }
  }

  /**
   * Toggle opening or closing the indicator menu.
   */
  _toggleMenu() {
    if (this._indicator && this._indicator.menu) {
      this._indicator.menu.toggle();
    }
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

  /**
   * Disable extension and clean up resources and keybindings.
   */
  disable() {
    this._unregisterKeybinding();

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
      if (this._shortcutId) {
        this._settings.disconnect(this._shortcutId);
        this._shortcutId = 0;
      }
      this._settings = null;
    }

    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }
  }
}
