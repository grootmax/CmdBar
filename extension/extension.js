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
import {
  translateNaturalLanguageToCommand,
  isAICommand,
  cleanAIPrompt,
} from "./aiTranslator.js";

async function handleAICommandExecution(commandStr, config, onComplete) {
  try {
    if (Main && typeof Main.notify === "function") {
      Main.notify("CmdBar AI Assistant", "Translating prompt to shell command...");
    }

    const generatedCmd = await translateNaturalLanguageToCommand(commandStr, config || {});

    if (!generatedCmd) {
      if (Main && typeof Main.notify === "function") {
        Main.notify("AI Translation Failed", "AI model returned an empty command.");
      }
      return;
    }

    const aiCfg = (config && config.ai) || {};
    const requireConfirm = aiCfg.require_confirmation !== false;
    const tokens = tokenizeCommand(generatedCmd);

    if (requireConfirm) {
      requestCommandConfirmation(
        `AI Command (${cleanAIPrompt(commandStr)})`,
        tokens,
        tokens,
        { verified: false },
        () => {
          _executeDirectTokens(tokens, "AI Command");
          if (onComplete) onComplete();
        },
        () => {
          console.log("CmdBar AI: User cancelled execution of AI generated command.");
          if (onComplete) onComplete();
        }
      );
    } else {
      _executeDirectTokens(tokens, "AI Command");
      if (onComplete) onComplete();
    }
  } catch (err) {
    console.error(`CmdBar AI error: ${err.message}`);
    if (Main && typeof Main.notify === "function") {
      Main.notify("AI Translation Error", err.message);
    }
  }
}

function _executeDirectTokens(argv, commandName) {
  try {
    let proc = Gio.Subprocess.new(
      argv,
      Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
    );

    proc.communicate_utf8_async(null, null, (subprocess, result) => {
      try {
        let [stdout, stderr] = subprocess.communicate_utf8_finish(result);
        let success = subprocess.get_successful();
        let exitStatus = "unknown";
        if (subprocess.get_if_exited()) {
          exitStatus = String(subprocess.get_exit_status());
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
          }
          Main.notify(title, body);
        }
      } catch (err) {
        if (Main && typeof Main.notify === "function") {
          Main.notify(`Command Error: ${commandName}`, err.message);
        }
      }
    });
  } catch (e) {
    if (Main && typeof Main.notify === "function") {
      Main.notify(`Command Launch Failed: ${commandName}`, e.message);
    }
  }
}

// Native GNOME Shell Modal Dialog for command execution confirmation
const ExecutionConfirmationDialog = GObject.registerClass(
  class ExecutionConfirmationDialog extends ModalDialog.ModalDialog {
    _init(commandName, binaryPath, argsList, onConfirm, onCancel) {
      super._init({ style_class: "cmdbar-confirmation-dialog" });

      this._onConfirm = onConfirm;
      this._onCancel = onCancel;
      this._executed = false;

      let mainBox = new St.BoxLayout({
        vertical: true,
        style_class: "cmdbar-dialog-content",
        style: "padding: 16px; min-width: 320px;",
      });

      let headerBox = new St.BoxLayout({
        vertical: false,
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
function runCommandAsync(commandName, commandString, cmdObj, placeholderMap, config) {
  let rawCmdStr = Array.isArray(commandString)
    ? commandString.join(" ")
    : String(commandString || "");

  if (isAICommand(rawCmdStr) || isAICommand(commandName)) {
    handleAICommandExecution(rawCmdStr, config || {}, () => {});
    return;
  }

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
        vertical: false,
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
                let fullCmdStr = argv.join(" ");

                if (isAICommand(fullCmdStr) || isAICommand(this._commandTemplate) || isAICommand(text)) {
                  let promptText = isAICommand(text) ? text : fullCmdStr;
                  handleAICommandExecution(
                    promptText,
                    this._indicator ? this._indicator._cachedConfig : {},
                    () => {
                      if (
                        this._indicator &&
                        this._indicator.menu &&
                        typeof this._indicator.menu.close === "function"
                      ) {
                        this._indicator.menu.close();
                      }
                    }
                  );
                  return;
                }

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

/**
 * Helper function supporting wl-copy (Wayland) and xclip (X11) to copy text to clipboard.
 * @param {string} text
 * @returns {boolean}
 */
export function copyToClipboard(text) {
  if (text === null || text === undefined) {
    text = "";
  } else if (typeof text !== "string") {
    text = String(text);
  }

  // Native GNOME Shell St.Clipboard support if available
  try {
    if (typeof St !== "undefined" && St && St.Clipboard && St.ClipboardType) {
      let clipboard = St.Clipboard.get_default();
      if (clipboard) {
        clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
      }
    }
  } catch (e) {
    console.warn(`CmdBar: St.Clipboard error: ${e.message}`);
  }

  let isWayland = false;
  try {
    let waylandDisplay = GLib.getenv("WAYLAND_DISPLAY");
    let sessionType = GLib.getenv("XDG_SESSION_TYPE");
    if (
      waylandDisplay ||
      (sessionType && sessionType.toLowerCase() === "wayland")
    ) {
      isWayland = true;
    }
  } catch (e) {}

  let tools = isWayland
    ? [
        ["wl-copy"],
        ["xclip", "-selection", "clipboard"],
      ]
    : [
        ["xclip", "-selection", "clipboard"],
        ["wl-copy"],
      ];

  let success = false;
  for (let argv of tools) {
    try {
      let proc = Gio.Subprocess.new(
        argv,
        Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
      );
      proc.communicate_utf8_async(text, null, (subprocess, result) => {
        try {
          subprocess.communicate_utf8_finish(result);
        } catch (err) {}
      });
      success = true;
      break;
    } catch (e) {
      continue;
    }
  }
  return success;
}

/**
 * Helper function supporting pasting clipboard text.
 * @param {string} text
 * @returns {boolean}
 */
export function pasteClipboardText(text) {
  copyToClipboard(text);

  let isWayland = false;
  try {
    let waylandDisplay = GLib.getenv("WAYLAND_DISPLAY");
    let sessionType = GLib.getenv("XDG_SESSION_TYPE");
    if (
      waylandDisplay ||
      (sessionType && sessionType.toLowerCase() === "wayland")
    ) {
      isWayland = true;
    }
  } catch (e) {}

  let commands = isWayland
    ? [
        ["wtype", "-M", "ctrl", "v"],
        ["ydotool", "key", "29:1", "47:1", "47:0", "29:0"],
        ["xdotool", "key", "ctrl+v"],
      ]
    : [
        ["xdotool", "key", "--clearmodifiers", "ctrl+v"],
        ["xdotool", "type", text],
        ["xte", "kd Control_L", "k v", "ku Control_L"],
      ];

  let success = false;
  for (let argv of commands) {
    try {
      let proc = Gio.Subprocess.new(
        argv,
        Gio.SubprocessFlags.NONE,
      );
      proc.communicate_utf8_async(null, null, (subprocess, result) => {
        try {
          subprocess.communicate_utf8_finish(result);
        } catch (err) {}
      });
      success = true;
      break;
    } catch (e) {
      continue;
    }
  }
  return success;
}

// Standard menu item for parameterless or parameter-prompting commands
const CommandMenuItem = GObject.registerClass(
  class CommandMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(indicator, commandName, commandTemplate, cmdObj) {
      super._init({
        reactive: true,
        activate: false,
      });

      this._indicator = indicator;
      this._commandName = commandName;
      this._commandTemplate = commandTemplate;
      this._cmdObj = cmdObj || {};

      this.box = new St.BoxLayout({
        vertical: false,
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

      // Copy Button
      this.copyButton = new St.Button({
        child: new St.Icon({
          icon_name: "edit-copy-symbolic",
          style_class: "popup-menu-icon",
        }),
        style: "padding: 4px 6px; margin-right: 4px; border-radius: 4px;",
        track_hover: true,
        can_focus: true,
      });

      this.copyButton.connect("clicked", () => {
        let commandString = "";
        if (Array.isArray(this._commandTemplate)) {
          commandString = this._commandTemplate.join(" ");
        } else if (typeof this._commandTemplate === "string") {
          commandString = this._commandTemplate;
        } else if (this._commandTemplate) {
          commandString = String(this._commandTemplate);
        }

        copyToClipboard(commandString);

        if (
          this._indicator &&
          this._indicator.menu &&
          typeof this._indicator.menu.close === "function"
        ) {
          this._indicator.menu.close();
        }
      });
      this.box.add_child(this.copyButton);

      // Execute Button
      this.executeButton = new St.Button({
        child: new St.Icon({
          icon_name: "media-playback-start-symbolic",
          style_class: "popup-menu-icon",
        }),
        style: "padding: 4px 6px; border-radius: 4px;",
        track_hover: true,
        can_focus: true,
      });

      this.executeButton.connect("clicked", () => {
        runCommandAsync(this._commandName, this._commandTemplate, this._cmdObj);
        if (
          this._indicator &&
          this._indicator.menu &&
          typeof this._indicator.menu.close === "function"
        ) {
          this._indicator.menu.close();
        }
      });
      this.box.add_child(this.executeButton);

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
        vertical: false,
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

// CategoryCache for category-level command caching
export class CategoryCache {
  /**
   * Initializes category cache data structure.
   */
  constructor() {
    // In-memory cache for category commands
    this._cache = new Map();
    // In-memory map for category loading states
    this._loading = new Map();
  }

  /**
   * Checks if category exists in cache.
   * @param {string} categoryName
   * @returns {boolean}
   */
  has(categoryName) {
    return this._cache.has(categoryName);
  }

  /**
   * Retrieves category commands from cache.
   * @param {string} categoryName
   * @returns {Array<object>|undefined}
   */
  get(categoryName) {
    return this._cache.get(categoryName);
  }

  /**
   * Sets category commands in cache.
   * @param {string} categoryName
   * @param {Array<object>} commands
   */
  set(categoryName, commands) {
    this._cache.set(categoryName, commands || []);
  }

  /**
   * Clears category cache.
   */
  clear() {
    this._cache.clear();
    this._loading.clear();
  }

  /**
   * Returns whether category is currently loading.
   * @param {string} categoryName
   * @returns {boolean}
   */
  isLoading(categoryName) {
    return this._loading.get(categoryName) === true;
  }

  /**
   * Sets loading state for category.
   * @param {string} categoryName
   * @param {boolean} state
   */
  setLoading(categoryName, state) {
    this._loading.set(categoryName, state === true);
  }
}

// Progressive loading indicator menu item
export const ProgressiveLoadingMenuItem = GObject.registerClass(
  class ProgressiveLoadingMenuItem extends PopupMenu.PopupBaseMenuItem {
    /**
     * @param {string} [message="Loading category commands..."]
     */
    _init(message = "Loading category commands...") {
      super._init({
        reactive: false,
        activate: false,
      });

      // Box layout container for progressive loading indicator
      this.box = new St.BoxLayout({
        vertical: false,
        style_class: "cmdbar-loading-indicator",
        x_expand: true,
        style: "padding: 6px 12px;",
      });

      // Loading spinner icon
      this.spinner = new St.Icon({
        icon_name: "process-working-symbolic",
        style_class: "popup-menu-icon cmdbar-loading-spinner",
        style: "margin-right: 8px; color: #3584e4;",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this.box.add_child(this.spinner);

      // Label showing loading status message
      this.label = new St.Label({
        text: message,
        style: "font-size: 0.9em; color: #888888; font-style: italic;",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this.box.add_child(this.label);

      this.add_child(this.box);
    }

    /**
     * Updates progressive status message.
     * @param {string} text
     */
    setMessage(text) {
      if (this.label) {
        this.label.text = text || "";
      }
    }
  }
);

// Menu item for triggering next page chunk in virtual list
export const LoadMoreMenuItem = GObject.registerClass(
  class LoadMoreMenuItem extends PopupMenu.PopupBaseMenuItem {
    /**
     * @param {string} labelText
     * @param {function} onClick
     */
    _init(labelText, onClick) {
      super._init({
        reactive: true,
        activate: false,
      });

      this._onClick = onClick;

      // Box layout for load more item
      this.box = new St.BoxLayout({
        vertical: false,
        style_class: "cmdbar-load-more-item",
        x_expand: true,
        style: "padding: 6px 12px;",
      });

      // Arrow down icon
      this.icon = new St.Icon({
        icon_name: "go-down-symbolic",
        style_class: "popup-menu-icon",
        style: "margin-right: 8px; color: #3584e4;",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this.box.add_child(this.icon);

      // Label for load more action
      this.label = new St.Label({
        text: labelText || "Load More...",
        style: "font-weight: bold; color: #3584e4; font-size: 0.9em;",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this.box.add_child(this.label);

      this.add_child(this.box);

      // Connect activate signal for load more
      this._activateId = this.connect("activate", () => {
        if (typeof this._onClick === "function") {
          this._onClick();
        }
      });
    }

    /**
     * Clean up activate signal listener.
     */
    destroy() {
      if (this._activateId) {
        this.disconnect(this._activateId);
        this._activateId = 0;
      }
      super.destroy();
    }
  }
);

// VirtualListWidget for paginated/virtual list rendering
export class VirtualListWidget {
  /**
   * @param {object} [options]
   */
  constructor(options = {}) {
    // Page size chunk count
    this.pageSize = options.pageSize || 20;
    // Total items array
    this.items = [];
    // Currently rendered item count
    this.renderedCount = 0;
    // Container widget or menu
    this.container = options.container || null;
    // Item renderer callback
    this.renderItem = options.renderItem || ((item) => item);
    // Progress callback
    this.onProgress = options.onProgress || null;
    // Reference to active LoadMoreMenuItem widget
    this.loadMoreItem = null;
  }

  /**
   * Set total items list.
   * @param {Array} items
   */
  setItems(items) {
    this.items = items || [];
    this.renderedCount = 0;
  }

  /**
   * Clear virtual list items and state.
   */
  clear() {
    this.items = [];
    this.renderedCount = 0;
    if (this.loadMoreItem) {
      try {
        if (typeof this.loadMoreItem.destroy === "function") {
          this.loadMoreItem.destroy();
        }
      } catch (e) {}
      this.loadMoreItem = null;
    }
  }

  /**
   * Render initial page window.
   * @param {object} [targetMenu]
   * @returns {Array}
   */
  renderInitialPage(targetMenu) {
    const menu = targetMenu || this.container;
    this.renderedCount = 0;
    return this.renderNextChunk(menu);
  }

  /**
   * Render next chunk page slice.
   * @param {object} [targetMenu]
   * @returns {Array}
   */
  renderNextChunk(targetMenu) {
    const menu = targetMenu || this.container;
    if (!menu) return [];

    // Remove existing loadMoreItem before adding next page chunk
    if (this.loadMoreItem) {
      try {
        if (typeof this.loadMoreItem.destroy === "function") {
          this.loadMoreItem.destroy();
        }
      } catch (e) {}
      this.loadMoreItem = null;
    }

    const start = this.renderedCount;
    const end = Math.min(start + this.pageSize, this.items.length);
    const chunk = this.items.slice(start, end);

    const createdWidgets = [];
    for (const item of chunk) {
      const widget = this.renderItem(item);
      if (widget) {
        if (typeof menu.addMenuItem === "function") {
          menu.addMenuItem(widget);
        } else if (typeof menu.add_child === "function") {
          menu.add_child(widget);
        }
        createdWidgets.push(widget);
      }
    }

    this.renderedCount = end;

    // Append load more item if remaining items exist
    if (this.renderedCount < this.items.length) {
      const remaining = this.items.length - this.renderedCount;
      this.loadMoreItem = new LoadMoreMenuItem(
        `Load More (${remaining} remaining)...`,
        () => {
          this.renderNextChunk(menu);
        }
      );
      if (typeof menu.addMenuItem === "function") {
        menu.addMenuItem(this.loadMoreItem);
      } else if (typeof menu.add_child === "function") {
        menu.add_child(this.loadMoreItem);
      }
    }

    if (typeof this.onProgress === "function") {
      this.onProgress(this.renderedCount, this.items.length);
    }

    return createdWidgets;
  }

  /**
   * Returns whether additional items remain to be rendered.
   * @returns {boolean}
   */
  hasMore() {
    return this.renderedCount < this.items.length;
  }
}

// Expandable category header for lazy loading
export const LazyCategoryHeaderMenuItem = GObject.registerClass(
  class LazyCategoryHeaderMenuItem extends PopupMenu.PopupBaseMenuItem {
    /**
     * @param {object} indicator
     * @param {object} category
     * @param {CategoryCache} categoryCache
     * @param {object} [options]
     */
    _init(indicator, category, categoryCache, options = {}) {
      super._init({
        reactive: true,
        activate: false,
      });

      this._indicator = indicator;
      this._category = category || {};
      this._categoryName = this._category.name || "Category";
      this._categoryCache = categoryCache;
      this._expanded = false;
      this._childMenuItems = [];
      this._virtualList = null;
      this._pageSize = options.pageSize || 20;

      // Header container box
      this.box = new St.BoxLayout({
        vertical: false,
        style_class: "cmdbar-category-header cmdbar-lazy-category",
        x_expand: true,
      });

      // Expand/collapse indicator icon
      this.expandIcon = new St.Icon({
        icon_name: "pan-end-symbolic",
        style_class: "popup-menu-icon cmdbar-expand-icon",
        style: "margin-right: 6px;",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this.box.add_child(this.expandIcon);

      // Category icon
      this.icon = new St.Icon({
        icon_name: this._category.icon || "folder-symbolic",
        style_class: "popup-menu-icon",
        style: "margin-right: 8px;",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this.box.add_child(this.icon);

      // Command count label
      let cmdCount = Array.isArray(this._category.commands)
        ? this._category.commands.length
        : 0;
      this.label = new St.Label({
        text: `${this._categoryName} (${cmdCount})`,
        style: "font-weight: bold; color: #888888; font-size: 0.95em;",
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
      });
      this.box.add_child(this.label);

      this.add_child(this.box);

      // Connect activation event to toggle expansion
      this._activateId = this.connect("activate", () => {
        this.toggle();
      });
    }

    /**
     * Check if category is expanded.
     * @returns {boolean}
     */
    get isExpanded() {
      return this._expanded;
    }

    /**
     * Toggle expand/collapse state.
     */
    async toggle() {
      if (this._expanded) {
        this.collapse();
      } else {
        await this.expand();
      }
    }

    /**
     * Collapse category and remove rendered items.
     */
    collapse() {
      if (!this._expanded) return;
      this._expanded = false;
      if (this.expandIcon) {
        this.expandIcon.icon_name = "pan-end-symbolic";
      }
      this._clearChildMenuItems();
    }

    /**
     * Clear rendered child menu items.
     */
    _clearChildMenuItems() {
      for (let item of this._childMenuItems) {
        if (item && typeof item.destroy === "function") {
          try {
            item.destroy();
          } catch (e) {}
        }
      }
      this._childMenuItems = [];
      if (this._virtualList) {
        this._virtualList.clear();
      }
    }

    /**
     * Expand category and lazy load command items.
     */
    async expand() {
      if (this._expanded) return;
      this._expanded = true;
      if (this.expandIcon) {
        this.expandIcon.icon_name = "pan-down-symbolic";
      }

      let commands = null;
      if (this._categoryCache && this._categoryCache.has(this._categoryName)) {
        commands = this._categoryCache.get(this._categoryName);
      } else {
        if (this._categoryCache) {
          this._categoryCache.setLoading(this._categoryName, true);
        }

        // Show progressive loading indicator item
        const loadingItem = new ProgressiveLoadingMenuItem(
          `Loading ${this._categoryName} commands...`
        );
        this._insertChildMenuItem(loadingItem);

        commands = await this._loadCategoryCommandsAsync(this._category);

        if (this._categoryCache) {
          this._categoryCache.set(this._categoryName, commands);
          this._categoryCache.setLoading(this._categoryName, false);
        }

        loadingItem.destroy();
        const idx = this._childMenuItems.indexOf(loadingItem);
        if (idx !== -1) {
          this._childMenuItems.splice(idx, 1);
        }
      }

      this._renderCommands(commands);
    }

    /**
     * Async loader for category commands.
     * @param {object} category
     * @returns {Promise<Array>}
     */
    async _loadCategoryCommandsAsync(category) {
      return new Promise((resolve) => {
        if (typeof GLib !== "undefined" && GLib && typeof GLib.timeout_add === "function") {
          GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1, () => {
            resolve(category.commands || []);
            return false;
          });
        } else {
          setTimeout(() => {
            resolve(category.commands || []);
          }, 1);
        }
      });
    }

    /**
     * Render category commands using VirtualListWidget.
     * @param {Array} commands
     */
    _renderCommands(commands) {
      if (!commands || commands.length === 0) {
        const emptyItem = new PopupMenu.PopupMenuItem("No commands in category", {
          reactive: false,
        });
        this._insertChildMenuItem(emptyItem);
        return;
      }

      this._virtualList = new VirtualListWidget({
        pageSize: this._pageSize,
        renderItem: (cmd) => this._createCommandMenuItem(cmd),
      });

      this._virtualList.setItems(commands);

      this._virtualList.renderInitialPage({
        addMenuItem: (item) => {
          this._insertChildMenuItem(item);
        },
      });
    }

    /**
     * Insert child item into menu.
     * @param {object} item
     */
    _insertChildMenuItem(item) {
      const menu = this._indicator ? this._indicator.menu : null;
      if (menu && typeof menu.addMenuItem === "function") {
        menu.addMenuItem(item);
      }
      this._childMenuItems.push(item);
    }

    /**
     * Create command menu item widget.
     * @param {object} cmd
     * @returns {object}
     */
    _createCommandMenuItem(cmd) {
      if (hasPlaceholder(cmd.command)) {
        return new CommandInputMenuItem(
          this._indicator,
          cmd.name,
          cmd.command,
          cmd.placeholder,
          cmd
        );
      } else {
        return new CommandMenuItem(
          this._indicator,
          cmd.name,
          cmd.command,
          cmd
        );
      }
    }

    /**
     * Clean up resources on destroy.
     */
    destroy() {
      if (this._activateId) {
        this.disconnect(this._activateId);
        this._activateId = 0;
      }
      this._clearChildMenuItems();
      super.destroy();
    }
  }
);

// Search entry menu item for fast filtering across 100+ commands
export const SearchMenuItem = GObject.registerClass(
  class SearchMenuItem extends PopupMenu.PopupBaseMenuItem {
    /**
     * @param {function} onSearchCallback
     */
    _init(onSearchCallback) {
      super._init({
        reactive: false,
        activate: false,
      });

      this._onSearch = onSearchCallback;

      // Container box for search entry
      this.box = new St.BoxLayout({
        vertical: false,
        style: "padding: 6px 12px;",
        x_expand: true,
      });

      // Search icon
      this.icon = new St.Icon({
        icon_name: "edit-find-symbolic",
        style_class: "popup-menu-icon",
        style: "margin-right: 8px;",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this.box.add_child(this.icon);

      // Search entry input
      this.entry = new St.Entry({
        hint_text: "Search commands...",
        style_class: "cmdbar-search-entry",
        can_focus: true,
        x_expand: true,
      });

      // Connect text-changed signal
      this._textChangedId = 0;
      if (this.entry.clutter_text && typeof this.entry.clutter_text.connect === "function") {
        this._textChangedId = this.entry.clutter_text.connect("text-changed", () => {
          let text = this.getSearchText();
          if (typeof this._onSearch === "function") {
            this._onSearch(text);
          }
        });
      } else if (typeof this.entry.connect === "function") {
        this._textChangedId = this.entry.connect("changed", () => {
          let text = this.getSearchText();
          if (typeof this._onSearch === "function") {
            this._onSearch(text);
          }
        });
      }

      this.box.add_child(this.entry);
      this.add_child(this.box);
    }

    /**
     * Sets search entry text.
     * @param {string} text
     */
    setSearchText(text) {
      if (this.entry) {
        if (typeof this.entry.set_text === "function") {
          this.entry.set_text(text || "");
        } else {
          this.entry.text = text || "";
        }
      }
    }

    /**
     * Gets current search entry text.
     * @returns {string}
     */
    getSearchText() {
      if (!this.entry) return "";
      return typeof this.entry.get_text === "function"
        ? this.entry.get_text()
        : this.entry.text || "";
    }
  }
);

// Menu item for group/category headers
export const CategoryHeaderMenuItem = GObject.registerClass(
  class CategoryHeaderMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(categoryName) {
      super._init({
        reactive: false,
        activate: false,
      });

      this.box = new St.BoxLayout({
        vertical: false,
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
      this._categoryCache = new CategoryCache();
      this._virtualList = new VirtualListWidget({ pageSize: 20 });

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

    /**
     * Reload configuration and build menu with lazy loading and virtual scrolling.
     */
    async _reloadMenu() {
      try {
        let configPath = this._getConfigPath();
        let extensionPath = this._extension && this._extension.dir ? this._extension.dir.get_path() : "";
        let config = await loadConfig(configPath, extensionPath);
        this._cachedConfig = config;

        if (config && config._isInvalid) {
          this._showNotification(
            "CmdBar Configuration Error",
            "Invalid configuration file detected. Using in-memory default settings without overwriting your file.",
          );
        }

        // Reset category cache on config reload
        if (this._categoryCache) {
          this._categoryCache.clear();
        } else {
          this._categoryCache = new CategoryCache();
        }

        // Clear all current items in menu
        this.menu.removeAll();

        if (!config || !config.categories || config.categories.length === 0) {
          let infoItem = new PopupMenu.PopupMenuItem("No commands configured");
          this.menu.addMenuItem(infoItem);
          return;
        }

        let settings = this._extension ? this._extension._settings : null;
        let lazyLoad = true;
        let pageSize = 20;
        try {
          if (settings) {
            if (typeof settings.get_boolean === "function") {
              lazyLoad = settings.get_boolean("lazy-load-categories");
            }
            if (typeof settings.get_int === "function") {
              pageSize = settings.get_int("virtual-page-size") || 20;
            }
          }
        } catch (e) {}

        // Add Search / Filter entry item at top of menu
        const searchItem = new SearchMenuItem((filterText) => {
          this._handleMenuFilter(filterText, config, pageSize);
        });
        this.menu.addMenuItem(searchItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._renderCategoryList(config.categories, lazyLoad, pageSize);
      } catch (e) {
        console.error(`CmdBar: error reloading menu: ${e.message}`);
      }
    }

    /**
     * Render category list (lazy loaded or eager).
     * @param {Array} categories
     * @param {boolean} lazyLoad
     * @param {number} pageSize
     */
    _renderCategoryList(categories, lazyLoad, pageSize) {
      if (!categories || categories.length === 0) return;

      if (lazyLoad) {
        // Render lazy category headers
        categories.forEach((category) => {
          let lazyHeader = new LazyCategoryHeaderMenuItem(
            this,
            category,
            this._categoryCache,
            { pageSize }
          );
          this.menu.addMenuItem(lazyHeader);
        });
      } else {
        // Eager loading mode fallback
        categories.forEach((category, catIndex) => {
          if (catIndex > 0) {
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
          }
          this.menu.addMenuItem(new CategoryHeaderMenuItem(category.name));

          if (category.commands && Array.isArray(category.commands)) {
            category.commands.forEach((cmd) => {
              if (hasPlaceholder(cmd.command)) {
                this.menu.addMenuItem(
                  new CommandInputMenuItem(
                    this,
                    cmd.name,
                    cmd.command,
                    cmd.placeholder,
                    cmd,
                  )
                );
              } else {
                this.menu.addMenuItem(
                  new CommandMenuItem(this, cmd.name, cmd.command, cmd)
                );
              }
            });
          }
        });
      }
    }

    /**
     * Filter commands across 100+ items and display virtual list.
     * @param {string} filterText
     * @param {object} config
     * @param {number} [pageSize=20]
     */
    _handleMenuFilter(filterText, config, pageSize = 20) {
      const query = (filterText || "").trim();

      if (!query) {
        this._reloadMenu();
        return;
      }

      let allCommands = [];
      if (config && config.categories) {
        config.categories.forEach((cat) => {
          let cmds = cat.commands || [];
          if (this._categoryCache && !this._categoryCache.has(cat.name)) {
            this._categoryCache.set(cat.name, cmds);
          }
          cmds.forEach((c) => {
            allCommands.push({ ...c, categoryName: cat.name });
          });
        });
      }

      const ranked = rankCommands(allCommands, query);
      const matchedCmds = ranked.map((r) => r.command);

      this.menu.removeAll();

      const searchItem = new SearchMenuItem((txt) => {
        this._handleMenuFilter(txt, config, pageSize);
      });
      searchItem.setSearchText(query);
      this.menu.addMenuItem(searchItem);
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      if (matchedCmds.length === 0) {
        this.menu.addMenuItem(
          new PopupMenu.PopupMenuItem(`No commands matching "${query}"`, { reactive: false })
        );
        return;
      }

      let headerItem = new PopupMenu.PopupMenuItem(
        `Search Results (${matchedCmds.length} matches)`,
        { reactive: false }
      );
      if (headerItem.label && headerItem.label.style) {
        headerItem.label.style = "font-weight: bold; color: #888888; font-size: 0.9em;";
      }
      this.menu.addMenuItem(headerItem);

      this._virtualList = new VirtualListWidget({
        pageSize,
        container: this.menu,
        renderItem: (cmd) => {
          if (hasPlaceholder(cmd.command)) {
            return new CommandInputMenuItem(
              this,
              cmd.name,
              cmd.command,
              cmd.placeholder,
              cmd
            );
          } else {
            return new CommandMenuItem(
              this,
              cmd.name,
              cmd.command,
              cmd
            );
          }
        },
      });

      this._virtualList.setItems(matchedCmds);
      this._virtualList.renderInitialPage(this.menu);
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
