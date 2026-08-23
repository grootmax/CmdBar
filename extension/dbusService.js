import { loadConfig, saveConfig, getDefaultConfigPath } from "./configSync.js";
import { tokenizeCommand, evaluateCommandPolicy, grantApprovalOverride } from "./commandProcessor.js";

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
    <method name="EvaluatePolicy">
      <arg name="command" type="s" direction="in"/>
      <arg name="user" type="s" direction="in"/>
      <arg name="result_json" type="s" direction="out"/>
    </method>
    <method name="GrantOverride">
      <arg name="command" type="s" direction="in"/>
      <arg name="approver" type="s" direction="in"/>
      <arg name="expires_in_ms" type="x" direction="in"/>
      <arg name="success" type="b" direction="out"/>
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
  constructor(indicator) {
    this._indicator = indicator;
    this._dbusImpl = null;
    this._busNameId = 0;
  }

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

      const evalResult = evaluateCommandPolicy(
        cmdStr,
        null,
        config.policy || config.security_policy,
        config.overrides
      );

      if (!evalResult.allowed) {
        console.error(`CmdBar D-Bus ExecuteCommand blocked by policy: ${evalResult.reason}`);
        this.emitCommandOutput(cmdName, "", `Execution blocked by security policy: ${evalResult.reason}`);
        this.emitCommandExecuted(cmdName, 126, false);
        return false;
      }

      if (this._indicator && typeof this._indicator.executeCommand === "function") {
        this._indicator.executeCommand(cmdName, cmdStr, {}, foundCmd);
      }
      return true;
    } catch (e) {
      console.error(`CmdBar D-Bus ExecuteCommand error: ${e.message}`);
      return false;
    }
  }

  async EvaluatePolicy(command, user) {
    try {
      const configPath = this._indicator && typeof this._indicator._getConfigPath === "function"
        ? this._indicator._getConfigPath()
        : await getDefaultConfigPath();
      const config = await loadConfig(configPath);
      const userCtx = user ? { username: user } : null;
      const result = evaluateCommandPolicy(
        command,
        userCtx,
        config.policy || config.security_policy,
        config.overrides
      );
      return JSON.stringify(result);
    } catch (e) {
      return JSON.stringify({ allowed: false, error: e.message });
    }
  }

  async GrantOverride(command, approver, expiresInMs) {
    try {
      const configPath = this._indicator && typeof this._indicator._getConfigPath === "function"
        ? this._indicator._getConfigPath()
        : await getDefaultConfigPath();
      const config = await loadConfig(configPath);
      if (!config.overrides) config.overrides = {};
      const exp = Number(expiresInMs) || 3600000;
      grantApprovalOverride(config.overrides, command, approver || "admin", exp);
      await saveConfig(config, configPath);
      return true;
    } catch (e) {
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
