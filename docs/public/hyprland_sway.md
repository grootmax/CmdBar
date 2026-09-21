# Hyprland & Sway Integration Guide

CmdBar provides native Wayland JSON protocol support and tiling-aware integrations for Hyprland, Sway, and i3 compositors.

## Key Capabilities

- **Native JSON IPC Protocol**: Directly communicates over UNIX domain sockets (`$HYPRLAND_INSTANCE_SIGNATURE`, `$SWAYSOCK`, `$I3SOCK`) without extra dependencies.
- **Tiling-Aware Context Injection**: Commands can use dynamic placeholders:
  - `{active_window_title}`: Title of currently focused window.
  - `{active_window_class}`: Class or app_id of focused window.
  - `{active_workspace}`: Current active workspace name or ID.
  - `{compositor}`: Detected compositor name (`hyprland`, `sway`, `i3`, or `gnome`).
- **Floating Layout Rules**: Ensures CmdBar popups float cleanly over tiled windows.

## Window Rules Setup

To make CmdBar companion popups float and center cleanly in tiling environments:

### Hyprland Configuration (`~/.config/hypr/hyprland.conf`)

```ini
windowrulev2 = float, class:^(cmdbar|CmdBar)$
windowrulev2 = center, class:^(cmdbar|CmdBar)$
windowrulev2 = pin, class:^(cmdbar|CmdBar)$
```

### Sway / i3 Configuration (`~/.config/sway/config` or `~/.config/i3/config`)

```swayconfig
for_window [app_id="cmdbar"] floating enable, move position center
for_window [class="CmdBar"] floating enable, move position center
```

## Companion CLI WM Commands

Inspect tiling state and rules using the companion app:

- `cmdbar-companion --wm-info`: Display JSON protocol dump of active window, workspaces, outputs, and compositor mode.
- `cmdbar-companion --wm-rules`: Output recommended Hyprland and Sway window rules.
- `cmdbar-companion --exec-wm "<COMMAND>"`: Execute command with active tiling context injected.
