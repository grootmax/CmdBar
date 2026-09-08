import { jest } from '@jest/globals';
import {
  findWindow,
  getWindowsList,
  closeWindow,
  moveWindow,
  resizeWindow,
  tileWindow,
  switchWorkspace,
  generateWindowPreview,
  executeWindowCommand,
} from "../extension/windowManager.js";
import { formatShortcutHint, parseAccel, isBinaryAllowlisted } from "../extension/commandProcessor.js";

describe("Window Management Commands Unit Tests", () => {
  let mockWin1, mockWin2, mockDisplay, mockWsMgr, mockWs1, mockWs2;

  beforeEach(() => {
    mockWin1 = {
      _id: 101,
      _title: "Terminal Window",
      _wmClass: "gnome-terminal",
      _rect: { x: 0, y: 32, width: 960, height: 1048 },
      _maximized: false,
      _workspaceIdx: 0,
      get_id: function () { return this._id; },
      get_title: function () { return this._title; },
      get_wm_class: function () { return this._wmClass; },
      get_frame_rect: function () { return this._rect; },
      get_maximized: function () { return this._maximized ? 3 : 0; },
      get_workspace: function () { return mockWs1; },
      get_monitor: function () { return 0; },
      delete: jest.fn(),
      move_frame: jest.fn(function (user, x, y) {
        this._rect.x = x;
        this._rect.y = y;
      }),
      move_resize_frame: jest.fn(function (user, x, y, w, h) {
        this._rect.x = x;
        this._rect.y = y;
        this._rect.width = w;
        this._rect.height = h;
      }),
      maximize: jest.fn(function () { this._maximized = true; }),
      unmaximize: jest.fn(function () { this._maximized = false; }),
      change_workspace_by_index: jest.fn(function (idx) { this._workspaceIdx = idx; }),
    };

    mockWin2 = {
      _id: 102,
      _title: "Firefox Browser",
      _wmClass: "firefox",
      _rect: { x: 960, y: 32, width: 960, height: 1048 },
      _maximized: false,
      _workspaceIdx: 0,
      get_id: function () { return this._id; },
      get_title: function () { return this._title; },
      get_wm_class: function () { return this._wmClass; },
      get_frame_rect: function () { return this._rect; },
      get_maximized: function () { return this._maximized ? 3 : 0; },
      get_workspace: function () { return mockWs1; },
      get_monitor: function () { return 0; },
      delete: jest.fn(),
      move_frame: jest.fn(),
      move_resize_frame: jest.fn(),
      maximize: jest.fn(),
      unmaximize: jest.fn(),
      change_workspace_by_index: jest.fn(),
    };

    mockWs1 = {
      index: () => 0,
      get_work_area_for_monitor: () => ({ x: 0, y: 32, width: 1920, height: 1048 }),
      activate: jest.fn(),
    };

    mockWs2 = {
      index: () => 1,
      get_work_area_for_monitor: () => ({ x: 0, y: 32, width: 1920, height: 1048 }),
      activate: jest.fn(),
    };

    mockWsMgr = {
      _activeIdx: 0,
      get_active_workspace: () => (mockWsMgr._activeIdx === 0 ? mockWs1 : mockWs2),
      get_active_workspace_index: () => mockWsMgr._activeIdx,
      get_n_workspaces: () => 2,
      get_workspace_by_index: (idx) => (idx === 0 ? mockWs1 : mockWs2),
    };

    mockDisplay = {
      focus_window: mockWin1,
      get_tab_list: jest.fn(() => [mockWin1, mockWin2]),
    };

    globalThis.global = {
      display: mockDisplay,
      workspace_manager: mockWsMgr,
      get_current_time: () => 1000,
    };
  });

  afterEach(() => {
    delete globalThis.global;
  });

  describe("Window Finder & Listing", () => {
    test("findWindow should return focused window when no criteria given", () => {
      const win = findWindow(mockDisplay);
      expect(win).toBe(mockWin1);
    });

    test("findWindow should find window by ID", () => {
      const win = findWindow(mockDisplay, "102");
      expect(win).toBe(mockWin2);
    });

    test("findWindow should find window by title or wmClass substring", () => {
      const win = findWindow(mockDisplay, "firefox");
      expect(win).toBe(mockWin2);
    });

    test("getWindowsList should return list of active windows with geometry metadata", () => {
      const list = getWindowsList(mockDisplay);
      expect(list.length).toBe(2);
      expect(list[0].id).toBe(101);
      expect(list[0].title).toBe("Terminal Window");
      expect(list[0].focused).toBe(true);
      expect(list[0].rect).toEqual({ x: 0, y: 32, width: 960, height: 1048 });
      expect(list[1].title).toBe("Firefox Browser");
      expect(list[1].focused).toBe(false);
    });
  });

  describe("Window Control Operations", () => {
    test("closeWindow should delete active window in GNOME Shell", () => {
      const res = closeWindow(null, mockDisplay);
      expect(res.success).toBe(true);
      expect(mockWin1.delete).toHaveBeenCalled();
    });

    test("closeWindow should generate CLI fallback command when display is null", () => {
      delete globalThis.global;
      const res = closeWindow("102", null);
      expect(res.success).toBe(true);
      expect(res.cliCommand).toContain("xdotool");
    });

    test("moveWindow should shift window coordinates in direction", () => {
      const res = moveWindow("right", null, mockDisplay, 100);
      expect(res.success).toBe(true);
      expect(res.newRect.x).toBe(100);
      expect(mockWin1.move_frame).toHaveBeenCalledWith(true, 100, 32);
    });

    test("moveWindow should set explicit x,y coordinates", () => {
      const res = moveWindow("200,150", null, mockDisplay);
      expect(res.success).toBe(true);
      expect(res.newRect.x).toBe(200);
      expect(res.newRect.y).toBe(150);
    });

    test("resizeWindow should grow or shrink window dimensions", () => {
      const resGrow = resizeWindow("grow", null, mockDisplay, 100);
      expect(resGrow.success).toBe(true);
      expect(resGrow.newRect.width).toBe(1060);
      expect(resGrow.newRect.height).toBe(1148);

      const resShrink = resizeWindow("shrink", null, mockDisplay, 100);
      expect(resShrink.success).toBe(true);
      expect(resShrink.newRect.width).toBe(960);
      expect(resShrink.newRect.height).toBe(1048);

      const resGw = resizeWindow("grow-width", null, mockDisplay, 50);
      expect(resGw.success).toBe(true);
      expect(resGw.newRect.width).toBe(1010);

      const resSw = resizeWindow("shrink-width", null, mockDisplay, 50);
      expect(resSw.success).toBe(true);
      expect(resSw.newRect.width).toBe(960);

      const resGh = resizeWindow("grow-height", null, mockDisplay, 50);
      expect(resGh.success).toBe(true);
      expect(resGh.newRect.height).toBe(1098);

      const resSh = resizeWindow("shrink-height", null, mockDisplay, 50);
      expect(resSh.success).toBe(true);
      expect(resSh.newRect.height).toBe(1048);

      const resSize = resizeWindow("800,600", null, mockDisplay);
      expect(resSize.success).toBe(true);
      expect(resSize.newRect.width).toBe(800);
      expect(resSize.newRect.height).toBe(600);

      delete globalThis.global;
      const resCliSize = resizeWindow("grow", null, null);
      expect(resCliSize.success).toBe(true);
      expect(resCliSize.cliCommand).toContain("i3-msg");
    });

    test("tileWindow should position window in screen preset halves and corners", () => {
      const resLeft = tileWindow("left", null, mockDisplay);
      expect(resLeft.success).toBe(true);
      expect(resLeft.newRect).toEqual({ x: 0, y: 32, width: 960, height: 1048 });

      const resRight = tileWindow("right", null, mockDisplay);
      expect(resRight.success).toBe(true);
      expect(resRight.newRect).toEqual({ x: 960, y: 32, width: 960, height: 1048 });

      const resTop = tileWindow("top", null, mockDisplay);
      expect(resTop.success).toBe(true);
      expect(resTop.newRect).toEqual({ x: 0, y: 32, width: 1920, height: 524 });

      const resBottom = tileWindow("bottom", null, mockDisplay);
      expect(resBottom.success).toBe(true);
      expect(resBottom.newRect).toEqual({ x: 0, y: 556, width: 1920, height: 524 });

      const resTopLeft = tileWindow("top-left", null, mockDisplay);
      expect(resTopLeft.success).toBe(true);
      expect(resTopLeft.newRect).toEqual({ x: 0, y: 32, width: 960, height: 524 });

      const resTopRight = tileWindow("top-right", null, mockDisplay);
      expect(resTopRight.success).toBe(true);
      expect(resTopRight.newRect).toEqual({ x: 960, y: 32, width: 960, height: 524 });

      const resBottomLeft = tileWindow("bottom-left", null, mockDisplay);
      expect(resBottomLeft.success).toBe(true);
      expect(resBottomLeft.newRect).toEqual({ x: 0, y: 556, width: 960, height: 524 });

      const resBottomRight = tileWindow("bottom-right", null, mockDisplay);
      expect(resBottomRight.success).toBe(true);
      expect(resBottomRight.newRect).toEqual({ x: 960, y: 556, width: 960, height: 524 });

      const resCenter = tileWindow("center", null, mockDisplay);
      expect(resCenter.success).toBe(true);
      expect(resCenter.newRect).toEqual({ x: 480, y: 294, width: 960, height: 524 });

      const resMax = tileWindow("maximize", null, mockDisplay);
      expect(resMax.success).toBe(true);

      const resUnmax = tileWindow("unmaximize", null, mockDisplay);
      expect(resUnmax.success).toBe(true);
    });

    test("moveWindow should support up and down directions", () => {
      const resUp = moveWindow("up", null, mockDisplay, 50);
      expect(resUp.success).toBe(true);
      expect(resUp.newRect.y).toBe(-18);

      const resDown = moveWindow("down", null, mockDisplay, 50);
      expect(resDown.success).toBe(true);
      expect(resDown.newRect.y).toBe(32);
    });

    test("switchWorkspace should support prev, 1, 2, move:prev and CLI fallback", () => {
      mockWsMgr._activeIdx = 1;
      const resPrev = switchWorkspace("prev", null, mockDisplay);
      expect(resPrev.success).toBe(true);
      expect(resPrev.activeWorkspace).toBe(1);

      const resIdx1 = switchWorkspace("1", null, mockDisplay);
      expect(resIdx1.success).toBe(true);
      expect(resIdx1.activeWorkspace).toBe(1);

      delete globalThis.global;
      const resCli = switchWorkspace("next", null, null);
      expect(resCli.success).toBe(true);
      expect(resCli.cliCommand).toContain("wmctrl");
    });

    test("switchWorkspace should activate next/prev workspace", () => {
      const resNext = switchWorkspace("next", null, mockDisplay);
      expect(resNext.success).toBe(true);
      expect(resNext.activeWorkspace).toBe(2);
      expect(mockWs2.activate).toHaveBeenCalled();
    });

    test("switchWorkspace with move: prefix should move window and switch", () => {
      const resMove = switchWorkspace("move:2", null, mockDisplay);
      expect(resMove.success).toBe(true);
      expect(mockWin1.change_workspace_by_index).toHaveBeenCalledWith(1, true);
    });
  });

  describe("Visual Window Layout Preview Generator", () => {
    test("generateWindowPreview should render ASCII desktop frame and window boxes", () => {
      const windowsList = [
        {
          id: 101,
          title: "Terminal Window",
          wmClass: "gnome-terminal",
          workspace: 0,
          focused: true,
          rect: { x: 0, y: 0, width: 960, height: 1080 },
        },
        {
          id: 102,
          title: "Firefox Browser",
          wmClass: "firefox",
          workspace: 0,
          focused: false,
          rect: { x: 960, y: 0, width: 960, height: 1080 },
        },
      ];

      const preview = generateWindowPreview(windowsList, 1920, 1080);
      expect(preview).toContain("Desktop Window Layout");
      expect(preview).toContain("Window Details:");
      expect(preview).toContain("[ACTIVE] Terminal Window");
      expect(preview).toContain("Firefox Browser");
    });

    test("generateWindowPreview should handle empty window list gracefully", () => {
      const preview = generateWindowPreview([]);
      expect(preview).toContain("No open windows detected");
    });
  });

  describe("Command Parser & Shortcuts Integration", () => {
    test("executeWindowCommand should identify and process cmdbar:window: commands", () => {
      const cmdTile = "cmdbar:window:tile right";
      const parsed = executeWindowCommand(cmdTile, { display: mockDisplay });
      expect(parsed.isWindowCmd).toBe(true);
      expect(parsed.result.success).toBe(true);

      const cmdClose = "cmdbar:window:close";
      const parsedClose = executeWindowCommand(cmdClose, { display: mockDisplay });
      expect(parsedClose.isWindowCmd).toBe(true);

      const cmdMove = "cmdbar:window:move right";
      const parsedMove = executeWindowCommand(cmdMove, { display: mockDisplay });
      expect(parsedMove.isWindowCmd).toBe(true);

      const cmdResize = "cmdbar:window:resize grow";
      const parsedResize = executeWindowCommand(cmdResize, { display: mockDisplay });
      expect(parsedResize.isWindowCmd).toBe(true);

      const cmdWs = "cmdbar:window:workspace next";
      const parsedWs = executeWindowCommand(cmdWs, { display: mockDisplay });
      expect(parsedWs.isWindowCmd).toBe(true);

      const cmdPreview = "cmdbar:window:preview";
      const parsedPrev = executeWindowCommand(cmdPreview, { display: mockDisplay });
      expect(parsedPrev.isWindowCmd).toBe(true);
      expect(parsedPrev.result.preview).toContain("Desktop Window Layout");

      const cmdUnknown = "cmdbar:window:unknown";
      const parsedUnk = executeWindowCommand(cmdUnknown, { display: mockDisplay });
      expect(parsedUnk.isWindowCmd).toBe(true);
      expect(parsedUnk.result.success).toBe(false);

      expect(executeWindowCommand(null).isWindowCmd).toBe(false);
      expect(executeWindowCommand("make build").isWindowCmd).toBe(false);
    });

    test("shortcut helpers formatShortcutHint and parseAccel should parse window keybindings", () => {
      expect(formatShortcutHint("<Super><Alt>q")).toBe("Alt+Super+Q");
      expect(parseAccel("Super+Alt+q")).toEqual(["<Super><Alt>q"]);
    });

    test("isBinaryAllowlisted should approve cmdbar:window: commands and tiling WM binaries", () => {
      expect(isBinaryAllowlisted("cmdbar:window:tile left")).toBe(true);
      expect(isBinaryAllowlisted("wmctrl")).toBe(true);
      expect(isBinaryAllowlisted("xdotool")).toBe(true);
      expect(isBinaryAllowlisted("i3-msg")).toBe(true);
      expect(isBinaryAllowlisted("swaymsg")).toBe(true);
      expect(isBinaryAllowlisted("hyprctl")).toBe(true);
    });
  });
});
