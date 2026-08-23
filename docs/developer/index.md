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

## Mobile Companion Architecture

The Mobile Companion App module (`companion/mobile_companion.py` & `companion/mobileSync.js`) enables secure cross-platform synchronization between CmdBar host instances and iOS/Android companion devices:
- **Device Pairing & Management**: Pair iOS and Android devices, store device tokens, and manage push tokens securely.
- **Biometric Authentication**: Time-bound challenge/response protocol using HMAC signatures for Face ID, Touch ID, Android Biometrics, or PIN verification before sensitive command execution. Single-use nonces prevent replay attacks.
- **Quick Actions**: Configurable shortcuts for iOS Home Screen Quick Actions (`UIApplicationShortcutItem`) and Android App Shortcuts (`ShortcutInfo`).
- **Widget Support**: Serves structured widget state data payloads tailored for iOS WidgetKit (`TimelineEntry`) and Android App Widgets (`RemoteViews`).
- **Push Notifications**: Generates and dispatches APNs (iOS) and FCM (Android) push notification payloads for command execution alerts, status changes, and output summaries.
- **Offline Action Queue**: Asynchronous offline action queue allowing mobile devices to queue commands when disconnected, batch synchronize on reconnect, track execution statuses, and handle retries on failure.

