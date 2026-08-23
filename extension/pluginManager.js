/**
 * CmdBar Plugin Architecture and Sandboxed Extension System
 * Supports both Node.js (Testing/Companion) and GJS (GNOME Shell) environments.
 * @module pluginManager
 */

import { escapeMarkup } from "./commandProcessor.js";

const isNode =
  typeof process !== "undefined" && process.versions && process.versions.node;

let fs, path, os, vm, Gio, GLib;

if (isNode) {
  fs = await import("fs");
  path = await import("path");
  os = await import("os");
  try {
    vm = await import("vm");
  } catch (e) {}
} else {
  try {
    const giModule = await import("gi");
    Gio =
      giModule.Gio ||
      (giModule.default && giModule.default.Gio) ||
      giModule.default;
    GLib = giModule.GLib || (giModule.default && giModule.default.GLib);
  } catch (e) {}
}

/**
 * Returns default plugins directory (~/.config/cmdbar/plugins or $XDG_CONFIG_HOME/cmdbar/plugins).
 * @returns {string}
 */
export function getPluginsDir() {
  if (isNode) {
    const configHome =
      process.env.XDG_CONFIG_HOME ||
      (process.env.HOME ? `${process.env.HOME}/.config` : "/tmp");
    return path.join(configHome, "cmdbar", "plugins");
  } else if (GLib) {
    const userConfig = GLib.get_user_config_dir();
    return `${userConfig}/cmdbar/plugins`;
  }
  return "/tmp/cmdbar/plugins";
}

/**
 * Simple Event Emitter for Plugin System.
 */
export class PluginEventEmitter {
  constructor() {
    this._listeners = new Map();
  }

  on(event, handler) {
    if (typeof handler !== "function") return () => {};
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    if (this._listeners.has(event)) {
      this._listeners.get(event).delete(handler);
    }
  }

  once(event, handler) {
    const wrapper = (data) => {
      this.off(event, wrapper);
      handler(data);
    };
    return this.on(event, wrapper);
  }

  emit(event, data) {
    if (!this._listeners.has(event)) return;
    for (const handler of Array.from(this._listeners.get(event))) {
      try {
        handler(data);
      } catch (err) {
        console.error(`CmdBar Event error (${event}):`, err);
      }
    }
  }

  removeAllListeners(event) {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
  }
}

/**
 * Plugin Manifest Validator.
 * @param {Object} manifest
 * @returns {{valid: boolean, errors: string[], manifest: Object}}
 */
export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    return {
      valid: false,
      errors: ["Manifest must be a JSON object"],
      manifest: null,
    };
  }

  const errors = [];
  if (
    !manifest.id ||
    typeof manifest.id !== "string" ||
    !/^[a-zA-Z0-9_\-]+$/.test(manifest.id)
  ) {
    errors.push(
      "Plugin 'id' is required and must contain only alphanumeric characters, dashes, or underscores",
    );
  }
  if (!manifest.name || typeof manifest.name !== "string") {
    errors.push("Plugin 'name' is required");
  }
  if (!manifest.version || typeof manifest.version !== "string") {
    errors.push("Plugin 'version' is required");
  }

  const allowedPermissions = new Set([
    "commands",
    "clipboard",
    "events",
    "ui",
    "storage",
    "ai",
    "network",
  ]);
  const permissions = Array.isArray(manifest.permissions)
    ? manifest.permissions
    : [];
  for (const perm of permissions) {
    if (!allowedPermissions.has(perm)) {
      errors.push(`Unknown or invalid permission '${perm}' requested`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    manifest:
      errors.length === 0
        ? {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version || "1.0.0",
            description: manifest.description || "",
            author: manifest.author || "Unknown",
            main: manifest.main || "index.js",
            permissions,
            enabled: manifest.enabled !== false,
            minCmdBarVersion: manifest.minCmdBarVersion || "1.0.0",
            commands: Array.isArray(manifest.commands) ? manifest.commands : [],
          }
        : null,
  };
}

/**
 * Sandboxed Plugin Context & Execution Manager.
 */
export class SandboxedPlugin {
  constructor(pluginDir, manifest, eventBus, hostServices = {}) {
    this.pluginDir = pluginDir;
    this.manifest = manifest;
    this.id = manifest.id;
    this.eventBus = eventBus;
    this.hostServices = hostServices;
    this.active = false;
    this.registeredCommands = new Map();
    this.pluginStorage = new Map();
    this.eventSubscriptions = [];
    this.aiFilters = [];
    this.error = null;
  }

  hasPermission(perm) {
    return (
      Array.isArray(this.manifest.permissions) &&
      this.manifest.permissions.includes(perm)
    );
  }

  checkPermission(perm, action) {
    if (!this.hasPermission(perm)) {
      throw new Error(
        `Plugin '${this.id}' denied action '${action}': Missing '${perm}' permission in manifest`,
      );
    }
  }

  createApiSurface() {
    const self = this;
    return {
      manifest: Object.freeze({ ...self.manifest }),
      pluginDir: self.pluginDir,

      commands: {
        register(cmd) {
          self.checkPermission("commands", "commands.register");
          if (!cmd || !cmd.name || (!cmd.command && !cmd.handler)) {
            throw new Error(
              "Invalid command definition: requires 'name' and ('command' or 'handler')",
            );
          }
          const cmdId =
            cmd.id ||
            `${self.id}:${cmd.name.toLowerCase().replace(/\s+/g, "-")}`;
          const cmdEntry = {
            id: cmdId,
            pluginId: self.id,
            name: cmd.name,
            command: cmd.command || "",
            category: cmd.category || "Plugins",
            placeholder: cmd.placeholder || "",
            handler: typeof cmd.handler === "function" ? cmd.handler : null,
          };
          self.registeredCommands.set(cmdId, cmdEntry);
          if (self.hostServices.onCommandRegistered) {
            self.hostServices.onCommandRegistered(cmdEntry);
          }
          return cmdId;
        },
        unregister(cmdId) {
          self.checkPermission("commands", "commands.unregister");
          const removed = self.registeredCommands.delete(cmdId);
          if (removed && self.hostServices.onCommandUnregistered) {
            self.hostServices.onCommandUnregistered(cmdId);
          }
          return removed;
        },
        getCommands() {
          return Array.from(self.registeredCommands.values());
        },
      },

      events: {
        on(event, handler) {
          self.checkPermission("events", "events.on");
          const unsubscribe = self.eventBus.on(event, handler);
          self.eventSubscriptions.push(unsubscribe);
          return unsubscribe;
        },
        emit(event, data) {
          self.checkPermission("events", "events.emit");
          self.eventBus.emit(event, { ...data, pluginId: self.id });
        },
      },

      clipboard: {
        copy(text) {
          self.checkPermission("clipboard", "clipboard.copy");
          if (self.hostServices.copyToClipboard) {
            return self.hostServices.copyToClipboard(text);
          }
          return false;
        },
        paste(text) {
          self.checkPermission("clipboard", "clipboard.paste");
          if (self.hostServices.pasteClipboardText) {
            return self.hostServices.pasteClipboardText(text);
          }
          return false;
        },
      },

      ui: {
        notify(title, message) {
          self.checkPermission("ui", "ui.notify");
          if (self.hostServices.notify) {
            self.hostServices.notify(title, message);
          } else {
            console.log(
              `[Plugin ${self.id}] Notification: ${title} - ${message}`,
            );
          }
        },
      },

      storage: {
        get(key) {
          self.checkPermission("storage", "storage.get");
          return self.pluginStorage.get(key);
        },
        set(key, value) {
          self.checkPermission("storage", "storage.set");
          self.pluginStorage.set(key, value);
        },
        remove(key) {
          self.checkPermission("storage", "storage.remove");
          return self.pluginStorage.delete(key);
        },
        clear() {
          self.checkPermission("storage", "storage.clear");
          self.pluginStorage.clear();
        },
      },

      ai: {
        registerPromptFilter(filterFn) {
          self.checkPermission("ai", "ai.registerPromptFilter");
          if (typeof filterFn === "function") {
            self.aiFilters.push(filterFn);
          }
        },
      },
    };
  }

  async activate() {
    if (this.active) return true;
    this.error = null;

    try {
      if (
        Array.isArray(this.manifest.commands) &&
        this.hasPermission("commands")
      ) {
        for (const cmd of this.manifest.commands) {
          const cmdId = `${this.id}:${(cmd.name || "cmd").toLowerCase().replace(/\s+/g, "-")}`;
          this.registeredCommands.set(cmdId, {
            id: cmdId,
            pluginId: this.id,
            name: cmd.name || "Plugin Command",
            command: cmd.command || "echo 'Plugin Command'",
            category: cmd.category || "Plugins",
            placeholder: cmd.placeholder || "",
            handler: null,
          });
        }
      }

      const mainFile = this.manifest.main || "index.js";
      let code = "";

      if (isNode) {
        const fullPath = path.join(this.pluginDir, mainFile);
        if (fs.existsSync(fullPath)) {
          code = fs.readFileSync(fullPath, "utf8");
        }
      } else if (Gio) {
        const fullPath = `${this.pluginDir}/${mainFile}`;
        const file = Gio.File.new_for_path(fullPath);
        if (file.query_exists(null)) {
          const [ok, contents] = file.load_contents(null);
          if (ok) {
            code = new TextDecoder("utf-8").decode(contents);
          }
        }
      }

      if (code.trim()) {
        const api = this.createApiSurface();
        this.executeSandboxedCode(code, api);
      }

      this.active = true;
      this.eventBus.emit("plugin:activated", {
        id: this.id,
        name: this.manifest.name,
      });
      return true;
    } catch (err) {
      this.error = err.message;
      this.active = false;
      this.deactivate();
      console.error(`CmdBar: Failed to activate plugin '${this.id}':`, err);
      this.eventBus.emit("plugin:error", { id: this.id, error: err.message });
      return false;
    }
  }

  executeSandboxedCode(code, api) {
    if (isNode && vm && typeof vm.createContext === "function") {
      const sandbox = {
        console: {
          log: (...args) => console.log(`[Plugin:${this.id}]`, ...args),
          warn: (...args) => console.warn(`[Plugin:${this.id}]`, ...args),
          error: (...args) => console.error(`[Plugin:${this.id}]`, ...args),
        },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        JSON,
        Math,
        Date,
        Object,
        Array,
        Promise,
        String,
        Number,
        Boolean,
        RegExp,
        Error,
        api,
        exports: {},
        module: { exports: {} },
      };
      vm.createContext(sandbox);
      const wrappedCode = `(function(api, console, exports, module) { ${code} \n if (typeof activate === "function") { activate(api); } })(api, console, exports, module);`;
      const script = new vm.Script(wrappedCode, {
        filename: `plugin-${this.id}.js`,
      });
      script.runInContext(sandbox, { timeout: 1000 });
    } else {
      const sandboxConsole = {
        log: (...args) => console.log(`[Plugin:${this.id}]`, ...args),
        warn: (...args) => console.warn(`[Plugin:${this.id}]`, ...args),
        error: (...args) => console.error(`[Plugin:${this.id}]`, ...args),
      };
      const exports = {};
      const module = { exports };
      const runFn = new Function(
        "api",
        "console",
        "exports",
        "module",
        `
        ${code}
        if (typeof activate === "function") { activate(api); }
      `,
      );
      runFn(api, sandboxConsole, exports, module);
    }
  }

  deactivate() {
    for (const unsub of this.eventSubscriptions) {
      try {
        unsub();
      } catch (e) {}
    }
    this.eventSubscriptions = [];

    if (this.hostServices.onCommandUnregistered) {
      for (const cmdId of this.registeredCommands.keys()) {
        this.hostServices.onCommandUnregistered(cmdId);
      }
    }
    this.registeredCommands.clear();
    this.aiFilters = [];

    this.active = false;
    this.eventBus.emit("plugin:deactivated", { id: this.id });
  }
}

/**
 * Plugin Manager & Discovery System.
 */
export class PluginManager {
  constructor(pluginsDir = null, hostServices = {}) {
    this.pluginsDir = pluginsDir || getPluginsDir();
    this.eventBus = new PluginEventEmitter();
    this.hostServices = hostServices;
    this.plugins = new Map();
  }

  ensurePluginsDir() {
    if (isNode) {
      if (!fs.existsSync(this.pluginsDir)) {
        fs.mkdirSync(this.pluginsDir, { recursive: true });
      }
    } else if (Gio) {
      const dir = Gio.File.new_for_path(this.pluginsDir);
      if (!dir.query_exists(null)) {
        dir.make_directory_with_parents(null);
      }
    }
  }

  discoverPlugins() {
    this.ensurePluginsDir();
    const discovered = [];

    if (isNode) {
      if (fs.existsSync(this.pluginsDir)) {
        const entries = fs.readdirSync(this.pluginsDir, {
          withFileTypes: true,
        });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const pluginDir = path.join(this.pluginsDir, entry.name);
            const manifestPath = path.join(pluginDir, "manifest.json");
            const altManifestPath = path.join(pluginDir, "plugin.json");

            const manifestFile = fs.existsSync(manifestPath)
              ? manifestPath
              : fs.existsSync(altManifestPath)
                ? altManifestPath
                : null;

            if (manifestFile) {
              try {
                const raw = fs.readFileSync(manifestFile, "utf8");
                const json = JSON.parse(raw);
                const valResult = validateManifest(json);
                if (valResult.valid) {
                  discovered.push({ pluginDir, manifest: valResult.manifest });
                } else {
                  console.warn(
                    `CmdBar: Invalid plugin manifest in ${pluginDir}:`,
                    valResult.errors,
                  );
                }
              } catch (e) {
                console.error(
                  `CmdBar: Error reading plugin manifest in ${pluginDir}:`,
                  e,
                );
              }
            }
          }
        }
      }
    } else if (Gio) {
      const dir = Gio.File.new_for_path(this.pluginsDir);
      if (dir.query_exists(null)) {
        const enumerator = dir.enumerate_children(
          "standard::*",
          Gio.FileQueryInfoFlags.NONE,
          null,
        );
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
          if (info.get_file_type() === Gio.FileType.DIRECTORY) {
            const pluginDir = `${this.pluginsDir}/${info.get_name()}`;
            const manifestFile = Gio.File.new_for_path(
              `${pluginDir}/manifest.json`,
            );
            if (manifestFile.query_exists(null)) {
              try {
                const [ok, contents] = manifestFile.load_contents(null);
                if (ok) {
                  const raw = new TextDecoder("utf-8").decode(contents);
                  const json = JSON.parse(raw);
                  const valResult = validateManifest(json);
                  if (valResult.valid) {
                    discovered.push({
                      pluginDir,
                      manifest: valResult.manifest,
                    });
                  }
                }
              } catch (e) {}
            }
          }
        }
      }
    }

    return discovered;
  }

  loadPlugins() {
    const discovered = this.discoverPlugins();
    const loaded = [];

    for (const { pluginDir, manifest } of discovered) {
      if (this.plugins.has(manifest.id)) {
        this.unloadPlugin(manifest.id);
      }

      const plugin = new SandboxedPlugin(
        pluginDir,
        manifest,
        this.eventBus,
        this.hostServices,
      );
      this.plugins.set(manifest.id, plugin);

      if (manifest.enabled) {
        plugin.activate();
      }
      loaded.push(plugin);
    }

    return loaded;
  }

  unloadPlugin(pluginId) {
    const plugin = this.plugins.get(pluginId);
    if (plugin) {
      plugin.deactivate();
      this.plugins.delete(pluginId);
      return true;
    }
    return false;
  }

  unloadAllPlugins() {
    for (const pluginId of Array.from(this.plugins.keys())) {
      this.unloadPlugin(pluginId);
    }
  }

  installPlugin(pluginManifest, pluginCode = "", targetDirName = null) {
    this.ensurePluginsDir();
    const valResult = validateManifest(pluginManifest);
    if (!valResult.valid) {
      throw new Error(
        `Cannot install plugin: Invalid manifest - ${valResult.errors.join("; ")}`,
      );
    }

    const manifest = valResult.manifest;
    const folderName = targetDirName || manifest.id;

    if (isNode) {
      const pluginDir = path.join(this.pluginsDir, folderName);
      if (!fs.existsSync(pluginDir)) {
        fs.mkdirSync(pluginDir, { recursive: true });
      }
      fs.writeFileSync(
        path.join(pluginDir, "manifest.json"),
        JSON.stringify(manifest, null, 2),
        "utf8",
      );
      if (pluginCode) {
        fs.writeFileSync(
          path.join(pluginDir, manifest.main || "index.js"),
          pluginCode,
          "utf8",
        );
      }
      return { pluginDir, manifest };
    } else if (Gio) {
      const pluginDir = `${this.pluginsDir}/${folderName}`;
      const dir = Gio.File.new_for_path(pluginDir);
      if (!dir.query_exists(null)) {
        dir.make_directory_with_parents(null);
      }
      const manifestFile = Gio.File.new_for_path(`${pluginDir}/manifest.json`);
      manifestFile.replace_contents(
        new GLib.Bytes(JSON.stringify(manifest, null, 2)),
        null,
        false,
        Gio.FileCreateFlags.NONE,
        null,
      );
      if (pluginCode) {
        const codeFile = Gio.File.new_for_path(
          `${pluginDir}/${manifest.main || "index.js"}`,
        );
        codeFile.replace_contents(
          new GLib.Bytes(pluginCode),
          null,
          false,
          Gio.FileCreateFlags.NONE,
          null,
        );
      }
      return { pluginDir, manifest };
    }
  }

  uninstallPlugin(pluginId) {
    const plugin = this.plugins.get(pluginId);
    const pluginDir = plugin
      ? plugin.pluginDir
      : isNode
        ? path.join(this.pluginsDir, pluginId)
        : `${this.pluginsDir}/${pluginId}`;

    this.unloadPlugin(pluginId);

    if (isNode) {
      if (fs.existsSync(pluginDir)) {
        fs.rmSync(pluginDir, { recursive: true, force: true });
        return true;
      }
    } else if (Gio) {
      const dir = Gio.File.new_for_path(pluginDir);
      if (dir.query_exists(null)) {
        dir.delete(null);
        return true;
      }
    }
    return false;
  }

  enablePlugin(pluginId) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;
    plugin.manifest.enabled = true;
    return plugin.activate();
  }

  disablePlugin(pluginId) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;
    plugin.manifest.enabled = false;
    plugin.deactivate();
    return true;
  }

  getAllCommands() {
    const commands = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.active) {
        commands.push(...plugin.registeredCommands.values());
      }
    }
    return commands;
  }

  getPluginStatus() {
    const status = [];
    for (const plugin of this.plugins.values()) {
      status.push({
        id: plugin.id,
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        description: plugin.manifest.description,
        author: plugin.manifest.author,
        enabled: plugin.manifest.enabled,
        active: plugin.active,
        error: plugin.error,
        commandCount: plugin.registeredCommands.size,
        permissions: plugin.manifest.permissions,
      });
    }
    return status;
  }
}

/**
 * Plugin Marketplace Client (Catalog & Discovery).
 */
export class PluginMarketplace {
  constructor(catalogUrl = "https://marketplace.cmdbar.org/plugins.json") {
    this.catalogUrl = catalogUrl;
    this._mockCatalog = [
      {
        id: "git-enhanced",
        name: "Enhanced Git Tools",
        version: "1.2.0",
        description:
          "Advanced Git commands, branch switching and status macros",
        author: "CmdBar Core Team",
        permissions: ["commands", "clipboard", "events"],
        downloadUrl: "https://marketplace.cmdbar.org/plugins/git-enhanced.zip",
        rating: 4.8,
        downloads: 1250,
      },
      {
        id: "docker-manager",
        name: "Docker Container Manager",
        version: "1.0.1",
        description: "Quick container restart, logs, and cleanup commands",
        author: "DevOps Community",
        permissions: ["commands", "ui", "storage"],
        downloadUrl:
          "https://marketplace.cmdbar.org/plugins/docker-manager.zip",
        rating: 4.6,
        downloads: 890,
      },
      {
        id: "ai-prompt-booster",
        name: "AI Prompt Booster",
        version: "2.0.0",
        description: "Custom AI prompts and prompt filter transformations",
        author: "AI Guild",
        permissions: ["ai", "events", "storage"],
        downloadUrl:
          "https://marketplace.cmdbar.org/plugins/ai-prompt-booster.zip",
        rating: 4.9,
        downloads: 2100,
      },
    ];
  }

  async searchCatalog(query = "") {
    if (!query || !query.trim()) {
      return this._mockCatalog;
    }
    const q = query.toLowerCase();
    return this._mockCatalog.filter(
      (p) =>
        p.id.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q),
    );
  }

  async fetchPluginDetails(pluginId) {
    const catalog = await this.searchCatalog();
    return catalog.find((p) => p.id === pluginId) || null;
  }
}
