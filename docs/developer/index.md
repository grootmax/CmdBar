# CmdBar Developer Specifications

This directory contains internal technical specifications and architectural notes for contributors.

## Extension Lifecycle & Architecture

The architecture of CmdBar is designed around modular components to maintain safety, speed, and cross-desktop compatibility:
1. **The GNOME Shell Extension (JavaScript / GJS)**: Direct interaction with the GNOME UI. Runs inside the shell's single-threaded event loop. Keep operations as non-blocking as possible.
2. **The KDE Plasma Plasmoid & Integration Modules (QML / JS / Python)**: Native Plasmoid applet (`kde-plasma/`), System Tray StatusNotifierItem (`extension/systemTray.js`), KWin shortcut manager (`extension/kwinIntegration.js`), KWallet client (`extension/kwalletClient.js`), and Plasma theme adapter (`extension/plasmaTheme.js`).
3. **The Companion App & D-Bus Services (Python)**: Handles disk operations, custom subprocess spawning, D-Bus service bridging (`org.gnome.CmdBar` and `org.kde.CmdBar`), and configuration updates.

### GNOME Shell 46+ Native API Modernization

CmdBar targets GNOME Shell 46 and 47 directly without legacy runtime fallback branches:
- **Widget Layout & Alignment**: All UI widgets (`St.BoxLayout`, `St.Label`, menu items) use standard GNOME Shell 46 layout properties (`style_class`, `vertical: true/false`, `y_align: Clutter.ActorAlign.CENTER`, `x_expand: true`).
- **Symbolic System Icons**: All indicators, category headers, command menu items, and confirmation dialogs instantiate symbolic icons using standard `St.Icon` with `icon_name` property.
- **Path Resolution & Filesystem Operations**: Installation root path resolution uses native `Gio.File` handle methods (`Extension.dir.get_path()`). Directory creation uses `make_directory_with_parents(null)` sync API, file moves use `move_finish(res)` without array destructuring, and `Gio` imports handle `giModule.default` for GNOME Shell 46+ compatibility.

### KDE Plasma 5 & 6 Native Support

CmdBar provides complete KDE Plasma desktop integration:
- **Plasmoid Applet**: Native QML Plasmoid with compact (system tray/panel icon) and full (menu popup, argument dialog, search box) representations (`kde-plasma/contents/ui/main.qml`).
- **KWallet Integration**: Secure secret storage via `org.kde.kwalletd5` / `org.kde.kwalletd6` for LLM API keys and sensitive tokens.
- **KWin Shortcut Binds**: Global shortcut triggers registered via KGlobalAccel (`org.kde.kglobalaccel`) and active window context extraction from KWin (`org.kde.KWin`).
- **Plasma Theme Sync**: Extracts system color schemes (Breeze Light / Breeze Dark) from `kdeglobals` and maps them to UI elements and output syntax highlighting.

### Output Parser & Formatter Module

The output parser module (`extension/outputFormatter.js`) automatically detects and formats command outputs:
- **Format Auto-Detection**: Detects JSON, CSV, TSV, Code, and plain text formats automatically.
- **JSON Pretty-Printing & Syntax Highlighting**: Formats raw JSON strings with configurable indentation, Pango markup syntax highlighting for GNOME Shell labels, and ANSI color codes.
- **Table View**: Parses CSV/TSV data into aligned ASCII tables with column dividers.
- **Code Blocks**: Formats code snippets in monospaced boxed blocks or `<font face="monospace">` Pango markup.

