# CmdBar Developer Specifications

This directory contains internal technical specifications and architectural notes for contributors.

## Extension Lifecycle & Architecture

The architecture of CmdBar is designed around two main components to maintain safety and speed:
1. **The GNOME Shell Extension (JavaScript / GJS)**: Direct interaction with the GNOME UI. Runs inside the shell's single-threaded event loop. Keep operations as non-blocking as possible.
2. **The Companion App (Python)**: Handles disk operations, custom subprocess spawning, and configuration updates.

### GNOME Shell 46+ Native API Modernization

CmdBar targets GNOME Shell 46 and 47 directly without legacy runtime fallback branches:
- **Widget Layout & Alignment**: All UI widgets (`St.BoxLayout`, `St.Label`, menu items) use standard GNOME Shell 46 layout properties (`style_class`, `vertical: true/false`, `y_align: Clutter.ActorAlign.CENTER`, `x_expand: true`).
- **Symbolic System Icons**: All indicators, category headers, command menu items, and confirmation dialogs instantiate symbolic icons using standard `St.Icon` with `icon_name` property.
- **Path Resolution & Filesystem Operations**: Installation root path resolution uses native `Gio.File` handle methods (`Extension.dir.get_path()`). Directory creation uses `make_directory_with_parents(null)` sync API, file moves use `move_finish(res)` without array destructuring, and `Gio` imports handle `giModule.default` for GNOME Shell 46+ compatibility.

### Output Parser & Formatter Module

The output parser module (`extension/outputFormatter.js`) automatically detects and formats command outputs:
- **Format Auto-Detection**: Detects JSON, CSV, TSV, Code, and plain text formats automatically.
- **JSON Pretty-Printing & Syntax Highlighting**: Formats raw JSON strings with configurable indentation, Pango markup syntax highlighting for GNOME Shell labels, and ANSI color codes.
- **Table View**: Parses CSV/TSV data into aligned ASCII tables with column dividers.
- **Code Blocks**: Formats code snippets in monospaced boxed blocks or `<font face="monospace">` Pango markup.

### Wayland Native & Tiling Window Manager Integration

The Wayland module (`companion/wayland.py`) enables native operation across Hyprland, Sway, i3, and generic Wayland compositors:
- **Compositor IPC Abstraction**: Queries active window and workspace metadata via `hyprctl -j activewindow` (Hyprland), `swaymsg -t get_tree` (Sway), or `i3-msg -t get_tree` (i3).
- **Tiling-Aware Context Injection**: Exposes active window context (`{active_window}`, `{active_class}`, `{workspace}`, `{compositor}`, `{floating}`) as dynamic parameters for command template substitution.
- **Floating Window Rules**: Automates floating window rule application for dialogs in Hyprland, Sway, and i3.
- **JSON IPC Protocol Server**: High-performance Unix domain socket server (`cmdbar.sock`) supporting `ping`, `get_config`, `list_categories`, `list_commands`, `search`, `execute`, `ai_translate`, `get_tiling_context`, `set_floating`, `copy_to_clipboard`, and `paste_from_clipboard`.
- **Launcher Integration**: Native launcher support for `wofi`, `rofi`, `fuzzel`, and `dmenu`.
