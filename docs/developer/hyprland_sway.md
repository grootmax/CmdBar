# Tiling WM Architecture & IPC Specification

CmdBar's tiling window manager module (`companion/tiling_wm.py`) implements low-level, zero-dependency IPC client protocols for Hyprland and Sway/i3.

## Protocol Architecture

### Hyprland Socket IPC (`HyprlandIPC`)
- Communicates via UNIX domain socket at `$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket.sock`.
- Sends `j/` prefixed request strings (e.g. `j/activewindow`, `j/workspaces`, `j/monitors`) to receive raw JSON responses.
- Dispatches commands via `dispatch <dispatcher> <args>`.
- Gracefully falls back to `hyprctl -j` CLI if socket is unavailable.

### Sway / i3 Binary IPC (`SwayIPC`)
- Communicates via UNIX domain socket at `$SWAYSOCK` or `$I3SOCK`.
- Implements 14-byte binary framing protocol:
  - Magic bytes: `i3-ipc` (6 bytes)
  - Payload length: uint32 (4 bytes, little-endian)
  - Message type: uint32 (4 bytes, little-endian)
- Supported message types:
  - `0`: `IPC_RUN_COMMAND`
  - `1`: `IPC_GET_WORKSPACES`
  - `3`: `IPC_GET_OUTPUTS`
  - `4`: `IPC_GET_TREE`
- Gracefully falls back to `swaymsg -t <type> -r` or `i3-msg -t <type>` CLI.

### Unified Manager (`TilingWMManager`)
- Normalizes active window, workspace, and monitor structures into unified JSON format.
- Computes floating popup window geometries (`calculate_floating_geometry`).
- Injects workspace and active window context into command template strings (`execute_command_with_context`).
