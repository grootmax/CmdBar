import fs from "fs";
import path from "path";
import os from "os";
import { jest } from "@jest/globals";
import {
  getPluginsDir,
  PluginEventEmitter,
  validateManifest,
  SandboxedPlugin,
  PluginManager,
  PluginMarketplace,
} from "../extension/pluginManager.js";

describe("CmdBar Plugin System Unit Tests", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmdbar-plugins-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("PluginEventEmitter", () => {
    test("should subscribe, emit, and unsubscribe events", () => {
      const emitter = new PluginEventEmitter();
      const fn = jest.fn();

      const unsub = emitter.on("test:event", fn);
      emitter.emit("test:event", { payload: 123 });

      expect(fn).toHaveBeenCalledWith({ payload: 123 });

      unsub();
      emitter.emit("test:event", { payload: 456 });
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test("should handle once listeners", () => {
      const emitter = new PluginEventEmitter();
      const fn = jest.fn();

      emitter.once("single", fn);
      emitter.emit("single", "a");
      emitter.emit("single", "b");

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("a");
    });
  });

  describe("validateManifest", () => {
    test("should validate correct manifest", () => {
      const manifest = {
        id: "test-plugin",
        name: "Test Plugin",
        version: "1.0.0",
        permissions: ["commands", "clipboard", "ui"],
      };

      const res = validateManifest(manifest);
      expect(res.valid).toBe(true);
      expect(res.errors).toEqual([]);
      expect(res.manifest.id).toBe("test-plugin");
    });

    test("should reject invalid manifest missing required fields", () => {
      const res = validateManifest({ id: "invalid id space" });
      expect(res.valid).toBe(false);
      expect(res.errors.length).toBeGreaterThan(0);
    });

    test("should reject unknown permissions", () => {
      const res = validateManifest({
        id: "bad-perm",
        name: "Bad Perm",
        version: "1.0",
        permissions: ["unknown-perm"],
      });
      expect(res.valid).toBe(false);
    });
  });

  describe("SandboxedPlugin", () => {
    test("should enforce permission checks on API calls", async () => {
      const eventBus = new PluginEventEmitter();
      const manifest = {
        id: "perm-test",
        name: "Perm Test",
        version: "1.0.0",
        permissions: [], // No permissions
      };

      const plugin = new SandboxedPlugin(tempDir, manifest, eventBus);
      const api = plugin.createApiSurface();

      expect(() =>
        api.commands.register({ name: "Foo", command: "bar" }),
      ).toThrow(/Missing 'commands' permission/);
      expect(() => api.clipboard.copy("text")).toThrow(
        /Missing 'clipboard' permission/,
      );
      expect(() => api.storage.get("key")).toThrow(
        /Missing 'storage' permission/,
      );
    });

    test("should execute sandboxed plugin code safely", async () => {
      const eventBus = new PluginEventEmitter();
      const hostNotify = jest.fn();

      const manifest = {
        id: "sandbox-test",
        name: "Sandbox Test",
        version: "1.0.0",
        permissions: ["commands", "ui", "storage"],
      };

      const mainCode = `
        api.commands.register({ name: 'Dynamic Action', command: 'echo dynamic' });
        api.ui.notify('Hello', 'From Sandbox');
        api.storage.set('myKey', 42);
      `;

      fs.writeFileSync(path.join(tempDir, "index.js"), mainCode, "utf8");

      const plugin = new SandboxedPlugin(tempDir, manifest, eventBus, {
        notify: hostNotify,
      });

      const activated = await plugin.activate();
      expect(activated).toBe(true);
      expect(plugin.active).toBe(true);

      expect(hostNotify).toHaveBeenCalledWith("Hello", "From Sandbox");
      expect(plugin.registeredCommands.size).toBe(1);
      expect(plugin.pluginStorage.get("myKey")).toBe(42);

      plugin.deactivate();
      expect(plugin.active).toBe(false);
      expect(plugin.registeredCommands.size).toBe(0);
    });
  });

  describe("PluginManager", () => {
    test("should install, discover, load, and uninstall plugins", async () => {
      const manager = new PluginManager(tempDir);

      const manifest = {
        id: "sample-plugin",
        name: "Sample Plugin",
        version: "1.0.0",
        description: "A sample plugin",
        author: "Tester",
        permissions: ["commands", "events"],
      };

      const code = `
        api.commands.register({ name: 'Sample Command', command: 'echo sample' });
      `;

      manager.installPlugin(manifest, code);

      const discovered = manager.discoverPlugins();
      expect(discovered.length).toBe(1);
      expect(discovered[0].manifest.id).toBe("sample-plugin");

      const loaded = manager.loadPlugins();
      expect(loaded.length).toBe(1);
      expect(manager.getAllCommands().length).toBe(1);

      const status = manager.getPluginStatus();
      expect(status[0].id).toBe("sample-plugin");
      expect(status[0].active).toBe(true);

      manager.disablePlugin("sample-plugin");
      expect(manager.getAllCommands().length).toBe(0);

      manager.enablePlugin("sample-plugin");
      expect(manager.getAllCommands().length).toBe(1);

      manager.uninstallPlugin("sample-plugin");
      expect(manager.discoverPlugins().length).toBe(0);
    });
  });

  describe("PluginMarketplace", () => {
    test("should search catalog and fetch plugin details", async () => {
      const marketplace = new PluginMarketplace();

      const all = await marketplace.searchCatalog();
      expect(all.length).toBeGreaterThan(0);

      const gitTools = await marketplace.searchCatalog("git");
      expect(gitTools.length).toBe(1);
      expect(gitTools[0].id).toBe("git-enhanced");

      const details = await marketplace.fetchPluginDetails("git-enhanced");
      expect(details).not.toBeNull();
      expect(details.name).toBe("Enhanced Git Tools");
    });
  });
});
