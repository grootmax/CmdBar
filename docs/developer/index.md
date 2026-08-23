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

### Screenshot & Screen Capture Module (`extension/screenshotManager.js`)

The screenshot manager module provides screen capture, image editing, metadata stripping, and URL sharing capabilities:
- **Capture Modes**: Fullscreen, Window, and Region modes (`captureScreenshot`, `captureMode`).
- **Destinations**: Save to filesystem (default `~/Pictures/Screenshots`), copy to system clipboard, or both.
- **Annotations**: Supports text overlays, shapes (rectangles, arrows, highlights), blur/redact areas, and cropping (`applyAnnotations`).
- **Metadata Removal**: Strips EXIF chunks and headers (tEXt, zTXt, iTXt, tIME, pHYs, eXIf in PNG; APP1 / COM in JPEG) before saving or sharing (`stripMetadata`).
- **URL Sharing**: Uploads screenshot data to URL endpoints and returns share links (`shareScreenshotUrl`).
- **Configurable Shortcuts**: Default accelerators (`Super+Shift+3`, `Super+Shift+4`, `Super+Shift+5`) managed via `getScreenshotShortcuts` and `setScreenshotShortcut`.
- **D-Bus API Integration**: Exposes `CaptureScreenshot(s mode, s saveTo, s optionsJson)` and emits signal `ScreenshotCaptured(s filePath, s shareUrl, b success)` on `org.gnome.CmdBar`.

