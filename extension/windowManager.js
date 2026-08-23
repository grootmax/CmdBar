/**
 * Window Management Module for CmdBar.
 * Supports window control (close, move, resize, tile, switch workspace),
 * shortcuts integration, visual window preview, and GNOME Shell / Tiling WMs compatibility.
 */

let Meta, Clutter, GLib, Gio;
try {
  const giModule = await import("gi");
  Meta = giModule.Meta || (giModule.default && giModule.default.Meta);
  Clutter = giModule.Clutter || (giModule.default && giModule.default.Clutter);
  GLib = giModule.GLib || (giModule.default && giModule.default.GLib);
  Gio = giModule.Gio || (giModule.default && giModule.default.Gio);
} catch (e) {}

/**
 * Normalizes window ID/title or gets focused/active window.
 * @param {object} [display]
 * @param {number|string} [windowIdOrTitle]
 * @returns {object|null}
 */
export function findWindow(display, windowIdOrTitle) {
  if (!display) {
    if (typeof globalThis.global !== "undefined" && globalThis.global.display) {
      display = globalThis.global.display;
    }
  }

  if (display && typeof display.get_tab_list === "function") {
    const wsMgr = globalThis.global ? globalThis.global.workspace_manager : null;
    const currentWs = wsMgr && typeof wsMgr.get_active_workspace === "function"
      ? wsMgr.get_active_workspace()
      : null;
    const windows = display.get_tab_list(0, currentWs) || [];

    if (windowIdOrTitle !== null && windowIdOrTitle !== undefined && windowIdOrTitle !== "") {
      const searchStr = String(windowIdOrTitle).toLowerCase().trim();
      // Match by ID
      const byId = windows.find((w) => typeof w.get_id === "function" && String(w.get_id()) === searchStr);
      if (byId) return byId;

      // Match by Title or WM Class
      const byTitle = windows.find((w) => {
        const title = typeof w.get_title === "function" ? (w.get_title() || "").toLowerCase() : "";
        const wmClass = typeof w.get_wm_class === "function" ? (w.get_wm_class() || "").toLowerCase() : "";
        return title.includes(searchStr) || wmClass.includes(searchStr);
      });
      if (byTitle) return byTitle;
    }

    if (typeof display.focus_window !== "undefined" && display.focus_window) {
      return display.focus_window;
    }
    if (windows.length > 0) {
      return windows[0];
    }
  }

  return null;
}

/**
 * Gets list of windows with metadata.
 * @param {object} [display]
 * @returns {Array<object>}
 */
export function getWindowsList(display) {
  if (!display && typeof globalThis.global !== "undefined") {
    display = globalThis.global.display;
  }

  const result = [];
  if (display && typeof display.get_tab_list === "function") {
    const wsMgr = globalThis.global ? globalThis.global.workspace_manager : null;
    const activeWsIdx = wsMgr && typeof wsMgr.get_active_workspace_index === "function" ? wsMgr.get_active_workspace_index() : 0;
    const focusWin = display.focus_window;

    const windows = display.get_tab_list(0, null) || [];
    windows.forEach((win) => {
      let rect = { x: 0, y: 0, width: 800, height: 600 };
      if (typeof win.get_frame_rect === "function") {
        const r = win.get_frame_rect();
        rect = { x: r.x, y: r.y, width: r.width, height: r.height };
      }
      const ws = typeof win.get_workspace === "function" ? win.get_workspace() : null;
      const wsIdx = ws && typeof ws.index === "function" ? ws.index() : activeWsIdx;

      result.push({
        id: typeof win.get_id === "function" ? win.get_id() : Math.floor(Math.random() * 10000),
        title: typeof win.get_title === "function" ? (win.get_title() || "Untitled") : "Window",
        wmClass: typeof win.get_wm_class === "function" ? (win.get_wm_class() || "") : "",
        workspace: wsIdx,
        workspaceName: `Workspace ${wsIdx + 1}`,
        focused: focusWin === win,
        rect,
        maximized: typeof win.get_maximized === "function" ? win.get_maximized() !== 0 : false,
      });
    });
  }

  return result;
}

/**
 * Close window.
 * @param {number|string} [windowIdOrTitle]
 * @param {object} [display]
 * @returns {{ success: boolean, message: string, cliCommand?: string }}
 */
export function closeWindow(windowIdOrTitle = null, display = null) {
  const win = findWindow(display, windowIdOrTitle);
  if (win && typeof win.delete === "function") {
    const timestamp = (globalThis.global && globalThis.global.get_current_time)
      ? globalThis.global.get_current_time()
      : 0;
    win.delete(timestamp);
    return { success: true, message: `Closed window: ${win.get_title ? win.get_title() : 'Active Window'}` };
  }

  // Fallback / CLI representation
  const target = windowIdOrTitle ? String(windowIdOrTitle) : ":ACTIVE:";
  const cliCmd = `xdotool windowclose ${target === ":ACTIVE:" ? "$(xdotool getactivewindow)" : target} || wmctrl -c "${target}" || i3-msg kill || swaymsg kill || hyprctl dispatch closewindow`;
  return {
    success: true,
    message: `Close command issued for window ${windowIdOrTitle || "focused"}`,
    cliCommand: cliCmd,
  };
}

/**
 * Move window.
 * @param {string|object} directionOrCoords "left"|"right"|"up"|"down" or {x, y} or "x,y"
 * @param {number|string} [windowIdOrTitle]
 * @param {object} [display]
 * @param {number} [step=100]
 * @returns {{ success: boolean, message: string, newRect?: object, cliCommand?: string }}
 */
export function moveWindow(directionOrCoords, windowIdOrTitle = null, display = null, step = 100) {
  const win = findWindow(display, windowIdOrTitle);
  let dir = typeof directionOrCoords === "string" ? directionOrCoords.toLowerCase().trim() : "";
  let targetX = null, targetY = null;

  if (typeof directionOrCoords === "object" && directionOrCoords !== null) {
    targetX = directionOrCoords.x;
    targetY = directionOrCoords.y;
  } else if (dir.includes(",")) {
    const parts = dir.split(",").map((p) => parseInt(p.trim(), 10));
    if (!isNaN(parts[0]) && !isNaN(parts[1])) {
      targetX = parts[0];
      targetY = parts[1];
    }
  }

  if (win && typeof win.get_frame_rect === "function") {
    const rect = win.get_frame_rect();
    let newX = rect.x;
    let newY = rect.y;

    if (targetX !== null && targetY !== null) {
      newX = targetX;
      newY = targetY;
    } else {
      if (dir === "left") newX -= step;
      else if (dir === "right") newX += step;
      else if (dir === "up") newY -= step;
      else if (dir === "down") newY += step;
    }

    if (typeof win.move_frame === "function") {
      win.move_frame(true, newX, newY);
    } else if (typeof win.move_resize_frame === "function") {
      win.move_resize_frame(true, newX, newY, rect.width, rect.height);
    }

    return {
      success: true,
      message: `Moved window to (${newX}, ${newY})`,
      newRect: { x: newX, y: newY, width: rect.width, height: rect.height },
    };
  }

  // CLI fallback command generator
  let cliCmd = "";
  if (dir === "left" || dir === "right" || dir === "up" || dir === "down") {
    cliCmd = `i3-msg move ${dir} || swaymsg move ${dir} || hyprctl dispatch movewindow ${dir[0]} || xdotool key Super+Shift+${dir}`;
  } else if (targetX !== null && targetY !== null) {
    cliCmd = `xdotool windowmove $(xdotool getactivewindow) ${targetX} ${targetY} || wmctrl -r :ACTIVE: -e 0,${targetX},${targetY},-1,-1`;
  } else {
    cliCmd = `xdotool windowmove $(xdotool getactivewindow) 100 100`;
  }

  return {
    success: true,
    message: `Move window command generated: ${dir || "custom"}`,
    cliCommand: cliCmd,
  };
}

/**
 * Resize window.
 * @param {string|object} actionOrSize "grow"|"shrink" or {width, height} or "w,h"
 * @param {number|string} [windowIdOrTitle]
 * @param {object} [display]
 * @param {number} [step=100]
 * @returns {{ success: boolean, message: string, newRect?: object, cliCommand?: string }}
 */
export function resizeWindow(actionOrSize, windowIdOrTitle = null, display = null, step = 100) {
  const win = findWindow(display, windowIdOrTitle);
  let action = typeof actionOrSize === "string" ? actionOrSize.toLowerCase().trim() : "";
  let targetW = null, targetH = null;

  if (typeof actionOrSize === "object" && actionOrSize !== null) {
    targetW = actionOrSize.width;
    targetH = actionOrSize.height;
  } else if (action.includes(",")) {
    const parts = action.split(",").map((p) => parseInt(p.trim(), 10));
    if (!isNaN(parts[0]) && !isNaN(parts[1])) {
      targetW = parts[0];
      targetH = parts[1];
    }
  }

  if (win && typeof win.get_frame_rect === "function") {
    const rect = win.get_frame_rect();
    let newW = rect.width;
    let newH = rect.height;

    if (targetW !== null && targetH !== null) {
      newW = Math.max(100, targetW);
      newH = Math.max(100, targetH);
    } else {
      if (action === "grow" || action === "expand" || action === "+") {
        newW += step;
        newH += step;
      } else if (action === "shrink" || action === "contract" || action === "-") {
        newW = Math.max(100, newW - step);
        newH = Math.max(100, newH - step);
      } else if (action === "grow-width") {
        newW += step;
      } else if (action === "shrink-width") {
        newW = Math.max(100, newW - step);
      } else if (action === "grow-height") {
        newH += step;
      } else if (action === "shrink-height") {
        newH = Math.max(100, newH - step);
      }
    }

    if (typeof win.move_resize_frame === "function") {
      win.move_resize_frame(true, rect.x, rect.y, newW, newH);
    }

    return {
      success: true,
      message: `Resized window to ${newW}x${newH}`,
      newRect: { x: rect.x, y: rect.y, width: newW, height: newH },
    };
  }

  let cliCmd = "";
  if (action === "grow" || action === "shrink") {
    const dir = action === "grow" ? "grow 10 px or 10 ppt" : "shrink 10 px or 10 ppt";
    cliCmd = `i3-msg resize ${dir} || swaymsg resize ${dir} || hyprctl dispatch resizeactive ${action === "grow" ? "100 100" : "-100 -100"}`;
  } else if (targetW !== null && targetH !== null) {
    cliCmd = `xdotool windowsize $(xdotool getactivewindow) ${targetW} ${targetH} || wmctrl -r :ACTIVE: -e 0,-1,-1,${targetW},${targetH}`;
  } else {
    cliCmd = `xdotool windowsize $(xdotool getactivewindow) 800 600`;
  }

  return {
    success: true,
    message: `Resize window command generated: ${action || "custom"}`,
    cliCommand: cliCmd,
  };
}

/**
 * Tile window into presets.
 * @param {string} preset "left"|"right"|"top"|"bottom"|"top-left"|"top-right"|"bottom-left"|"bottom-right"|"maximize"|"unmaximize"|"center"
 * @param {number|string} [windowIdOrTitle]
 * @param {object} [display]
 * @param {object} [screenBounds={x:0, y:0, width:1920, height:1080}]
 * @returns {{ success: boolean, message: string, newRect?: object, cliCommand?: string }}
 */
export function tileWindow(preset = "left", windowIdOrTitle = null, display = null, screenBounds = { x: 0, y: 0, width: 1920, height: 1080 }) {
  const win = findWindow(display, windowIdOrTitle);
  const p = (preset || "left").toLowerCase().trim();

  let workArea = { ...screenBounds };
  if (win && typeof win.get_workspace === "function") {
    const ws = win.get_workspace();
    if (ws && typeof ws.get_work_area_for_monitor === "function" && typeof win.get_monitor === "function") {
      const area = ws.get_work_area_for_monitor(win.get_monitor());
      if (area) workArea = { x: area.x, y: area.y, width: area.width, height: area.height };
    }
  }

  if (win) {
    if (p === "maximize") {
      if (typeof win.maximize === "function" && Meta) {
        win.maximize(Meta.MaximizeFlags.BOTH);
      }
      return { success: true, message: `Maximized window` };
    } else if (p === "unmaximize") {
      if (typeof win.unmaximize === "function" && Meta) {
        win.unmaximize(Meta.MaximizeFlags.BOTH);
      }
      return { success: true, message: `Unmaximized window` };
    }

    if (typeof win.unmaximize === "function" && Meta && typeof win.get_maximized === "function" && win.get_maximized() !== 0) {
      win.unmaximize(Meta.MaximizeFlags.BOTH);
    }

    const halfW = Math.floor(workArea.width / 2);
    const halfH = Math.floor(workArea.height / 2);

    let targetRect = { x: workArea.x, y: workArea.y, width: halfW, height: workArea.height };

    switch (p) {
      case "left":
      case "left-half":
        targetRect = { x: workArea.x, y: workArea.y, width: halfW, height: workArea.height };
        break;
      case "right":
      case "right-half":
        targetRect = { x: workArea.x + halfW, y: workArea.y, width: halfW, height: workArea.height };
        break;
      case "top":
      case "top-half":
        targetRect = { x: workArea.x, y: workArea.y, width: workArea.width, height: halfH };
        break;
      case "bottom":
      case "bottom-half":
        targetRect = { x: workArea.x, y: workArea.y + halfH, width: workArea.width, height: halfH };
        break;
      case "top-left":
        targetRect = { x: workArea.x, y: workArea.y, width: halfW, height: halfH };
        break;
      case "top-right":
        targetRect = { x: workArea.x + halfW, y: workArea.y, width: halfW, height: halfH };
        break;
      case "bottom-left":
        targetRect = { x: workArea.x, y: workArea.y + halfH, width: halfW, height: halfH };
        break;
      case "bottom-right":
        targetRect = { x: workArea.x + halfW, y: workArea.y + halfH, width: halfW, height: halfH };
        break;
      case "center":
        targetRect = {
          x: workArea.x + Math.floor(workArea.width / 4),
          y: workArea.y + Math.floor(workArea.height / 4),
          width: halfW,
          height: halfH,
        };
        break;
    }

    if (typeof win.move_resize_frame === "function") {
      win.move_resize_frame(true, targetRect.x, targetRect.y, targetRect.width, targetRect.height);
    }

    return {
      success: true,
      message: `Tiled window to preset '${p}' (${targetRect.width}x${targetRect.height} at ${targetRect.x},${targetRect.y})`,
      newRect: targetRect,
    };
  }

  let cliCmd = "";
  if (p === "left" || p === "right" || p === "top" || p === "bottom") {
    cliCmd = `wmctrl -r :ACTIVE: -b remove,maximized_vert,maximized_horz && i3-msg split h || swaymsg split h || hyprctl dispatch togglefloating`;
  } else if (p === "maximize") {
    cliCmd = `wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz || i3-msg fullscreen toggle || swaymsg fullscreen toggle`;
  } else {
    cliCmd = `wmctrl -r :ACTIVE: -b remove,maximized_vert,maximized_horz`;
  }

  return {
    success: true,
    message: `Tile window command generated for preset '${p}'`,
    cliCommand: cliCmd,
  };
}

/**
 * Switch workspace or move window to workspace.
 * @param {string|number} target "next"|"prev"|number or "move:next"|"move:prev"|"move:N"
 * @param {number|string} [windowIdOrTitle]
 * @param {object} [display]
 * @returns {{ success: boolean, message: string, activeWorkspace?: number, cliCommand?: string }}
 */
export function switchWorkspace(target, windowIdOrTitle = null, display = null) {
  const wsMgr = globalThis.global ? globalThis.global.workspace_manager : null;
  const targetStr = String(target).toLowerCase().trim();
  const isMove = targetStr.startsWith("move:");
  const cleanTarget = isMove ? targetStr.replace("move:", "").trim() : targetStr;

  if (wsMgr && typeof wsMgr.get_n_workspaces === "function") {
    const numWs = wsMgr.get_n_workspaces();
    const currentIdx = wsMgr.get_active_workspace_index();
    let targetIdx = currentIdx;

    if (cleanTarget === "next" || cleanTarget === "right") {
      targetIdx = Math.min(numWs - 1, currentIdx + 1);
    } else if (cleanTarget === "prev" || cleanTarget === "previous" || cleanTarget === "left") {
      targetIdx = Math.max(0, currentIdx - 1);
    } else if (!isNaN(parseInt(cleanTarget, 10))) {
      const idx = parseInt(cleanTarget, 10);
      // Support 1-based indexing if idx > 0 and <= numWs
      targetIdx = (idx > 0 && idx <= numWs) ? idx - 1 : Math.max(0, Math.min(numWs - 1, idx));
    }

    const win = findWindow(display, windowIdOrTitle);
    if (isMove && win && typeof win.change_workspace_by_index === "function") {
      win.change_workspace_by_index(targetIdx, true);
    }

    const targetWs = typeof wsMgr.get_workspace_by_index === "function" ? wsMgr.get_workspace_by_index(targetIdx) : null;
    if (targetWs && typeof targetWs.activate === "function") {
      const timestamp = globalThis.global && globalThis.global.get_current_time ? globalThis.global.get_current_time() : 0;
      targetWs.activate(timestamp);
    }

    return {
      success: true,
      message: `${isMove ? "Moved window & switched" : "Switched"} to workspace ${targetIdx + 1}`,
      activeWorkspace: targetIdx + 1,
    };
  }

  let cliCmd = "";
  if (cleanTarget === "next") {
    cliCmd = `wmctrl -s $(($(xdotool get_desktop) + 1)) || i3-msg workspace next || swaymsg workspace next || hyprctl dispatch workspace e+1`;
  } else if (cleanTarget === "prev" || cleanTarget === "previous") {
    cliCmd = `wmctrl -s $(($(xdotool get_desktop) - 1)) || i3-msg workspace prev || swaymsg workspace prev || hyprctl dispatch workspace e-1`;
  } else if (!isNaN(parseInt(cleanTarget, 10))) {
    const num = parseInt(cleanTarget, 10);
    cliCmd = `wmctrl -s ${num - 1} || xdotool set_desktop ${num - 1} || i3-msg workspace number ${num} || swaymsg workspace number ${num} || hyprctl dispatch workspace ${num}`;
  } else {
    cliCmd = `xdotool set_desktop 0`;
  }

  return {
    success: true,
    message: `Switch workspace command generated for '${target}'`,
    cliCommand: cliCmd,
  };
}

/**
 * Generates ASCII and formatted visual window preview of active desktop layout.
 * @param {Array<object>} [windowsList]
 * @param {number} [screenWidth=1920]
 * @param {number} [screenHeight=1080]
 * @param {object} [options={}]
 * @returns {string} Visual window layout text diagram
 */
export function generateWindowPreview(windowsList = null, screenWidth = 1920, screenHeight = 1080, options = {}) {
  const windows = windowsList || getWindowsList();

  if (!windows || windows.length === 0) {
    return [
      "╔════════════════════════════════════════════════════════════╗",
      "║                DESKTOP WINDOW PREVIEW                      ║",
      "╠════════════════════════════════════════════════════════════╣",
      "║               (No open windows detected)                   ║",
      "╚════════════════════════════════════════════════════════════╝",
    ].join("\n");
  }

  const gridCols = options.cols || 60;
  const gridRows = options.rows || 14;

  const grid = Array.from({ length: gridRows }, () => Array(gridCols).fill(" "));

  for (let c = 0; c < gridCols; c++) {
    grid[0][c] = "═";
    grid[gridRows - 1][c] = "═";
  }
  for (let r = 0; r < gridRows; r++) {
    grid[r][0] = "║";
    grid[r][gridCols - 1] = "║";
  }
  grid[0][0] = "╔";
  grid[0][gridCols - 1] = "╗";
  grid[gridRows - 1][0] = "╚";
  grid[gridRows - 1][gridCols - 1] = "╝";

  const titleStr = " Desktop Window Layout ";
  const startCol = Math.floor((gridCols - titleStr.length) / 2);
  for (let i = 0; i < titleStr.length; i++) {
    grid[0][startCol + i] = titleStr[i];
  }

  windows.forEach((win, index) => {
    const rect = win.rect || { x: 0, y: 0, width: screenWidth / 2, height: screenHeight };
    const normX = Math.max(1, Math.min(gridCols - 2, Math.floor((rect.x / screenWidth) * (gridCols - 2)) + 1));
    const normY = Math.max(1, Math.min(gridRows - 2, Math.floor((rect.y / screenHeight) * (gridRows - 2)) + 1));
    const normW = Math.max(8, Math.min(gridCols - normX - 1, Math.floor((rect.width / screenWidth) * (gridCols - 2))));
    const normH = Math.max(3, Math.min(gridRows - normY - 1, Math.floor((rect.height / screenHeight) * (gridRows - 2))));

    const endX = normX + normW - 1;
    const endY = normY + normH - 1;

    for (let c = normX; c <= endX; c++) {
      grid[normY][c] = "-";
      grid[endY][c] = "-";
    }
    for (let r = normY; r <= endY; r++) {
      grid[r][normX] = "|";
      grid[r][endX] = "|";
    }
    grid[normY][normX] = "+";
    grid[normY][endX] = "+";
    grid[endY][normX] = "+";
    grid[endY][endX] = "+";

    const focusMarker = win.focused ? "*" : "";
    const winLabel = `${focusMarker}#${index + 1}:${(win.wmClass || win.title || "Win").slice(0, Math.max(1, normW - 4))}`;
    for (let i = 0; i < winLabel.length && (normX + 1 + i) < endX; i++) {
      if (normY + 1 < endY) {
        grid[normY + 1][normX + 1 + i] = winLabel[i];
      }
    }
  });

  const gridStr = grid.map((row) => row.join("")).join("\n");

  const details = windows.map((win, idx) => {
    const focusStr = win.focused ? "[ACTIVE]" : "        ";
    const r = win.rect || { x: 0, y: 0, width: 0, height: 0 };
    return ` #${idx + 1} ${focusStr} ${win.title.padEnd(24).slice(0, 24)} | Workspace: ${win.workspace + 1} | Geometry: ${r.width}x${r.height}+${r.x}+${r.y}`;
  }).join("\n");

  return `${gridStr}\n\nWindow Details:\n${details}`;
}

/**
 * Execute command string if it's a window management command.
 * @param {string} commandStr
 * @param {object} [options]
 * @returns {{ isWindowCmd: boolean, result?: object }}
 */
export function executeWindowCommand(commandStr, options = {}) {
  if (!commandStr || typeof commandStr !== "string") {
    return { isWindowCmd: false };
  }

  const clean = commandStr.trim();
  if (!clean.startsWith("cmdbar:window:") && !clean.startsWith("window:")) {
    return { isWindowCmd: false };
  }

  const parts = clean.replace(/^cmdbar:window:|^window:/, "").trim().split(/\s+/);
  const action = (parts[0] || "").toLowerCase();
  const param = parts.slice(1).join(" ");

  let res = null;
  switch (action) {
    case "close":
      res = closeWindow(param, options.display);
      break;
    case "move":
      res = moveWindow(param || "left", options.windowId, options.display);
      break;
    case "resize":
      res = resizeWindow(param || "grow", options.windowId, options.display);
      break;
    case "tile":
      res = tileWindow(param || "left", options.windowId, options.display);
      break;
    case "workspace":
    case "switch-workspace":
      res = switchWorkspace(param || "next", options.windowId, options.display);
      break;
    case "preview":
    case "list":
      res = {
        success: true,
        message: "Visual Window Preview generated",
        preview: generateWindowPreview(options.windowsList),
      };
      break;
    default:
      res = { success: false, message: `Unknown window action '${action}'` };
      break;
  }

  return { isWindowCmd: true, result: res };
}
