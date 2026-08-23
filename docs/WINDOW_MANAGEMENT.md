# Window Management Commands

CmdBar includes full window control and management capabilities across GNOME Shell (Meta / Mutter) and tiling WMs (i3, Sway, Hyprland, xdotool, wmctrl).

## Core Capabilities

- **Window Control Actions**:
  - **Tile Window Left / Right / Top / Bottom**: Tile active window to 50% screen split.
  - **Quarter Tiling**: Tile windows to `top-left`, `top-right`, `bottom-left`, `bottom-right`.
  - **Maximize / Restore**: Toggle window maximization or restore.
  - **Center Window**: Center active window on screen at 70% scale.
  - **Close Active Window**: Safely close active window (`wm:close`).
  - **Switch Workspace**: Navigate between workspaces (`wm:workspace-next`, `wm:workspace-prev`, `wm:switch-workspace <N>`).
  - **Move Window to Workspace**: Transfer active window to workspace `<N>`.
  - **Resize Window**: Grow or shrink active window geometry (`wm:resize-grow`, `wm:resize-shrink`).

## Keyboard Shortcuts Integration

Default window management shortcuts:
- `<Super><Alt>Left`: Tile Window Left
- `<Super><Alt>Right`: Tile Window Right
- `<Super><Alt>Up`: Maximize Window
- `<Super><Alt>c`: Close Active Window
- `<Super><Alt>Page_Down`: Switch Workspace Next
- `<Super><Alt>Page_Up`: Switch Workspace Previous

## Visual Window Preview

- **Tile Overlay Preview**: Visual highlight box rendered on screen before or during tile actions.
- **Window Preview Cards**: Window switcher preview cards in CmdBar palette showing active window class, title, workspace index, geometry, and SVG preview frame.

## Multi-WM Compatibility

CmdBar automatically detects the active desktop environment / window manager:
1. **GNOME Shell**: Native `Meta` & `global.display` API integration.
2. **i3 / Sway**: Native `i3-msg` / `swaymsg` IPC commands.
3. **Hyprland**: Native `hyprctl dispatch` commands.
4. **Generic X11 / Wayland**: `wmctrl` and `xdotool` fallbacks.
