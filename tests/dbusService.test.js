import fs from "fs";
import path from "path";
import os from "os";
import { jest } from "@jest/globals";

jest.unstable_mockModule(
  "gi",
  () => ({
    St: {
      Clipboard: { get_default: () => ({ set_text: jest.fn() }) },
      ClipboardType: { CLIPBOARD: 1 },
      BoxLayout: class {},
      Icon: class {},
      Label: class {},
      Button: class {},
    },
    Clutter: { ActorAlign: { CENTER: 0 } },
    Gio: {
      DBusNodeInfo: {
        new_for_xml: () => ({
          interfaces: [{}],
        }),
      },
      DBusExportedObject: {
        wrapJSObject: () => ({
          export: jest.fn(),
          unexport: jest.fn(),
          emit_signal: jest.fn(),
        }),
      },
      BusType: { SESSION: 1 },
      BusNameOwnerFlags: { NONE: 0 },
      bus_own_name: jest.fn(() => 123),
      bus_unown_name: jest.fn(),
    },
    GLib: {
      Variant: class {
        constructor(type, value) {
          this.type = type;
          this.value = value;
        }
      },
    },
    GObject: { registerClass: (cls) => cls },
    Meta: { KeyBindingFlags: { NONE: 0 } },
    Shell: { ActionMode: { ALL: 1 } },
  }),
  { virtual: true },
);

const { CmdBarDBusService } = await import("../extension/dbusService.js");
const { loadConfig, saveConfig, getDefaultConfigPath } =
  await import("../extension/configSync.js");

describe("CmdBar DBus Service Unit Tests", () => {
  let tempDir, configPath, mockIndicator, service;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmdbar-dbus-test-"));
    configPath = path.join(tempDir, "config.json");

    const initialConfig = {
      categories: [
        {
          name: "Projects",
          commands: [{ name: "Git Status", command: "git status" }],
        },
      ],
    };
    await saveConfig(initialConfig, configPath);

    mockIndicator = {
      _getConfigPath: () => configPath,
      _reloadMenu: jest.fn(),
      executeCommand: jest.fn(),
    };

    service = new CmdBarDBusService(mockIndicator);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("AddCommand adds a new command and reloads menu", async () => {
    const success = await service.AddCommand(
      "New Task",
      "echo task",
      "Automation",
    );
    expect(success).toBe(true);
    expect(mockIndicator._reloadMenu).toHaveBeenCalled();

    const config = await loadConfig(configPath);
    const autoCat = config.categories.find((c) => c.name === "Automation");
    expect(autoCat).toBeDefined();
    expect(autoCat.commands.some((c) => c.name === "New Task")).toBe(true);
  });

  test("RemoveCommand removes command and reloads menu", async () => {
    const success = await service.RemoveCommand("Git Status");
    expect(success).toBe(true);
    expect(mockIndicator._reloadMenu).toHaveBeenCalled();

    const config = await loadConfig(configPath);
    const projCat = config.categories.find((c) => c.name === "Projects");
    expect(projCat.commands.some((c) => c.name === "Git Status")).toBe(false);
  });

  test("GetCommands returns JSON string of all commands", async () => {
    const jsonStr = await service.GetCommands();
    const cmds = JSON.parse(jsonStr);
    expect(Array.isArray(cmds)).toBe(true);
    expect(cmds.length).toBe(1);
    expect(cmds[0].name).toBe("Git Status");
    expect(cmds[0].category).toBe("Projects");
  });

  test("ExecuteCommand invokes indicator executeCommand", async () => {
    const success = await service.ExecuteCommand("Git Status");
    expect(success).toBe(true);
    expect(mockIndicator.executeCommand).toHaveBeenCalledWith(
      "Git Status",
      "git status",
      {},
      expect.objectContaining({ name: "Git Status" }),
    );
  });
});
