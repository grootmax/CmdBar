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
    <method name="TriggerNumpadKey">
      <arg name="key" type="i" direction="in"/>
      <arg name="success" type="b" direction="out"/>
      <arg name="command_name" type="s" direction="out"/>
    </method>
    <method name="SwitchNumpadLayer">
      <arg name="layer" type="s" direction="in"/>
      <arg name="success" type="b" direction="out"/>
      <arg name="active_layer" type="i" direction="out"/>
    </method>
    <method name="ToggleNumpadOverlay">
      <arg name="visible" type="b" direction="out"/>
    </method>
    <method name="GetNumpadConfig">
      <arg name="json_config" type="s" direction="out"/>
    </method>
    <method name="SetNumpadConfig">
      <arg name="json_config" type="s" direction="in"/>
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
    <signal name="NumpadLayerChanged">
      <arg name="active_layer" type="i"/>
      <arg name="layer_name" type="s"/>
    </signal>
    <signal name="NumpadCommandTriggered">
      <arg name="key" type="i"/>
      <arg name="name" type="s"/>
      <arg name="command" type="s"/>
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

  async TriggerNumpadKey(key) {
    const keyDigit = parseInt(key, 10);
    if (isNaN(keyDigit) || keyDigit < 0 || keyDigit > 9) return [false, "Invalid key digit"];

    try {
      if (this._indicator && this._indicator._numpadManager) {
        const res = this._indicator._numpadManager.triggerKey(keyDigit);
        if (res.success) {
          this.emitNumpadCommandTriggered(keyDigit, res.name, res.command);
          return [true, res.name];
        }
        return [false, res.reason || "Unbound key"];
      }

      const configPath = this._indicator && typeof this._indicator._getConfigPath === "function"
        ? this._indicator._getConfigPath()
        : await getDefaultConfigPath();
      const config = await loadConfig(configPath);
      const np = config.numpad || {};
      const layers = np.layers || [];
      const activeIdx = typeof np.active_layer === "number" ? np.active_layer : 0;
      const layer = layers[activeIdx] || layers[0];
      if (layer && layer.bindings && layer.bindings[String(keyDigit)]) {
        const binding = layer.bindings[String(keyDigit)];
        const name = binding.name || `Numpad Key ${keyDigit}`;
        const cmd = binding.command || binding.template || "";
        if (cmd) {
          if (this._indicator && typeof this._indicator.executeCommand === "function") {
            this._indicator.executeCommand(name, cmd, {}, binding);
          }
          this.emitNumpadCommandTriggered(keyDigit, name, cmd);
          return [true, name];
        }
      }
      return [false, "Unbound key"];
    } catch (e) {
      console.error(`CmdBar D-Bus TriggerNumpadKey error: ${e.message}`);
      return [false, e.message];
    }
  }

  async SwitchNumpadLayer(layer) {
    try {
      let activeIdx = 0;
      let layerName = "";
      if (this._indicator && this._indicator._numpadManager) {
        activeIdx = this._indicator._numpadManager.switchLayer(layer);
        const activeLayer = this._indicator._numpadManager.getActiveLayer();
        layerName = activeLayer ? activeLayer.name : "";
      } else {
        const configPath = await getDefaultConfigPath();
        const config = await loadConfig(configPath);
        if (!config.numpad) config.numpad = { enabled: true, active_layer: 0, layers: [] };
        const layers = config.numpad.layers || [];
        if (layers.length > 0) {
          let idx = 0;
          if (!isNaN(parseInt(layer, 10))) {
            idx = parseInt(layer, 10) % layers.length;
          } else {
            const foundIdx = layers.findIndex((l) => l.id === layer || l.name === layer);
            if (foundIdx !== -1) idx = foundIdx;
          }
          config.numpad.active_layer = idx;
          activeIdx = idx;
          layerName = layers[idx].name;
          await saveConfig(config, configPath);
        }
      }

      this.emitNumpadLayerChanged(activeIdx, layerName);
      return [true, activeIdx];
    } catch (e) {
      console.error(`CmdBar D-Bus SwitchNumpadLayer error: ${e.message}`);
      return [false, 0];
    }
  }

  async ToggleNumpadOverlay() {
    try {
      if (this._indicator && this._indicator._numpadManager) {
        return this._indicator._numpadManager.toggleOverlay();
      }
      return false;
    } catch (e) {
      console.error(`CmdBar D-Bus ToggleNumpadOverlay error: ${e.message}`);
      return false;
    }
  }

  async GetNumpadConfig() {
    try {
      if (this._indicator && this._indicator._numpadManager) {
        return JSON.stringify(this._indicator._numpadManager.getNumpadConfig());
      }
      const configPath = await getDefaultConfigPath();
      const config = await loadConfig(configPath);
      return JSON.stringify(config.numpad || {});
    } catch (e) {
      console.error(`CmdBar D-Bus GetNumpadConfig error: ${e.message}`);
      return JSON.stringify({});
    }
  }

  async SetNumpadConfig(jsonConfig) {
    try {
      const parsed = JSON.parse(jsonConfig);
      const configPath = this._indicator && typeof this._indicator._getConfigPath === "function"
        ? this._indicator._getConfigPath()
        : await getDefaultConfigPath();
      const config = await loadConfig(configPath);
      config.numpad = parsed;
      await saveConfig(config, configPath);

      if (this._indicator && this._indicator._numpadManager) {
        this._indicator._numpadManager.setConfig(config);
      }
      return true;
    } catch (e) {
      console.error(`CmdBar D-Bus SetNumpadConfig error: ${e.message}`);
      return false;
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

  emitNumpadLayerChanged(activeLayer, layerName) {
    if (this._dbusImpl && GLib) {
      try {
        this._dbusImpl.emit_signal(
          "NumpadLayerChanged",
          new GLib.Variant("(is)", [activeLayer || 0, layerName || ""])
        );
      } catch (e) {
        console.error(`CmdBar D-Bus emitNumpadLayerChanged error: ${e.message}`);
      }
    }
  }

  emitNumpadCommandTriggered(key, name, command) {
    if (this._dbusImpl && GLib) {
      try {
        this._dbusImpl.emit_signal(
          "NumpadCommandTriggered",
          new GLib.Variant("(iss)", [key || 0, name || "", command || ""])
        );
      } catch (e) {
        console.error(`CmdBar D-Bus emitNumpadCommandTriggered error: ${e.message}`);
      }
    }
  }
}
