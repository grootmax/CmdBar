import { loadConfig, saveConfig, getDefaultConfigPath, validateBrandingConfig, getEffectiveBranding } from "./configSync.js";
import { tokenizeCommand } from "./commandProcessor.js";
import { SSOManager, PROVIDER_PRESETS } from "./ssoManager.js";
import {
  isSensitiveCommand,
  authenticateCommand,
  generateEmergencyCodes,
  verifyAndConsumeEmergencyCode,
} from "./yubikeyAuth.js";
import { EventTriggerManager } from "./eventTriggers.js";
import {
  exportEnvironmentSnapshot,
  importEnvironmentSnapshot,
  createBackup,
  listBackups,
  restoreFromBackup
} from "./environmentSnapshot.js";

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
    <method name="GetBranding">
      <arg name="json_branding" type="s" direction="out"/>
    </method>
    <method name="SetBranding">
      <arg name="json_branding" type="s" direction="in"/>
      <arg name="success" type="b" direction="out"/>
    </method>
    <method name="GetEffectiveAppName">
      <arg name="app_name" type="s" direction="out"/>
    </method>
    <method name="SSOLogin">
      <arg name="provider" type="s" direction="in"/>
      <arg name="protocol" type="s" direction="in"/>
      <arg name="credentials_json" type="s" direction="in"/>
      <arg name="response_json" type="s" direction="out"/>
    </method>
    <method name="SSOLogout">
      <arg name="session_id" type="s" direction="in"/>
      <arg name="success" type="b" direction="out"/>
    </method>
    <method name="GetSSOSession">
      <arg name="session_id" type="s" direction="in"/>
      <arg name="session_json" type="s" direction="out"/>
    </method>
    <method name="GetSSOProviders">
      <arg name="providers_json" type="s" direction="out"/>
    </method>
    <method name="ValidateSSOAccess">
      <arg name="session_id" type="s" direction="in"/>
      <arg name="category_name" type="s" direction="in"/>
      <arg name="allowed" type="b" direction="out"/>
    </method>
    <method name="GetResourceMetrics">
      <arg name="json_metrics" type="s" direction="out"/>
    </method>
    <method name="IsYubiKeyRequired">
      <arg name="name" type="s" direction="in"/>
      <arg name="required" type="b" direction="out"/>
    </method>
    <method name="AuthenticateYubiKey">
      <arg name="name" type="s" direction="in"/>
      <arg name="mode" type="s" direction="in"/>
      <arg name="credential" type="s" direction="in"/>
      <arg name="success" type="b" direction="out"/>
      <arg name="message" type="s" direction="out"/>
    </method>
    <method name="GenerateEmergencyCodes">
      <arg name="count" type="i" direction="in"/>
      <arg name="json_codes" type="s" direction="out"/>
    </method>
    <method name="VerifyEmergencyCode">
      <arg name="code" type="s" direction="in"/>
      <arg name="success" type="b" direction="out"/>
    </method>
    <method name="ExportSnapshot">
      <arg name="options_json" type="s" direction="in"/>
      <arg name="snapshot_json" type="s" direction="out"/>
    </method>
    <method name="ImportSnapshot">
      <arg name="snapshot_json" type="s" direction="in"/>
      <arg name="options_json" type="s" direction="in"/>
      <arg name="success" type="b" direction="out"/>
    </method>
    <method name="CreateBackup">
      <arg name="description" type="s" direction="in"/>
      <arg name="backup_path" type="s" direction="out"/>
    </method>
    <method name="RestoreBackup">
      <arg name="backup_path_or_id" type="s" direction="in"/>
      <arg name="success" type="b" direction="out"/>
    </method>
    <method name="ListBackups">
      <arg name="json_backups_list" type="s" direction="out"/>
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
    <signal name="SSOSessionStateChanged">
      <arg name="session_id" type="s"/>
      <arg name="state" type="s"/>
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
  Gio =
    giModule.Gio ||
    (giModule.default && giModule.default.Gio) ||
    giModule.default;
  GLib = giModule.GLib || (giModule.default && giModule.default.GLib);
} catch (e) {}

export class CmdBarDBusService {
  constructor(indicator) {
    this._indicator = indicator;
    this._dbusImpl = null;
    this._busNameId = 0;
    this._ssoManager = new SSOManager();
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
        null,
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
    if (!command || typeof command !== "string" || command.trim() === "")
      return false;

    const catName =
      category && typeof category === "string" && category.trim()
        ? category.trim()
        : "External";

    try {
      const configPath =
        this._indicator && typeof this._indicator._getConfigPath === "function"
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
      if (
        this._indicator &&
        typeof this._indicator._reloadMenu === "function"
      ) {
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
      const configPath =
        this._indicator && typeof this._indicator._getConfigPath === "function"
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
        if (
          this._indicator &&
          typeof this._indicator._reloadMenu === "function"
        ) {
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
      const configPath =
        this._indicator && typeof this._indicator._getConfigPath === "function"
          ? this._indicator._getConfigPath()
          : await getDefaultConfigPath();
      const config = await loadConfig(configPath);

      let foundCmd = null;
      if (config.categories) {
        for (const cat of config.categories) {
          if (cat.commands) {
            const match = cat.commands.find(
              (c) =>
                c.name === cleanName ||
                c.command === cleanName ||
                c.template === cleanName,
            );
            if (match) {
              foundCmd = match;
              break;
            }
          }
        }
      }

      const cmdName = foundCmd ? foundCmd.name : cleanName;
      const cmdStr = foundCmd
        ? foundCmd.command || foundCmd.template
        : cleanName;

      if (
        this._indicator &&
        typeof this._indicator.executeCommand === "function"
      ) {
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
      const configPath =
        this._indicator && typeof this._indicator._getConfigPath === "function"
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

  async GetBranding() {
    try {
      const configPath = this._indicator && typeof this._indicator._getConfigPath === "function"
        ? this._indicator._getConfigPath()
        : await getDefaultConfigPath();
      const config = await loadConfig(configPath);
      const branding = getEffectiveBranding(config);
      return JSON.stringify(branding);
    } catch (e) {
      console.error(`CmdBar D-Bus GetBranding error: ${e.message}`);
      return JSON.stringify({});
    }
  }

  async SetBranding(jsonBranding) {
    if (!jsonBranding || typeof jsonBranding !== "string" || jsonBranding.trim() === "") {
      return false;
    }
    try {
      const parsed = JSON.parse(jsonBranding);
      if (!validateBrandingConfig(parsed)) {
        return false;
      }
      const configPath = this._indicator && typeof this._indicator._getConfigPath === "function"
        ? this._indicator._getConfigPath()
        : await getDefaultConfigPath();
      const config = await loadConfig(configPath);
      config.branding = parsed;
      await saveConfig(config, configPath);
      if (this._indicator && typeof this._indicator._reloadMenu === "function") {
        this._indicator._reloadMenu();
      }
      return true;
    } catch (e) {
      console.error(`CmdBar D-Bus SetBranding error: ${e.message}`);
      return false;
    }
  }

  async IsYubiKeyRequired(name) {
    if (!name) return false;
    try {
      const configPath =
        this._indicator && typeof this._indicator._getConfigPath === "function"
          ? this._indicator._getConfigPath()
          : await getDefaultConfigPath();
      const config = await loadConfig(configPath);
      const cleanName = name.trim();
      let foundCmd = null;
      if (config.categories) {
        for (const cat of config.categories) {
          if (cat.commands) {
            const match = cat.commands.find(
              (c) =>
                c.name === cleanName ||
                c.command === cleanName ||
                c.template === cleanName,
            );
            if (match) {
              foundCmd = match;
              break;
            }
          }
        }
      }
      return isSensitiveCommand(foundCmd || cleanName, config.yubikey);
    } catch (e) {
      console.error(`CmdBar D-Bus IsYubiKeyRequired error: ${e.message}`);
      return false;
    }
  }

  async AuthenticateYubiKey(name, mode, credential) {
    try {
      const configPath =
        this._indicator && typeof this._indicator._getConfigPath === "function"
          ? this._indicator._getConfigPath()
          : await getDefaultConfigPath();
      const config = await loadConfig(configPath);
      const cleanName = (name || "").trim();
      let foundCmd = null;
      if (cleanName && config.categories) {
        for (const cat of config.categories) {
          if (cat.commands) {
            const match = cat.commands.find(
              (c) =>
                c.name === cleanName ||
                c.command === cleanName ||
                c.template === cleanName,
            );
            if (match) {
              foundCmd = match;
              break;
            }
          }
        }
      }
      const authPayload = { mode: mode || "touch" };
      if (mode === "otp") authPayload.otp = credential;
      else if (mode === "emergency") authPayload.emergencyCode = credential;

      const result = await authenticateCommand(
        foundCmd || cleanName,
        authPayload,
        config,
      );
      if (result.success && mode === "emergency") {
        await saveConfig(config, configPath);
      }
      return [result.success, result.message];
    } catch (e) {
      console.error(`CmdBar D-Bus AuthenticateYubiKey error: ${e.message}`);
      return [false, e.message];
    }
  }

  async GenerateEmergencyCodes(count) {
    try {
      const configPath =
        this._indicator && typeof this._indicator._getConfigPath === "function"
          ? this._indicator._getConfigPath()
          : await getDefaultConfigPath();
      const config = await loadConfig(configPath);
      const { rawCodes, hashedCodes } = await generateEmergencyCodes(
        count || 5,
      );
      if (!config.yubikey) config.yubikey = {};
      config.yubikey.emergency_codes = hashedCodes;
      await saveConfig(config, configPath);
      return JSON.stringify(rawCodes);
    } catch (e) {
      console.error(`CmdBar D-Bus GenerateEmergencyCodes error: ${e.message}`);
      return JSON.stringify([]);
    }
  }

  async VerifyEmergencyCode(code) {
    try {
      const configPath =
        this._indicator && typeof this._indicator._getConfigPath === "function"
          ? this._indicator._getConfigPath()
          : await getDefaultConfigPath();
      const config = await loadConfig(configPath);
      if (!config.yubikey) config.yubikey = {};
      const res = await verifyAndConsumeEmergencyCode(code, config.yubikey);
      if (res.valid) {
        await saveConfig(config, configPath);
      }
      return res.valid;
    } catch (e) {
      console.error(`CmdBar D-Bus VerifyEmergencyCode error: ${e.message}`);
      return false;
    }
  }

  async ExportSnapshot(optionsJson = '{}') {
    try {
      let options = {};
      try { options = JSON.parse(optionsJson || '{}'); } catch (e) {}
      const snapshot = await exportEnvironmentSnapshot(options);
      return JSON.stringify(snapshot);
    } catch (e) {
      console.error(`CmdBar D-Bus ExportSnapshot error: ${e.message}`);
      return JSON.stringify({ error: e.message });
    }
  }

  async ImportSnapshot(snapshotJson, optionsJson = '{}') {
    try {
      let options = {};
      try { options = JSON.parse(optionsJson || '{}'); } catch (e) {}
      const res = await importEnvironmentSnapshot(snapshotJson, options);
      if (this._indicator && typeof this._indicator._reloadMenu === "function") {
        this._indicator._reloadMenu();
      }
      return Boolean(res && res.success);
    } catch (e) {
      console.error(`CmdBar D-Bus ImportSnapshot error: ${e.message}`);
      return false;
    }
  }

  async GetEffectiveAppName() {
    try {
      const configPath = this._indicator && typeof this._indicator._getConfigPath === "function"
        ? this._indicator._getConfigPath()
        : await getDefaultConfigPath();
      const config = await loadConfig(configPath);
      const branding = getEffectiveBranding(config);
      return branding.enabled ? branding.app_name : "CmdBar";
    } catch (e) {
      return "CmdBar";
    }
  }

  async SSOLogin(provider, protocol, credentials_json) {
    try {
      let creds = {};
      try {
        creds = JSON.parse(credentials_json || "{}");
      } catch (e) {}

      let result;
      if (protocol === "saml") {
        result = this._ssoManager.loginSaml(provider, creds.saml_response || "");
      } else {
        result = this._ssoManager.loginOidcClaims(provider, creds.claims || creds, creds.tokens || {});
      }

      if (result.success && result.session) {
        this.emitSSOSessionStateChanged(result.session.session_id, "active");
      }
      return JSON.stringify(result);
    } catch (e) {
      return JSON.stringify({ success: false, error: e.message });
    }
  }

  async SSOLogout(session_id) {
    const success = this._ssoManager.sessionManager.revokeSession(session_id);
    if (success) {
      this.emitSSOSessionStateChanged(session_id, "revoked");
    }
    return success;
  }

  async GetSSOSession(session_id) {
    const session = this._ssoManager.sessionManager.getSession(session_id);
    return JSON.stringify(session || null);
  }

  async GetSSOProviders() {
    return JSON.stringify(PROVIDER_PRESETS);
  }

  async ValidateSSOAccess(session_id, category_name) {
    return this._ssoManager.validateCategoryAccess(session_id, category_name);
  }

  emitSSOSessionStateChanged(sessionId, state) {
    if (this._dbusImpl && GLib) {
      try {
        this._dbusImpl.emit_signal(
          "SSOSessionStateChanged",
          new GLib.Variant("(ss)", [sessionId || "", state || ""])
        );
      } catch (e) {
        console.error(`CmdBar D-Bus emitSSOSessionStateChanged error: ${e.message}`);
      }
    }
  }
  async GetResourceMetrics() {
    try {
      if (this._indicator && this._indicator._resourceMonitor) {
        const monitor = this._indicator._resourceMonitor;
        const latest = monitor.getLatestMetrics() || {};
        const res = {
          cpu: latest.cpu || { usagePercent: 0 },
          memory: latest.memory || { totalMB: 0, usedMB: 0, freeMB: 0, usagePercent: 0 },
          disk: latest.disk || { totalGB: 0, usedGB: 0, freeGB: 0, usagePercent: 0 },
          network: latest.network || { rxBytes: 0, txBytes: 0, rxRateKBps: 0, txRateKBps: 0, totalRateKBps: 0 },
          sparklines: {
            cpu: monitor.getSparkline("cpu"),
            memory: monitor.getSparkline("memory"),
            disk: monitor.getSparkline("disk"),
            network: monitor.getSparkline("networkTotal"),
          },
          history: monitor.getHistory(),
        };
        return JSON.stringify(res);
      }
      return JSON.stringify({ error: "Resource monitor not active" });
    } catch (e) {
      console.error(`CmdBar D-Bus GetResourceMetrics error: ${e.message}`);
      return JSON.stringify({ error: e.message });
    }
  }

  async CreateBackup(description = 'D-Bus backup') {
    try {
      const res = await createBackup({ description: description || 'D-Bus backup' });
      return res.backup_path || '';
    } catch (e) {
      console.error(`CmdBar D-Bus CreateBackup error: ${e.message}`);
      return '';
    }
  }

  async RestoreBackup(backupPathOrId) {
    try {
      const res = await restoreFromBackup(backupPathOrId);
      if (this._indicator && typeof this._indicator._reloadMenu === "function") {
        this._indicator._reloadMenu();
      }
      return Boolean(res && res.success);
    } catch (e) {
      console.error(`CmdBar D-Bus RestoreBackup error: ${e.message}`);
      return false;
    }
  }

  async ListBackups() {
    try {
      const backups = listBackups();
      return JSON.stringify(backups);
    } catch (e) {
      console.error(`CmdBar D-Bus ListBackups error: ${e.message}`);
      return JSON.stringify([]);
    }
  }
  emitCommandExecuted(name, exitCode, success) {
    if (this._dbusImpl && GLib) {
      try {
        this._dbusImpl.emit_signal(
          "CommandExecuted",
          new GLib.Variant("(sib)", [
            name || "",
            exitCode || 0,
            Boolean(success),
          ]),
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
          new GLib.Variant("(sss)", [name || "", stdout || "", stderr || ""]),
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
