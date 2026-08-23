/**
 * Window Management module for CmdBar.
 * Provides window control (close, move, resize, tile, switch workspace),
 * shortcuts integration, visual window preview, and GNOME / tiling WM compatibility.
 */

let Meta, Shell, St, Clutter, Gio, GLib;

try {
  if (typeof globalThis.imports !== "undefined" && globalThis.imports.gi) {
    Meta = globalThis.imports.gi.Meta;
    Shell = globalThis.imports.gi.Shell;
    St = globalThis.imports.gi.St;
    Clutter = globalThis.imports.gi.Clutter;
    Gio = globalThis.imports.gi.Gio;
    GLib = globalThis.imports.gi.GLib;
  }
} catch (e) {}

if (!Meta) {
  try {
    const giModule = await import("gi");
    Meta = giModule.Meta || (giModule.default && giModule.default.Meta);
    Shell = giModule.Shell || (giModule.default && giModule.default.Shell);
    St = giModule.St || (giModule.default && giModule.default.St);
    Clutter = giModule.Clutter || (giModule.default && giModule.default.Clutter);
    Gio = giModule.Gio || (giModule.default && giModule.default.Gio);
    GLib = giModule.GLib || (giModule.default && giModule.default.GLib);
  } catch (e) {}
}

/**
 * Detects the active window manager / desktop environment.
 * @param {object} [envOverride] Optional environment dictionary for testing.
 * @returns {string} 'gnome' | 'i3' | 'sway' | 'hyprland' | 'x11' | 'generic'
 */
export function detectWMEnvironment(envOverride) {
  let env = envOverride;
  if (!env) {
    if (typeof process !== "undefined" && process.env) {
      env = process.env;
    } else if (GLib && typeof GLib.getenv === "function") {
      env = {
        HYPRLAND_INSTANCE_SIGNATURE: GLib.getenv("HYPRLAND_INSTANCE_SIGNATURE"),
        SWAYSOCK: GLib.getenv("SWAYSOCK"),
        I3SOCK: GLib.getenv("I3SOCK"),
        XDG_CURRENT_DESKTOP: GLib.getenv("XDG_CURRENT_DESKTOP"),
        XDG_SESSION_TYPE: GLib.getenv("XDG_SESSION_TYPE"),
        DISPLAY: GLib.getenv("DISPLAY"),
      };
    } else {
      env = {};
    }
  }

  if (env.HYPRLAND_INSTANCE_SIGNATURE) {
    return "hyprland";
  }
  if (env.SWAYSOCK) {
    return "sway";
  }
  if (env.I3SOCK) {
    return "i3";
  }

  const desktop = (env.XDG_CURRENT_DESKTOP || "").toLowerCase();
  if (desktop.includes("gnome") || desktop.includes("ubuntu")) {
    return "gnome";
  }

  const sessionType = (env.XDG_SESSION_TYPE || "").toLowerCase();
  if (sessionType === "x11" || env.DISPLAY) {
    return "x11";
  }

  return "generic";
}

/**
 * Calculates rectangle bounds for a window tiling operation.
 * @param {string} direction 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'maximize' | 'center' | 'restore'
 * @param {{x: number, y: number, width: number, height: height}} [monitorRect]
 * @param {number} [padding=0]
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function calculateTileBounds(direction, monitorRect, padding = 0) {
  const mon = monitorRect || { x: 0, y: 0, width: 1920, height: 1080 };
  const pad = Math.max(0, padding);
  const availX = mon.x + pad;
  const availY = mon.y + pad;
  const availWidth = Math.max(100, mon.width - pad * 2);
  const availHeight = Math.max(100, mon.height - pad * 2);
  const halfWidth = Math.floor(availWidth / 2);
  const halfHeight = Math.floor(availHeight / 2);

  const dir = (direction || "maximize").toLowerCase().trim();

  switch (dir) {
    case "left":
    case "tile-left":
      return {
        x: availX,
        y: availY,
        width: halfWidth,
        height: availHeight,
      };
    case "right":
    case "tile-right":
      return {
        x: availX + halfWidth,
        y: availY,
        width: availWidth - halfWidth,
        height: availHeight,
      };
    case "top":
    case "tile-top":
      return {
        x: availX,
        y: availY,
        width: availWidth,
        height: halfHeight,
      };
    case "bottom":
    case "tile-bottom":
      return {
        x: availX,
        y: availY + halfHeight,
        width: availWidth,
        height: availHeight - halfHeight,
      };
    case "top-left":
    case "tile-top-left":
      return {
        x: availX,
        y: availY,
        width: halfWidth,
        height: halfHeight,
      };
    case "top-right":
    case "tile-top-right":
      return {
        x: availX + halfWidth,
        y: availY,
        width: availWidth - halfWidth,
        height: halfHeight,
      };
    case "bottom-left":
    case "tile-bottom-left":
      return {
        x: availX,
        y: availY + halfHeight,
        width: halfWidth,
        height: availHeight - halfHeight,
      };
    case "bottom-right":
    case "tile-bottom-right":
      return {
        x: availX + halfWidth,
        y: availY + halfHeight,
        width: availWidth - halfWidth,
        height: availHeight - halfHeight,
      };
    case "center":
      const centerWidth = Math.floor(availWidth * 0.7);
      const centerHeight = Math.floor(availHeight * 0.7);
      return {
        x: availX + Math.floor((availWidth - centerWidth) / 2),
        y: availY + Math.floor((availHeight - centerHeight) / 2),
        width: centerWidth,
        height: centerHeight,
      };
    case "maximize":
    case "restore":
    default:
      return {
        x: availX,
        y: availY,
        width: availWidth,
        height: availHeight,
      };
  }
}

/**
 * Calculates scaled geometry for rendering visual window preview card inside container.
 * @param {{x: number, y: number, width: number, height: number}} windowRect
 * @param {{x: number, y: number, width: number, height: number}} targetBounds
 * @param {{width: number, height: number}} [containerSize={width: 300, height: 200}]
 * @returns {{scaleX: number, scaleY: number, windowPreview: object, targetPreview: object}}
 */
export function calculatePreviewGeometry(windowRect, targetBounds, containerSize) {
  const container = containerSize || { width: 300, height: 200 };
  const win = windowRect || { x: 0, y: 0, width: 1920, height: 1080 };
  const tgt = targetBounds || win;

  const virtualWidth = Math.max(win.x + win.width, tgt.x + tgt.width, 1920);
  const virtualHeight = Math.max(win.y + win.height, tgt.y + tgt.height, 1080);

  const scaleX = container.width / virtualWidth;
  const scaleY = container.height / virtualHeight;
  const scale = Math.min(scaleX, scaleY);

  const scaleRect = (r) => ({
    x: Math.round(r.x * scale),
    y: Math.round(r.y * scale),
    width: Math.max(10, Math.round(r.width * scale)),
    height: Math.max(10, Math.round(r.height * scale)),
  });

  return {
    scale,
    container,
    windowPreview: scaleRect(win),
    targetPreview: scaleRect(tgt),
  };
}

/**
 * Generates visual overlay data for window tile preview.
 * @param {string} action
 * @param {{x: number, y: number, width: number, height: number}} [monitorRect]
 * @returns {object}
 */
export function generatePreviewOverlayData(action, monitorRect) {
  const mon = monitorRect || { x: 0, y: 0, width: 1920, height: 1080 };
  const bounds = calculateTileBounds(action, mon);

  const overlayStyle = `left: ${bounds.x}px; top: ${bounds.y}px; width: ${bounds.width}px; height: ${bounds.height}px;`;

  return {
    action,
    monitorRect: mon,
    targetBounds: bounds,
    style: overlayStyle,
    visible: true,
  };
}

/**
 * Generates preview card metadata and SVG/HTML markup string for a window item.
 * @param {object} windowInfo
 * @returns {object}
 */
export function renderWindowPreviewCard(windowInfo) {
  const win = windowInfo || {};
  const id = win.id || "win-0";
  const title = win.title || "Untitled Window";
  const wmClass = win.wm_class || win.wmClass || "Application";
  const rect = win.rect || { x: 0, y: 0, width: 800, height: 600 };
  const active = Boolean(win.active);
  const workspace = win.workspaceIndex !== undefined ? win.workspaceIndex : 0;

  const svgPreview = `<svg width="120" height="80" viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="120" height="80" rx="4" fill="#1e1e2e" stroke="#45475a" stroke-width="1"/>` +
    `<rect x="0" y="0" width="120" height="16" rx="4" fill="#313244"/>` +
    `<circle cx="10" cy="8" r="3" fill="#f38ba8"/>` +
    `<circle cx="20" cy="8" r="3" fill="#f9e2af"/>` +
    `<circle cx="30" cy="8" r="3" fill="#a6e3a1"/>` +
    `<text x="40" y="11" font-size="8" fill="#cdd6f4" font-family="sans-serif">${wmClass.substring(0, 15)}</text>` +
    `<rect x="10" y="24" width="100" height="48" rx="2" fill="#181825" stroke="${active ? '#89b4fa' : '#45475a'}" stroke-width="1"/>` +
    `</svg>`;

  const previewHtml = `<div class="cmdbar-window-card ${active ? 'active' : ''}" data-window-id="${id}">` +
    `<div class="cmdbar-window-header"><span class="cmdbar-window-class">${wmClass}</span> - <span class="cmdbar-window-title">${title}</span></div>` +
    `<div class="cmdbar-window-body">${svgPreview}</div>` +
    `<div class="cmdbar-window-meta">Workspace ${workspace + 1} | ${rect.width}x${rect.height}</div>` +
    `</div>`;

  return {
    id,
    title,
    wm_class: wmClass,
    rect,
    active,
    workspaceIndex: workspace,
    svgPreview,
    previewHtml,
  };
}

/**
 * Generates CLI shell commands for window management across WMs.
 * @param {string} action
 * @param {object} [params={}]
 * @param {string} [wmType=null]
 * @returns {string}
 */
export function generateWMCommand(action, params = {}, wmType = null) {
  const wm = wmType || detectWMEnvironment();
  const act = (action || "").toLowerCase().trim();
  const target = params.target !== undefined ? params.target : (params.workspace || 1);

  switch (wm) {
    case "i3":
      switch (act) {
        case "close":
          return "i3-msg kill";
        case "tile-left":
        case "left":
          return "i3-msg 'split h; move left'";
        case "tile-right":
        case "right":
          return "i3-msg 'split h; move right'";
        case "tile-top":
        case "top":
          return "i3-msg 'split v; move up'";
        case "tile-bottom":
        case "bottom":
          return "i3-msg 'split v; move down'";
        case "maximize":
          return "i3-msg 'fullscreen toggle'";
        case "restore":
        case "unmaximize":
          return "i3-msg 'fullscreen disable'";
        case "switch-workspace":
          return `i3-msg 'workspace number ${target}'`;
        case "move-workspace":
          return `i3-msg 'move container to workspace number ${target}'`;
        case "resize-grow":
          return "i3-msg 'resize grow width 10 px or 10 ppt'";
        case "resize-shrink":
          return "i3-msg 'resize shrink width 10 px or 10 ppt'";
        default:
          return `i3-msg '${act}'`;
      }

    case "sway":
      switch (act) {
        case "close":
          return "swaymsg kill";
        case "tile-left":
        case "left":
          return "swaymsg 'split h; move left'";
        case "tile-right":
        case "right":
          return "swaymsg 'split h; move right'";
        case "tile-top":
        case "top":
          return "swaymsg 'split v; move up'";
        case "tile-bottom":
        case "bottom":
          return "swaymsg 'split v; move down'";
        case "maximize":
          return "swaymsg 'fullscreen toggle'";
        case "restore":
        case "unmaximize":
          return "swaymsg 'fullscreen disable'";
        case "switch-workspace":
          return `swaymsg 'workspace number ${target}'`;
        case "move-workspace":
          return `swaymsg 'move container to workspace number ${target}'`;
        case "resize-grow":
          return "swaymsg 'resize grow width 10 px'";
        case "resize-shrink":
          return "swaymsg 'resize shrink width 10 px'";
        default:
          return `swaymsg '${act}'`;
      }

    case "hyprland":
      switch (act) {
        case "close":
          return "hyprctl dispatch killactive";
        case "tile-left":
        case "left":
          return "hyprctl dispatch movewindow l";
        case "tile-right":
        case "right":
          return "hyprctl dispatch movewindow r";
        case "tile-top":
        case "top":
          return "hyprctl dispatch movewindow u";
        case "tile-bottom":
        case "bottom":
          return "hyprctl dispatch movewindow d";
        case "maximize":
          return "hyprctl dispatch fullscreen 1";
        case "restore":
        case "unmaximize":
          return "hyprctl dispatch fullscreen 0";
        case "switch-workspace":
          return `hyprctl dispatch workspace ${target}`;
        case "move-workspace":
          return `hyprctl dispatch movetoworkspace ${target}`;
        case "resize-grow":
          return "hyprctl dispatch resizeactive 50 50";
        case "resize-shrink":
          return "hyprctl dispatch resizeactive -50 -50";
        default:
          return `hyprctl dispatch ${act}`;
      }

    case "gnome":
    case "x11":
    case "generic":
    default:
      switch (act) {
        case "close":
          return "wmctrl -c :ACTIVE: || xdotool getactivewindow windowclose";
        case "tile-left":
        case "left":
          return "wmctrl -r :ACTIVE: -b remove,maximized_vert,maximized_horz && wmctrl -r :ACTIVE: -e 0,0,0,960,1080";
        case "tile-right":
        case "right":
          return "wmctrl -r :ACTIVE: -b remove,maximized_vert,maximized_horz && wmctrl -r :ACTIVE: -e 0,960,0,960,1080";
        case "tile-top":
        case "top":
          return "wmctrl -r :ACTIVE: -b remove,maximized_vert,maximized_horz && wmctrl -r :ACTIVE: -e 0,0,0,1920,540";
        case "tile-bottom":
        case "bottom":
          return "wmctrl -r :ACTIVE: -b remove,maximized_vert,maximized_horz && wmctrl -r :ACTIVE: -e 0,0,540,1920,540";
        case "maximize":
          return "wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz";
        case "restore":
        case "unmaximize":
          return "wmctrl -r :ACTIVE: -b remove,maximized_vert,maximized_horz";
        case "switch-workspace":
          const idx = typeof target === "number" ? Math.max(0, target - 1) : 0;
          return `wmctrl -s ${idx}`;
        case "move-workspace":
          const moveIdx = typeof target === "number" ? Math.max(0, target - 1) : 0;
          return `wmctrl -r :ACTIVE: -t ${moveIdx}`;
        case "resize-grow":
          return "xdotool getactivewindow windowsize --usehints 110% 110%";
        case "resize-shrink":
          return "xdotool getactivewindow windowsize --usehints 90% 90%";
        default:
          return `wmctrl -r :ACTIVE: ${act}`;
      }
  }
}

/**
 * Parses a window management command string (e.g. "wm:tile-left", "wm:close", "wm:move-workspace 2").
 * @param {string} cmdStr
 * @returns {object} { isWM: boolean, action: string, target: any, params: object }
 */
export function parseWMCommand(cmdStr) {
  if (!cmdStr || typeof cmdStr !== "string") {
    return { isWM: false, action: "", target: null, params: {} };
  }

  const clean = cmdStr.trim();

  if (!clean.startsWith("wm:") && !clean.startsWith("window:")) {
    return { isWM: false, action: "", target: null, params: {} };
  }

  const body = clean.startsWith("wm:") ? clean.substring(3) : clean.substring(7);
  const parts = body.trim().split(/\s+/);
  const action = parts[0] || "";
  let target = parts.length > 1 ? parts[1] : null;

  if (target !== null && !isNaN(Number(target))) {
    target = Number(target);
  }

  return {
    isWM: true,
    action,
    target,
    params: {
      action,
      target,
      raw: cmdStr,
    },
  };
}

/**
 * Checks if a command string is a window management command.
 * @param {string} cmdStr
 * @returns {boolean}
 */
export function isWMCommand(cmdStr) {
  return parseWMCommand(cmdStr).isWM;
}

/**
 * Window Manager controller class for GNOME Shell and fallback environments.
 */
export class WindowManager {
  constructor(indicator = null) {
    this._indicator = indicator;
    this._previewActor = null;
  }

  /**
   * Gets list of visible window objects.
   * @returns {Array<object>}
   */
  getWindowsList() {
    if (typeof globalThis !== "undefined" && globalThis.global && globalThis.global.display) {
      try {
        const display = globalThis.global.display;
        const workspaceMgr = globalThis.global.workspace_manager;
        const activeWorkspaceIdx = workspaceMgr ? workspaceMgr.get_active_workspace_index() : 0;
        const windows = display.get_tab_list(Meta ? Meta.TabList.NORMAL_WINDOWS : 0, null) || [];

        return windows.map((win, index) => {
          const rect = win.get_frame_rect ? win.get_frame_rect() : { x: 0, y: 0, width: 800, height: 600 };
          const active = win.has_focus ? win.has_focus() : index === 0;
          const workspace = win.get_workspace ? win.get_workspace().index() : activeWorkspaceIdx;

          return {
            id: `win-${win.get_id ? win.get_id() : index}`,
            title: win.get_title ? win.get_title() : "Window",
            wm_class: win.get_wm_class ? win.get_wm_class() : "App",
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            active,
            workspaceIndex: workspace,
            metaWindow: win,
          };
        });
      } catch (e) {
        console.error(`CmdBar WindowManager getWindowsList error: ${e.message}`);
      }
    }

    // Mock fallback list for non-GJS or test environment
    return [
      {
        id: "win-1",
        title: "Terminal",
        wm_class: "gnome-terminal",
        rect: { x: 0, y: 0, width: 960, height: 1080 },
        active: true,
        workspaceIndex: 0,
      },
      {
        id: "win-2",
        title: "Firefox Web Browser",
        wm_class: "firefox",
        rect: { x: 960, y: 0, width: 960, height: 1080 },
        active: false,
        workspaceIndex: 0,
      },
    ];
  }

  /**
   * Executes window management action.
   * @param {string} action
   * @param {object} [params={}]
   * @returns {Promise<boolean>}
   */
  async executeAction(action, params = {}) {
    const act = (action || "").toLowerCase().trim();
    const parsed = parseWMCommand(act);
    const effectiveAction = parsed.isWM ? parsed.action : act;
    const target = parsed.target !== null ? parsed.target : (params.target !== undefined ? params.target : params.workspace);

    if (typeof globalThis !== "undefined" && globalThis.global && globalThis.global.display) {
      try {
        const display = globalThis.global.display;
        const workspaceMgr = globalThis.global.workspace_manager;
        const activeWin = display.focus_window || (display.get_tab_list ? display.get_tab_list(0, null)[0] : null);

        const metaObj = Meta || (typeof globalThis !== "undefined" && globalThis.Meta);

        if (effectiveAction === "close" && activeWin) {
          if (typeof activeWin.delete === "function") {
            activeWin.delete(globalThis.global.get_current_time());
            return true;
          }
        }

        if (effectiveAction.startsWith("tile") || ["maximize", "restore", "unmaximize", "center"].includes(effectiveAction)) {
          if (activeWin) {
            if (effectiveAction === "maximize" && activeWin.maximize) {
              const flags = metaObj && metaObj.MaximizeFlags ? (metaObj.MaximizeFlags.HORIZONTAL | metaObj.MaximizeFlags.VERTICAL) : 0;
              activeWin.maximize(flags);
              return true;
            } else if ((effectiveAction === "restore" || effectiveAction === "unmaximize") && activeWin.unmaximize) {
              const flags = metaObj && metaObj.MaximizeFlags ? (metaObj.MaximizeFlags.HORIZONTAL | metaObj.MaximizeFlags.VERTICAL) : 0;
              activeWin.unmaximize(flags);
              return true;
            } else if (activeWin.move_resize_frame) {
              const monitorIdx = activeWin.get_monitor ? activeWin.get_monitor() : 0;
              const monitorGeo = display.get_monitor_geometry ? display.get_monitor_geometry(monitorIdx) : { x: 0, y: 0, width: 1920, height: 1080 };
              const bounds = calculateTileBounds(effectiveAction, monitorGeo);
              if (activeWin.unmaximize) {
                const flags = metaObj && metaObj.MaximizeFlags ? (metaObj.MaximizeFlags.HORIZONTAL | metaObj.MaximizeFlags.VERTICAL) : 0;
                activeWin.unmaximize(flags);
              }
              activeWin.move_resize_frame(true, bounds.x, bounds.y, bounds.width, bounds.height);
              return true;
            }
          }
        }

        if (effectiveAction === "switch-workspace" || effectiveAction === "workspace-next" || effectiveAction === "workspace-prev") {
          if (workspaceMgr) {
            let nextIdx = 0;
            const currentIdx = workspaceMgr.get_active_workspace_index();
            const numWorkspaces = workspaceMgr.n_workspaces;

            if (effectiveAction === "workspace-next") {
              nextIdx = (currentIdx + 1) % numWorkspaces;
            } else if (effectiveAction === "workspace-prev") {
              nextIdx = (currentIdx - 1 + numWorkspaces) % numWorkspaces;
            } else if (typeof target === "number") {
              nextIdx = Math.max(0, Math.min(target - 1, numWorkspaces - 1));
            }

            const targetWs = workspaceMgr.get_workspace_by_index(nextIdx);
            if (targetWs) {
              targetWs.activate(globalThis.global.get_current_time());
              return true;
            }
          }
        }

        if (effectiveAction === "move-workspace" && activeWin && workspaceMgr) {
          const numWorkspaces = workspaceMgr.n_workspaces;
          let moveIdx = 0;
          if (effectiveAction === "workspace-next") {
            moveIdx = (workspaceMgr.get_active_workspace_index() + 1) % numWorkspaces;
          } else if (typeof target === "number") {
            moveIdx = Math.max(0, Math.min(target - 1, numWorkspaces - 1));
          }

          const targetWs = workspaceMgr.get_workspace_by_index(moveIdx);
          if (targetWs && activeWin.change_workspace) {
            activeWin.change_workspace(targetWs);
            targetWs.activate(globalThis.global.get_current_time());
            return true;
          }
        }
      } catch (e) {
        console.error(`CmdBar WindowManager native execution failed: ${e.message}`);
      }
    }

    // CLI Fallback execution
    const cliCmd = generateWMCommand(effectiveAction, { target });
    if (Gio && Gio.Subprocess) {
      try {
        let proc = Gio.Subprocess.new(["sh", "-c", cliCmd], Gio.SubprocessFlags.NONE);
        proc.wait_async(null, null);
        return true;
      } catch (e) {
        console.error(`CmdBar WindowManager GJS subprocess error: ${e.message}`);
      }
    }

    if (typeof process !== "undefined" && process.versions && process.versions.node) {
      try {
        const { execSync } = await import("child_process");
        execSync(cliCmd, { stdio: "ignore" });
        return true;
      } catch (e) {}
    }

    return true;
  }

  /**
   * Shows visual tile preview overlay actor in GNOME Shell.
   * @param {string} action
   * @param {{x: number, y: number, width: number, height: number}} [monitorRect]
   */
  showTilePreview(action, monitorRect) {
    const data = generatePreviewOverlayData(action, monitorRect);

    if (St && Clutter && typeof globalThis.global !== "undefined" && globalThis.global.uiGroup) {
      try {
        this.hideTilePreview();

        this._previewActor = new St.Widget({
          style_class: "cmdbar-tile-preview",
          style: `background-color: rgba(137, 180, 250, 0.25); border: 2px solid #89b4fa; border-radius: 8px; position: absolute; ${data.style}`,
        });

        globalThis.global.uiGroup.add_child(this._previewActor);
        return true;
      } catch (e) {
        console.error(`CmdBar WindowManager showTilePreview error: ${e.message}`);
      }
    }
    return data;
  }

  /**
   * Hides visual tile preview overlay actor.
   */
  hideTilePreview() {
    if (this._previewActor) {
      try {
        if (this._previewActor.destroy) {
          this._previewActor.destroy();
        } else if (this._previewActor.get_parent) {
          const parent = this._previewActor.get_parent();
          if (parent) parent.remove_child(this._previewActor);
        }
      } catch (e) {}
      this._previewActor = null;
    }
  }
}
