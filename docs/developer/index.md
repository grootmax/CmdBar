# CmdBar Developer Specifications

This directory contains internal technical specifications and architectural notes for contributors.

## Extension Lifecycle & Architecture

The architecture of CmdBar is designed around two main components to maintain safety and speed:
1. **The GNOME Shell Extension (JavaScript / GJS)**: Direct interaction with the GNOME UI. Runs inside the shell's single-threaded event loop. Keep operations as non-blocking as possible.
2. **The Companion App (Python)**: Handles disk operations, custom subprocess spawning, and configuration updates.

### GNOME Shell 46+ Native API Modernization

CmdBar targets GNOME Shell 46 and 47 directly without legacy runtime fallback branches:
- **Widget Layout & Alignment**: All UI widgets (`St.BoxLayout`, `St.Label`, menu items) use standard GNOME Shell 46 layout properties (`style_class`, `orientation`, `y_align: Clutter.ActorAlign.CENTER`, `x_expand: true`).
- **Symbolic System Icons**: All indicators, category headers, command menu items, and confirmation dialogs instantiate symbolic icons using standard `St.Icon` with `icon_name` property.
- **Path Resolution**: Installation root path resolution uses native `Gio.File` handle methods (`Extension.dir.get_path()`) to load initial configuration templates.

### Inline Command Output & Executor-Style Menu Items

`CommandMenuItem` supports displaying command status directly inside the menu item:
- **Output Field**: An optional `St.Label` displays the last line of command output or summary status, truncated to a maximum of 50 characters.
- **Configurable Periodic Update**: Commands can define `interval` or `refreshInterval` in seconds or milliseconds to trigger asynchronous updates via `GLib.timeout_add`.
- **Status Color-Coding**: Colors indicate process state: green (`cmdbar-output-success`) for exit code 0, red (`cmdbar-output-error`) for errors, and gray (`cmdbar-output-running`) while executing.
- **One-Click Refresh**: A dedicated refresh `St.Button` (`view-refresh-symbolic`) allows manual on-demand execution status updates without closing the menu.
