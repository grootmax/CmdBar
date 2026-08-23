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

### Numeric Keypad Shortcuts & Macro Pad Module

The Numpad Macro Pad module (`extension/numpadManager.js`) transforms physical 10-key numeric keypads into dedicated macro controllers:
- **Instant Key Execution**: 10 instant command shortcuts (`KP_0` through `KP_9` with modifier binding `Super+KP_*`).
- **Configurable Multi-Layer Pads**: Unlimited macro pad layers (e.g. Default, Gaming, Dev) defined in `config.json` with active layer selection.
- **Visual Overlay HUD**: A centered modal HUD dialog rendering a 3x4 Numpad tile layout showing key numbers, labels, command previews, and active layer tabs. Triggered via `Super+KP_Multiply` shortcut or D-Bus API.
- **Layer Switching**: Rapid layer cycling via `Super+KP_Divide` shortcut, visual overlay controls, or D-Bus method `SetActiveNumpadLayer`.
- **D-Bus Integration**: Exposes `GetNumpadLayers`, `SetActiveNumpadLayer`, `ExecuteNumpadKey`, `ToggleNumpadOverlay` and signal `NumpadLayerChanged` for external tool automation.

