import { loadConfig, saveConfig, getDefaultConfigPath } from "./configSync.js";
import { tokenizeCommand } from "./commandProcessor.js";

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
    <method name="ProcessMidiMessage">
      <arg name="type" type="s" direction="in"/>
      <arg name="channel" type="i" direction="in"/>
      <arg name="number" type="i" direction="in"/>
      <arg name="value" type="i" direction="in"/>
      <arg name="result_json" type="s" direction="out"/>
    </method>
    <method name="SetMidiPerformanceMode">
      <arg name="enabled" type="b" direction="in"/>
      <arg name="success" type="b" direction="out"/>
    </method>
    <method name="SwitchMidiBank">
      <arg name="bank" type="s" direction="in"/>
      <arg name="success" type="b" direction="out"/>
    </method>
    <method name="GetMidiMappings">
      <arg name="json_mappings" type="s" direction="out"/>
    </method>
    <method name="SetMidiLedFeedback">
      <arg name="enabled" type="b" direction="in"/>
      <arg name="success" type="b" direction="out"/>
    </method>
    <signal name="MidiMessageReceived">
      <arg name="type" type="s"/>
      <arg name="channel" type="i"/>
      <arg name="number" type="i"/>
      <arg name="value" type="i"/>
    </signal>
    <signal name="MidiBankSwitched">
      <arg name="bank" type="s"/>
    </signal>
    <signal name="MidiPerformanceModeToggled">
      <arg name="enabled" type="b"/>
    </signal>
    <signal name="MidiLedFeedbackSent">
      <arg name="type" type="s"/>
      <arg name="channel" type="i"/>
      <arg name="number" type="i"/>
      <arg name="value" type="i"/>
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

  async ProcessMidiMessage(type, channel, number, value) {
    try {
      this.emitMidiMessageReceived(type, channel, number, value);
      if (this._indicator && this._indicator._midiController) {
        const res = this._indicator._midiController.processMidiMessage(
          type,
          channel,
          number,
          value,
          (name, cmdStr, meta) => {
            if (typeof this._indicator.executeCommand === "function") {
              this._indicator.executeCommand(name, cmdStr, meta);
            }
          }
        );
        return JSON.stringify(res);
      }
      return JSON.stringify({ handled: false, reason: "MIDI controller not initialized" });
    } catch (e) {
      console.error(`CmdBar D-Bus ProcessMidiMessage error: ${e.message}`);
      return JSON.stringify({ handled: false, error: e.message });
    }
  }

  async SetMidiPerformanceMode(enabled) {
    try {
      if (this._indicator && this._indicator._midiController) {
        const ok = this._indicator._midiController.setPerformanceMode(Boolean(enabled));
        this.emitMidiPerformanceModeToggled(Boolean(enabled));
        return ok;
      }
      return false;
    } catch (e) {
      console.error(`CmdBar D-Bus SetMidiPerformanceMode error: ${e.message}`);
      return false;
    }
  }

  async SwitchMidiBank(bank) {
    try {
      if (this._indicator && this._indicator._midiController) {
        const ok = this._indicator._midiController.switchBank(bank);
        if (ok) this.emitMidiBankSwitched(bank);
        return ok;
      }
      return false;
    } catch (e) {
      console.error(`CmdBar D-Bus SwitchMidiBank error: ${e.message}`);
      return false;
    }
  }

  async GetMidiMappings() {
    try {
      if (this._indicator && this._indicator._midiController) {
        const cfg = this._indicator._midiController.getConfig();
        return JSON.stringify(cfg.mappings || []);
      }
      return JSON.stringify([]);
    } catch (e) {
      console.error(`CmdBar D-Bus GetMidiMappings error: ${e.message}`);
      return JSON.stringify([]);
    }
  }

  async SetMidiLedFeedback(enabled) {
    try {
      const configPath = this._indicator && typeof this._indicator._getConfigPath === "function"
        ? this._indicator._getConfigPath()
        : await getDefaultConfigPath();
      const config = await loadConfig(configPath);
      if (!config.midi) config.midi = {};
      config.midi.led_feedback = Boolean(enabled);
      await saveConfig(config, configPath);

      if (this._indicator && this._indicator._midiController) {
        this._indicator._midiController.updateConfig(config);
      }
      return true;
    } catch (e) {
      console.error(`CmdBar D-Bus SetMidiLedFeedback error: ${e.message}`);
      return false;
    }
  }

  emitMidiMessageReceived(type, channel, number, value) {
    if (this._dbusImpl && GLib) {
      try {
        this._dbusImpl.emit_signal(
          "MidiMessageReceived",
          new GLib.Variant("(siii)", [type || "", channel || 1, number || 0, value || 0])
        );
      } catch (e) {}
    }
  }

  emitMidiBankSwitched(bank) {
    if (this._dbusImpl && GLib) {
      try {
        this._dbusImpl.emit_signal(
          "MidiBankSwitched",
          new GLib.Variant("(s)", [bank || ""])
        );
      } catch (e) {}
    }
  }

  emitMidiPerformanceModeToggled(enabled) {
    if (this._dbusImpl && GLib) {
      try {
        this._dbusImpl.emit_signal(
          "MidiPerformanceModeToggled",
          new GLib.Variant("(b)", [Boolean(enabled)])
        );
      } catch (e) {}
    }
  }

  emitMidiLedFeedbackSent(type, channel, number, value) {
    if (this._dbusImpl && GLib) {
      try {
        this._dbusImpl.emit_signal(
          "MidiLedFeedbackSent",
          new GLib.Variant("(siii)", [type || "", channel || 1, number || 0, value || 0])
        );
      } catch (e) {}
    }
  }
}
