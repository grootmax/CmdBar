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

### Enterprise Custom Branding & White Label

CmdBar provides a full enterprise white labeling option allowing organizations to rebrand the extension and companion application:
- **Brand Application Name & Identity**: Replaces default "CmdBar" branding with organization application name (`app_name`), custom logo/icon (`logo_path`), and enterprise identity (`organization_name`, `support_url`, `footer_text`).
- **Brand Theme Colors**: Dynamic custom color overrides for primary (`brand_colors.primary`), accent, background, and text colors applied dynamically to GNOME Shell status area UI widgets and popup menus.
- **Domain Alias & Network Routing**: Resolves custom server endpoints (`domain_alias`) for enterprise sync, command feeds, and remote management endpoints (`getEffectiveDomainUrl`).
- **Custom SSL Security**: Supports custom enterprise SSL certificates (`cert_path`), private keys (`key_path`), and CA certificate bundles (`ca_path`) with configurable SSL verification options (`get_ssl_context`).
- **D-Bus Management API**: Exposes `GetBranding`, `SetBranding`, and `GetEffectiveAppName` over D-Bus (`org.gnome.CmdBar`) for automated corporate software deployment tools.
