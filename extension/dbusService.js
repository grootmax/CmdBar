import { loadConfig, saveConfig, getDefaultConfigPath } from "./configSync.js";
import { tokenizeCommand } from "./commandProcessor.js";
import { EventTriggerManager } from "./eventTriggers.js";

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
    <method name="TriggerEvent">
      <arg name="event_type" type="s" direction="in"/>
      <arg name="payload_json" type="s" direction="in"/>
      <arg name="success" type="b" direction="out"/>
    </method>
    <method name="GetTriggers">
      <arg name="json_triggers" type="s" direction="out"/>
    </method>
    <method name="AddTrigger">
      <arg name="trigger_json" type="s" direction="in"/>
      <arg name="success" type="b" direction="out"/>
    </method>
    <method name="RemoveTrigger">
      <arg name="trigger_id" type="s" direction="in"/>
      <arg name="success" type="b" direction="out"/>
    </method>
    <signal name="EventTriggered">
      <arg name="trigger_id" type="s"/>
      <arg name="event_type" type="s"/>
      <arg name="command" type="s"/>
      <arg name="success" type="b"/>
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
    this._triggerManager = new EventTriggerManager();
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

  async TriggerEvent(eventType, payloadJson) {
    try {
      let payload = {};
      if (payloadJson && typeof payloadJson === "string") {
        try {
          payload = JSON.parse(payloadJson);
        } catch (e) {}
      }
      const executor = async (cmd, params) => {
        if (this._indicator && typeof this._indicator.executeCommand === "function") {
          return this._indicator.executeCommand(cmd, cmd, params);
        }
        return true;
      };

      const results = await this._triggerManager.processEvent(eventType, payload, executor);
      for (const res of results) {
        this.emitEventTriggered(res.trigger_id, eventType, res.command, res.success);
      }
      return true;
    } catch (e) {
      console.error(`CmdBar D-Bus TriggerEvent error: ${e.message}`);
      return false;
    }
  }

  async GetTriggers() {
    try {
      const triggers = this._triggerManager.getTriggers();
      return JSON.stringify(triggers);
    } catch (e) {
      console.error(`CmdBar D-Bus GetTriggers error: ${e.message}`);
      return JSON.stringify([]);
    }
  }

  async AddTrigger(triggerJson) {
    try {
      if (!triggerJson || typeof triggerJson !== "string") return false;
      const trigger = JSON.parse(triggerJson);
      return this._triggerManager.addTrigger(trigger);
    } catch (e) {
      console.error(`CmdBar D-Bus AddTrigger error: ${e.message}`);
      return false;
    }
  }

  async RemoveTrigger(triggerId) {
    try {
      if (!triggerId) return false;
      return this._triggerManager.removeTrigger(triggerId);
    } catch (e) {
      console.error(`CmdBar D-Bus RemoveTrigger error: ${e.message}`);
      return false;
    }
  }

  emitEventTriggered(triggerId, eventType, command, success) {
    if (this._dbusImpl && GLib) {
      try {
        this._dbusImpl.emit_signal(
          "EventTriggered",
          new GLib.Variant("(sssb)", [triggerId || "", eventType || "", command || "", Boolean(success)])
        );
      } catch (e) {
        console.error(`CmdBar D-Bus emitEventTriggered error: ${e.message}`);
      }
    }
  }
}
