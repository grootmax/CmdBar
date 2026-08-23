import { jest } from "@jest/globals";
import {
  detectWMEnvironment,
  calculateTileBounds,
  calculatePreviewGeometry,
  generatePreviewOverlayData,
  renderWindowPreviewCard,
  generateWMCommand,
  parseWMCommand,
  isWMCommand,
  WindowManager,
} from "../extension/commandProcessor.js";

describe("Window Management Unit & Integration Tests", () => {
  describe("WM Environment Detection", () => {
    test("should detect Hyprland environment", () => {
      expect(detectWMEnvironment({ HYPRLAND_INSTANCE_SIGNATURE: "abc123" })).toBe("hyprland");
    });

    test("should detect Sway environment", () => {
      expect(detectWMEnvironment({ SWAYSOCK: "/run/user/1000/sway-ipc.sock" })).toBe("sway");
    });

    test("should detect i3 environment", () => {
      expect(detectWMEnvironment({ I3SOCK: "/run/user/1000/i3-ipc.sock" })).toBe("i3");
    });

    test("should detect GNOME environment", () => {
      expect(detectWMEnvironment({ XDG_CURRENT_DESKTOP: "ubuntu:GNOME" })).toBe("gnome");
    });

    test("should detect X11 environment", () => {
      expect(detectWMEnvironment({ XDG_SESSION_TYPE: "x11", DISPLAY: ":0" })).toBe("x11");
    });

    test("should fallback to generic environment when empty", () => {
      expect(detectWMEnvironment({})).toBe("generic");
    });
  });

  describe("Tile Bounds Calculation", () => {
    const monitor = { x: 0, y: 0, width: 1920, height: 1080 };

    test("should calculate tile left bounds (50% width)", () => {
      const bounds = calculateTileBounds("tile-left", monitor);
      expect(bounds).toEqual({ x: 0, y: 0, width: 960, height: 1080 });
    });

    test("should calculate tile right bounds", () => {
      const bounds = calculateTileBounds("tile-right", monitor);
      expect(bounds).toEqual({ x: 960, y: 0, width: 960, height: 1080 });
    });

    test("should calculate tile top bounds (50% height)", () => {
      const bounds = calculateTileBounds("tile-top", monitor);
      expect(bounds).toEqual({ x: 0, y: 0, width: 1920, height: 540 });
    });

    test("should calculate tile bottom bounds", () => {
      const bounds = calculateTileBounds("tile-bottom", monitor);
      expect(bounds).toEqual({ x: 0, y: 540, width: 1920, height: 540 });
    });

    test("should calculate quarter tile bounds (top-left, top-right, bottom-left, bottom-right)", () => {
      expect(calculateTileBounds("top-left", monitor)).toEqual({ x: 0, y: 0, width: 960, height: 540 });
      expect(calculateTileBounds("top-right", monitor)).toEqual({ x: 960, y: 0, width: 960, height: 540 });
      expect(calculateTileBounds("bottom-left", monitor)).toEqual({ x: 0, y: 540, width: 960, height: 540 });
      expect(calculateTileBounds("bottom-right", monitor)).toEqual({ x: 960, y: 540, width: 960, height: 540 });
    });

    test("should calculate center window bounds (70% scale)", () => {
      const bounds = calculateTileBounds("center", monitor);
      expect(bounds.width).toBe(1344);
      expect(bounds.height).toBe(756);
      expect(bounds.x).toBe(288);
      expect(bounds.y).toBe(162);
    });

    test("should calculate maximize / restore bounds", () => {
      expect(calculateTileBounds("maximize", monitor)).toEqual(monitor);
      expect(calculateTileBounds("restore", monitor)).toEqual(monitor);
    });

    test("should account for window gap padding", () => {
      const bounds = calculateTileBounds("tile-left", monitor, 10);
      expect(bounds).toEqual({ x: 10, y: 10, width: 950, height: 1060 });
    });
  });

  describe("Preview Geometry & Visual Overlay Data", () => {
    test("calculatePreviewGeometry should scale window coordinates into preview container", () => {
      const winRect = { x: 0, y: 0, width: 1920, height: 1080 };
      const targetBounds = { x: 0, y: 0, width: 960, height: 1080 };
      const container = { width: 300, height: 200 };

      const geo = calculatePreviewGeometry(winRect, targetBounds, container);
      expect(geo.container).toEqual(container);
      expect(geo.targetPreview.width).toBeLessThan(geo.windowPreview.width);
      expect(geo.targetPreview.width).toBe(Math.round(960 * geo.scale));
    });

    test("generatePreviewOverlayData should generate CSS style string and target bounds", () => {
      const monitor = { x: 0, y: 0, width: 1920, height: 1080 };
      const data = generatePreviewOverlayData("tile-left", monitor);

      expect(data.action).toBe("tile-left");
      expect(data.targetBounds).toEqual({ x: 0, y: 0, width: 960, height: 1080 });
      expect(data.style).toContain("left: 0px; top: 0px; width: 960px; height: 1080px;");
      expect(data.visible).toBe(true);
    });

    test("renderWindowPreviewCard should format window card metadata, active status and SVG preview", () => {
      const card = renderWindowPreviewCard({
        id: "win-42",
        title: "VS Code",
        wm_class: "code",
        rect: { x: 100, y: 100, width: 1200, height: 800 },
        active: true,
        workspaceIndex: 1,
      });

      expect(card.id).toBe("win-42");
      expect(card.active).toBe(true);
      expect(card.svgPreview).toContain("<svg");
      expect(card.previewHtml).toContain("cmdbar-window-card active");
      expect(card.previewHtml).toContain("Workspace 2");
      expect(card.previewHtml).toContain("1200x800");
    });
  });

  describe("CLI Command Generator Across Window Managers", () => {
    test("should generate i3 commands", () => {
      expect(generateWMCommand("close", {}, "i3")).toBe("i3-msg kill");
      expect(generateWMCommand("tile-left", {}, "i3")).toBe("i3-msg 'split h; move left'");
      expect(generateWMCommand("tile-right", {}, "i3")).toBe("i3-msg 'split h; move right'");
      expect(generateWMCommand("tile-top", {}, "i3")).toBe("i3-msg 'split v; move up'");
      expect(generateWMCommand("tile-bottom", {}, "i3")).toBe("i3-msg 'split v; move down'");
      expect(generateWMCommand("maximize", {}, "i3")).toBe("i3-msg 'fullscreen toggle'");
      expect(generateWMCommand("restore", {}, "i3")).toBe("i3-msg 'fullscreen disable'");
      expect(generateWMCommand("switch-workspace", { target: 3 }, "i3")).toBe("i3-msg 'workspace number 3'");
      expect(generateWMCommand("move-workspace", { target: 2 }, "i3")).toBe("i3-msg 'move container to workspace number 2'");
      expect(generateWMCommand("resize-grow", {}, "i3")).toBe("i3-msg 'resize grow width 10 px or 10 ppt'");
      expect(generateWMCommand("resize-shrink", {}, "i3")).toBe("i3-msg 'resize shrink width 10 px or 10 ppt'");
      expect(generateWMCommand("focus", {}, "i3")).toBe("i3-msg 'focus'");
    });

    test("should generate Sway commands", () => {
      expect(generateWMCommand("close", {}, "sway")).toBe("swaymsg kill");
      expect(generateWMCommand("tile-left", {}, "sway")).toBe("swaymsg 'split h; move left'");
      expect(generateWMCommand("tile-right", {}, "sway")).toBe("swaymsg 'split h; move right'");
      expect(generateWMCommand("tile-top", {}, "sway")).toBe("swaymsg 'split v; move up'");
      expect(generateWMCommand("tile-bottom", {}, "sway")).toBe("swaymsg 'split v; move down'");
      expect(generateWMCommand("maximize", {}, "sway")).toBe("swaymsg 'fullscreen toggle'");
      expect(generateWMCommand("restore", {}, "sway")).toBe("swaymsg 'fullscreen disable'");
      expect(generateWMCommand("switch-workspace", { target: 4 }, "sway")).toBe("swaymsg 'workspace number 4'");
      expect(generateWMCommand("move-workspace", { target: 1 }, "sway")).toBe("swaymsg 'move container to workspace number 1'");
      expect(generateWMCommand("resize-grow", {}, "sway")).toBe("swaymsg 'resize grow width 10 px'");
      expect(generateWMCommand("resize-shrink", {}, "sway")).toBe("swaymsg 'resize shrink width 10 px'");
      expect(generateWMCommand("custom", {}, "sway")).toBe("swaymsg 'custom'");
    });

    test("should generate Hyprland commands", () => {
      expect(generateWMCommand("close", {}, "hyprland")).toBe("hyprctl dispatch killactive");
      expect(generateWMCommand("tile-left", {}, "hyprland")).toBe("hyprctl dispatch movewindow l");
      expect(generateWMCommand("tile-right", {}, "hyprland")).toBe("hyprctl dispatch movewindow r");
      expect(generateWMCommand("tile-top", {}, "hyprland")).toBe("hyprctl dispatch movewindow u");
      expect(generateWMCommand("tile-bottom", {}, "hyprland")).toBe("hyprctl dispatch movewindow d");
      expect(generateWMCommand("maximize", {}, "hyprland")).toBe("hyprctl dispatch fullscreen 1");
      expect(generateWMCommand("restore", {}, "hyprland")).toBe("hyprctl dispatch fullscreen 0");
      expect(generateWMCommand("switch-workspace", { target: 2 }, "hyprland")).toBe("hyprctl dispatch workspace 2");
      expect(generateWMCommand("move-workspace", { target: 3 }, "hyprland")).toBe("hyprctl dispatch movetoworkspace 3");
      expect(generateWMCommand("resize-grow", {}, "hyprland")).toBe("hyprctl dispatch resizeactive 50 50");
      expect(generateWMCommand("resize-shrink", {}, "hyprland")).toBe("hyprctl dispatch resizeactive -50 -50");
      expect(generateWMCommand("custom", {}, "hyprland")).toBe("hyprctl dispatch custom");
    });

    test("should generate X11 / wmctrl commands for fallback", () => {
      expect(generateWMCommand("close", {}, "x11")).toContain("wmctrl -c :ACTIVE:");
      expect(generateWMCommand("tile-left", {}, "x11")).toContain("wmctrl -r :ACTIVE:");
      expect(generateWMCommand("tile-right", {}, "x11")).toContain("wmctrl -r :ACTIVE:");
      expect(generateWMCommand("tile-top", {}, "x11")).toContain("wmctrl -r :ACTIVE:");
      expect(generateWMCommand("tile-bottom", {}, "x11")).toContain("wmctrl -r :ACTIVE:");
      expect(generateWMCommand("maximize", {}, "x11")).toBe("wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz");
      expect(generateWMCommand("restore", {}, "x11")).toBe("wmctrl -r :ACTIVE: -b remove,maximized_vert,maximized_horz");
      expect(generateWMCommand("switch-workspace", { target: 2 }, "x11")).toBe("wmctrl -s 1");
      expect(generateWMCommand("move-workspace", { target: 3 }, "x11")).toBe("wmctrl -r :ACTIVE: -t 2");
      expect(generateWMCommand("resize-grow", {}, "x11")).toContain("xdotool");
      expect(generateWMCommand("resize-shrink", {}, "x11")).toContain("xdotool");
      expect(generateWMCommand("custom", {}, "x11")).toBe("wmctrl -r :ACTIVE: custom");
    });
  });

  describe("WM Command Parsing & Validation", () => {
    test("parseWMCommand should identify valid wm: and window: commands", () => {
      expect(parseWMCommand("wm:tile-left")).toEqual({
        isWM: true,
        action: "tile-left",
        target: null,
        params: { action: "tile-left", target: null, raw: "wm:tile-left" },
      });

      expect(parseWMCommand("wm:move-workspace 3")).toEqual({
        isWM: true,
        action: "move-workspace",
        target: 3,
        params: { action: "move-workspace", target: 3, raw: "wm:move-workspace 3" },
      });

      expect(parseWMCommand("window:close")).toEqual({
        isWM: true,
        action: "close",
        target: null,
        params: { action: "close", target: null, raw: "window:close" },
      });
    });

    test("parseWMCommand and isWMCommand should reject non-WM commands", () => {
      expect(isWMCommand("make build")).toBe(false);
      expect(isWMCommand("echo hello")).toBe(false);
      expect(isWMCommand("")).toBe(false);
      expect(isWMCommand(null)).toBe(false);
      expect(parseWMCommand("make build").isWM).toBe(false);
    });
  });

  describe("WindowManager Execution & Mock Integration", () => {
    test("WindowManager class methods execute properly in fallback environment", async () => {
      const wm = new WindowManager();
      const windows = wm.getWindowsList();
      expect(Array.isArray(windows)).toBe(true);
      expect(windows.length).toBeGreaterThan(0);
      expect(windows[0]).toHaveProperty("id");
      expect(windows[0]).toHaveProperty("title");

      const tileRes = await wm.executeAction("wm:tile-left");
      expect(tileRes).toBe(true);

      const closeRes = await wm.executeAction("wm:close");
      expect(closeRes).toBe(true);

      const wsRes = await wm.executeAction("wm:switch-workspace 2");
      expect(wsRes).toBe(true);

      const previewData = wm.showTilePreview("tile-right");
      expect(previewData).toHaveProperty("action", "tile-right");

      wm.hideTilePreview();
    });

    test("WindowManager handles GNOME Shell native APIs when global.display is present", async () => {
      const mockWin = {
        get_id: () => 101,
        get_title: () => "Mock Terminal",
        get_wm_class: () => "gnome-terminal",
        get_frame_rect: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
        has_focus: () => true,
        get_workspace: () => ({ index: () => 0 }),
        delete: jest.fn(),
        maximize: jest.fn(),
        unmaximize: jest.fn(),
        move_resize_frame: jest.fn(),
        change_workspace: jest.fn(),
        get_monitor: () => 0,
      };

      const mockWorkspace = {
        activate: jest.fn(),
      };

      const originalGlobal = globalThis.global;
      const originalMeta = globalThis.Meta;
      globalThis.Meta = { MaximizeFlags: { HORIZONTAL: 1, VERTICAL: 2 } };
      globalThis.global = {
        get_current_time: () => 1000,
        display: {
          get_tab_list: () => [mockWin],
          get_monitor_geometry: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
          focus_window: mockWin,
        },
        workspace_manager: {
          get_active_workspace_index: () => 0,
          n_workspaces: 4,
          get_workspace_by_index: () => mockWorkspace,
        },
      };

      const wm = new WindowManager();
      const wins = wm.getWindowsList();
      expect(wins.length).toBe(1);
      expect(wins[0].title).toBe("Mock Terminal");

      await wm.executeAction("close");
      expect(mockWin.delete).toHaveBeenCalled();

      await wm.executeAction("maximize");
      expect(mockWin.maximize).toHaveBeenCalled();

      await wm.executeAction("restore");
      expect(mockWin.unmaximize).toHaveBeenCalled();

      await wm.executeAction("tile-left");
      expect(mockWin.move_resize_frame).toHaveBeenCalled();

      await wm.executeAction("switch-workspace", { target: 2 });
      expect(mockWorkspace.activate).toHaveBeenCalled();

      await wm.executeAction("move-workspace", { target: 2 });
      expect(mockWin.change_workspace).toHaveBeenCalled();

      globalThis.global = originalGlobal;
      globalThis.Meta = originalMeta;
    });
  });
});
