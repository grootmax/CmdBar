import { loadConfig, saveConfig, getDefaultConfigPath } from "./configSync.js";
import { tokenizeCommand } from "./commandProcessor.js";
import {
  TeamSharingService,
  exportCommandToUrl,
  parseShareUrl,
  ROLES,
} from "./teamSharing.js";

export const CMDBAR_DBUS_INTERFACE_XML = `
<node>
  <interface name="org.gnome.CmdBar">
    <method name="AddCommand">
      <arg name="name" type="s" direction="in"/>
      <arg name="command" type="s" direction="in"/>
      <arg name="category" type="s" direction="in"/>
      <arg name="success" type="b" direction="out"/>
    </method>
    <method name="RemoveCommand">
      <arg name="name" type="s" direction="in"/>
      <arg name="success" type="b" direction="out"/>
    </method>
    <method name="ExecuteCommand">
      <arg name="name" type="s" direction="in"/>
      <arg name="success" type="b" direction="out"/>
    </method>
    <method name="GetCommands">
      <arg name="json_commands" type="s" direction="out"/>
    </method>
    <method name="ShareCommandUrl">
      <arg name="command_json" type="s" direction="in"/>
      <arg name="url" type="s" direction="out"/>
    </method>
    <method name="ImportCommandFromUrl">
      <arg name="url" type="s" direction="in"/>
      <arg name="role" type="s" direction="in"/>
      <arg name="success" type="b" direction="out"/>
    </method>
    <method name="GetPendingApprovals">
      <arg name="json_approvals" type="s" direction="out"/>
    </method>
    <method name="ApproveCommand">
      <arg name="submission_id" type="s" direction="in"/>
      <arg name="reviewer_role" type="s" direction="in"/>
      <arg name="notes" type="s" direction="in"/>
      <arg name="success" type="b" direction="out"/>
    </method>
    <method name="RejectCommand">
      <arg name="submission_id" type="s" direction="in"/>
      <arg name="reviewer_role" type="s" direction="in"/>
      <arg name="reason" type="s" direction="in"/>
      <arg name="success" type="b" direction="out"/>
    </method>
    <method name="GetActivityFeed">
      <arg name="limit" type="i" direction="in"/>
      <arg name="json_feed" type="s" direction="out"/>
    </method>
    <method name="GetConfigHistory">
      <arg name="json_history" type="s" direction="out"/>
    </method>
    <signal name="CommandExecuted">
      <arg name="name" type="s"/>
      <arg name="exit_code" type="i"/>
      <arg name="success" type="b"/>
    </signal>
    <signal name="CommandOutput">
      <arg name="name" type="s"/>
      <arg name="stdout" type="s"/>
      <arg name="stderr" type="s"/>
    </signal>
  </interface>
</node>`;

let Gio, GLib;
try {
  const giModule = await import("gi");
  Gio = giModule.Gio || (giModule.default && giModule.default.Gio) || giModule.default;
  GLib = giModule.GLib || (giModule.default && giModule.default.GLib);
} catch (e) {}

export class CmdBarDBusService {
  /**
   * Initializes D-Bus service for CmdBar.
   * @param {object} [indicator] - Reference to indicator instance.
   */
  constructor(indicator) {
    this._indicator = indicator;
    this._dbusImpl = null;
    this._busNameId = 0;
    this._teamSharingService = new TeamSharingService({ baseDir: "/tmp/cmdbar-dbus-team" });
  }

  /**
   * Exports D-Bus service interface to session bus.
   * @returns {boolean} True if successfully exported.
   * @public
   */
  export() {
    if (!Gio || !Gio.DBusNodeInfo) return false;
    try {
      const nodeInfo = Gio.DBusNodeInfo.new_for_xml(CMDBAR_DBUS_INTERFACE_XML);
      const ifaceInfo = nodeInfo.interfaces[0];

      this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(ifaceInfo, this);
      this._dbusImpl.export(Gio.DBus.session, "/org/gnome/CmdBar");

      this._busNameId = Gio.bus_own_name(
        Gio.BusType.SESSION,
        "org.gnome.CmdBar",
        Gio.BusNameOwnerFlags.NONE,
        null,
        null,
        null
      );
      return true;
    } catch (e) {
      console.error(`CmdBar D-Bus export failed: ${e.message}`);
      return false;
    }
  }

  unexport() {
    if (this._busNameId && Gio) {
      try {
        Gio.bus_unown_name(this._busNameId);
      } catch (e) {}
      this._busNameId = 0;
    }
    if (this._dbusImpl) {
      try {
        this._dbusImpl.unexport();
      } catch (e) {}
      this._dbusImpl = null;
    }
  }

  async AddCommand(name, command, category) {
    if (!name || typeof name !== "string" || name.trim() === "") return false;
    if (!command || typeof command !== "string" || command.trim() === "") return false;

    const catName = (category && typeof category === "string" && category.trim())
      ? category.trim()
      : "External";

    try {
      const configPath = this._indicator && typeof this._indicator._getConfigPath === "function"
        ? this._indicator._getConfigPath()
        : await getDefaultConfigPath();
      const config = await loadConfig(configPath);
      if (!config.categories) config.categories = [];

      let catObj = config.categories.find((c) => c.name === catName);
      if (!catObj) {
        catObj = { name: catName, commands: [] };
        config.categories.push(catObj);
      }
      if (!catObj.commands) catObj.commands = [];

      const cleanName = name.trim();
      const cleanCmd = command.trim();

      const existingCmd = catObj.commands.find((c) => c.name === cleanName);
      if (existingCmd) {
        existingCmd.command = cleanCmd;
      } else {
        catObj.commands.push({ name: cleanName, command: cleanCmd });
      }

      await saveConfig(config, configPath);
      if (this._indicator && typeof this._indicator._reloadMenu === "function") {
        this._indicator._reloadMenu();
      }
      return true;
    } catch (e) {
      console.error(`CmdBar D-Bus AddCommand error: ${e.message}`);
      return false;
    }
  }

  async RemoveCommand(name) {
    if (!name || typeof name !== "string" || name.trim() === "") return false;
    const cleanName = name.trim();

    try {
      const configPath = this._indicator && typeof this._indicator._getConfigPath === "function"
        ? this._indicator._getConfigPath()
        : await getDefaultConfigPath();
      const config = await loadConfig(configPath);
      if (!config.categories) return false;

      let removed = false;
      config.categories.forEach((cat) => {
        if (cat.commands && Array.isArray(cat.commands)) {
          const initLen = cat.commands.length;
          cat.commands = cat.commands.filter((c) => c.name !== cleanName);
          if (cat.commands.length < initLen) removed = true;
        }
      });

      if (removed) {
        await saveConfig(config, configPath);
        if (this._indicator && typeof this._indicator._reloadMenu === "function") {
          this._indicator._reloadMenu();
        }
      }
      return removed;
    } catch (e) {
      console.error(`CmdBar D-Bus RemoveCommand error: ${e.message}`);
      return false;
    }
  }

  async ExecuteCommand(name) {
    if (!name || typeof name !== "string" || name.trim() === "") return false;
    const cleanName = name.trim();

    try {
      const configPath = this._indicator && typeof this._indicator._getConfigPath === "function"
        ? this._indicator._getConfigPath()
        : await getDefaultConfigPath();
      const config = await loadConfig(configPath);

      let foundCmd = null;
      if (config.categories) {
        for (const cat of config.categories) {
          if (cat.commands) {
            const match = cat.commands.find(
              (c) => c.name === cleanName || c.command === cleanName || c.template === cleanName
            );
            if (match) {
              foundCmd = match;
              break;
            }
          }
        }
      }

      const cmdName = foundCmd ? foundCmd.name : cleanName;
      const cmdStr = foundCmd ? (foundCmd.command || foundCmd.template) : cleanName;

      if (this._indicator && typeof this._indicator.executeCommand === "function") {
        this._indicator.executeCommand(cmdName, cmdStr, {}, foundCmd);
      }
      return true;
    } catch (e) {
      console.error(`CmdBar D-Bus ExecuteCommand error: ${e.message}`);
      return false;
    }
  }

  async GetCommands() {
    try {
      const configPath = this._indicator && typeof this._indicator._getConfigPath === "function"
        ? this._indicator._getConfigPath()
        : await getDefaultConfigPath();
      const config = await loadConfig(configPath);

      const allCmds = [];
      if (config.categories && Array.isArray(config.categories)) {
        config.categories.forEach((cat) => {
          if (cat.commands && Array.isArray(cat.commands)) {
            cat.commands.forEach((c) => {
              allCmds.push({
                name: c.name,
                command: c.command || c.template || "",
                category: cat.name,
                placeholder: c.placeholder || "",
                parameters: c.parameters || {},
              });
            });
          }
        });
      }
      return JSON.stringify(allCmds);
    } catch (e) {
      console.error(`CmdBar D-Bus GetCommands error: ${e.message}`);
      return JSON.stringify([]);
    }
  }

  /**
   * Shares a command JSON via URL string over D-Bus.
   * @param {string} commandJson - JSON string of command object.
   * @returns {Promise<string>} Share URL string.
   * @public
   */
  async ShareCommandUrl(commandJson) {
    try {
      const cmdObj = JSON.parse(commandJson);
      return exportCommandToUrl(cmdObj);
    } catch (e) {
      console.error(`CmdBar D-Bus ShareCommandUrl error: ${e.message}`);
      return "";
    }
  }

  /**
   * Imports a command from a share URL string over D-Bus.
   * @param {string} url - Share URL string.
   * @param {string} role - User role string.
   * @returns {Promise<boolean>} Success flag.
   * @public
   */
  async ImportCommandFromUrl(url, role) {
    try {
      const configPath = this._indicator && typeof this._indicator._getConfigPath === "function"
        ? this._indicator._getConfigPath()
        : await getDefaultConfigPath();
      const config = await loadConfig(configPath);
      const res = await this._teamSharingService.importFromUrl(url, config, role || ROLES.EDITOR);
      await saveConfig(res.config, configPath);
      if (this._indicator && typeof this._indicator._reloadMenu === "function") {
        this._indicator._reloadMenu();
      }
      return true;
    } catch (e) {
      console.error(`CmdBar D-Bus ImportCommandFromUrl error: ${e.message}`);
      return false;
    }
  }

  /**
   * Returns pending command approval submissions over D-Bus.
   * @returns {Promise<string>} JSON string of pending approvals.
   * @public
   */
  async GetPendingApprovals() {
    try {
      const pending = await this._teamSharingService.approvalWorkflow.getPendingSubmissions();
      return JSON.stringify(pending);
    } catch (e) {
      console.error(`CmdBar D-Bus GetPendingApprovals error: ${e.message}`);
      return JSON.stringify([]);
    }
  }

  /**
   * Approves a pending submission over D-Bus.
   * @param {string} submissionId - ID of submission to approve.
   * @param {string} reviewerRole - Role of reviewer.
   * @param {string} notes - Reviewer notes.
   * @returns {Promise<boolean>} Success flag.
   * @public
   */
  async ApproveCommand(submissionId, reviewerRole, notes) {
    try {
      const sub = await this._teamSharingService.approvalWorkflow.approveSubmission(
        submissionId,
        "dbus_admin",
        reviewerRole || ROLES.APPROVER,
        notes || ""
      );
      if (sub && sub.command) {
        const configPath = this._indicator && typeof this._indicator._getConfigPath === "function"
          ? this._indicator._getConfigPath()
          : await getDefaultConfigPath();
        const config = await loadConfig(configPath);
        const catName = sub.category || "Team Commands";
        let cat = config.categories.find((c) => c.name === catName);
        if (!cat) {
          cat = { name: catName, commands: [] };
          config.categories.push(cat);
        }
        cat.commands.push(sub.command);
        await saveConfig(config, configPath);
        if (this._indicator && typeof this._indicator._reloadMenu === "function") {
          this._indicator._reloadMenu();
        }
      }
      return true;
    } catch (e) {
      console.error(`CmdBar D-Bus ApproveCommand error: ${e.message}`);
      return false;
    }
  }

  /**
   * Rejects a pending submission over D-Bus.
   * @param {string} submissionId - ID of submission to reject.
   * @param {string} reviewerRole - Role of reviewer.
   * @param {string} reason - Rejection reason.
   * @returns {Promise<boolean>} Success flag.
   * @public
   */
  async RejectCommand(submissionId, reviewerRole, reason) {
    try {
      await this._teamSharingService.approvalWorkflow.rejectSubmission(
        submissionId,
        "dbus_admin",
        reviewerRole || ROLES.APPROVER,
        reason || ""
      );
      return true;
    } catch (e) {
      console.error(`CmdBar D-Bus RejectCommand error: ${e.message}`);
      return false;
    }
  }

  /**
   * Gets activity feed log over D-Bus.
   * @param {number} limit - Maximum number of activity records.
   * @returns {Promise<string>} JSON string of activity records.
   * @public
   */
  async GetActivityFeed(limit) {
    try {
      const feed = await this._teamSharingService.activityFeed.getActivityFeed({ limit: limit || 50 });
      return JSON.stringify(feed);
    } catch (e) {
      console.error(`CmdBar D-Bus GetActivityFeed error: ${e.message}`);
      return JSON.stringify([]);
    }
  }

  /**
   * Gets configuration revision history over D-Bus.
   * @returns {Promise<string>} JSON string of revision history.
   * @public
   */
  async GetConfigHistory() {
    try {
      const history = await this._teamSharingService.versionControl.getHistory();
      return JSON.stringify(history);
    } catch (e) {
      console.error(`CmdBar D-Bus GetConfigHistory error: ${e.message}`);
      return JSON.stringify([]);
    }
  }

  /**
   * Emits CommandExecuted signal.
   * @param {string} name - Command name.
   * @param {number} exitCode - Exit code.
   * @param {boolean} success - Success flag.
   * @public
   */
  emitCommandExecuted(name, exitCode, success) {
    if (this._dbusImpl && GLib) {
      try {
        this._dbusImpl.emit_signal(
          "CommandExecuted",
          new GLib.Variant("(sib)", [name || "", exitCode || 0, Boolean(success)])
        );
      } catch (e) {
        console.error(`CmdBar D-Bus emitCommandExecuted error: ${e.message}`);
      }
    }
  }

  emitCommandOutput(name, stdout, stderr) {
    if (this._dbusImpl && GLib) {
      try {
        this._dbusImpl.emit_signal(
          "CommandOutput",
          new GLib.Variant("(sss)", [name || "", stdout || "", stderr || ""])
        );
      } catch (e) {
        console.error(`CmdBar D-Bus emitCommandOutput error: ${e.message}`);
      }
    }
  }
}
