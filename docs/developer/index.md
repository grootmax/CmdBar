# CmdBar Developer Specifications

This directory contains internal technical specifications and architectural notes for contributors.

## Extension Lifecycle & Architecture

The architecture of CmdBar is designed around three main components to maintain safety, speed, and flexibility:
1. **The GNOME Shell Extension (JavaScript / GJS)**: Direct interaction with the GNOME UI. Runs inside the shell's single-threaded event loop. Keep operations as non-blocking as possible.
2. **The Companion App (Python)**: Handles disk operations, custom subprocess spawning, and configuration updates.
3. **The Web Dashboard (HTML5/CSS3/JS + Python HTTP Server)**: Web-based configuration management system with drag-and-drop editor, real-time preview, team collaboration workspace merge engine, mobile responsiveness, and PWA offline capability.

### GNOME Shell 46+ Native API Modernization

CmdBar targets GNOME Shell 46 and 47 directly without legacy runtime fallback branches:
- **Widget Layout & Alignment**: All UI widgets (`St.BoxLayout`, `St.Label`, menu items) use standard GNOME Shell 46 layout properties (`style_class`, `vertical: true/false`, `y_align: Clutter.ActorAlign.CENTER`, `x_expand: true`).
- **Symbolic System Icons**: All indicators, category headers, command menu items, and confirmation dialogs instantiate symbolic icons using standard `St.Icon` with `icon_name` property.
- **Path Resolution & Filesystem Operations**: Installation root path resolution uses native `Gio.File` handle methods (`Extension.dir.get_path()`). Directory creation uses `make_directory_with_parents(null)` sync API, file moves use `move_finish(res)` without array destructuring, and `Gio` imports handle `giModule.default` for GNOME Shell 46+ compatibility.

### Web Dashboard Architecture & REST API

The Web Dashboard (`companion/dashboard_server.py`, `scripts/serve_dashboard.py`, `dashboard/`) provides full web UI configuration control:
- **REST API Endpoints**:
  - `GET /api/config`: Reads local `config.json` with cryptographic signature verification.
  - `POST /api/config`: Validates layout against schema, writes atomically to `config.json` and syncs `commands.json`.
  - `GET /api/status`: Returns system health and offline readiness.
  - `POST /api/preview`: Renders command parameter dry-run resolution.
  - `POST /api/collaboration/merge`: Performs 2-way structural merge of local and team configs.
  - `GET /api/events`: Server-Sent Events (SSE) stream for real-time collaboration updates across clients.
- **Security Protections**:
  - Path traversal checks on static asset requests.
  - Cross-Origin POST protection enforcing origin/X-Requested-With verification.
  - Strict input schema validation before writing configuration files.
- **Offline PWA Engine**:
  - Service Worker (`sw.js`) with cache-first and stale-while-revalidate strategies.
  - Web App Manifest (`manifest.json`) for standalone installation.
  - LocalStorage / IndexedDB fallback buffer when disconnected.

### Output Parser & Formatter Module

The output parser module (`extension/outputFormatter.js`) automatically detects and formats command outputs:
- **Format Auto-Detection**: Detects JSON, CSV, TSV, Code, and plain text formats automatically.
- **JSON Pretty-Printing & Syntax Highlighting**: Formats raw JSON strings with configurable indentation, Pango markup syntax highlighting for GNOME Shell labels, and ANSI color codes.
- **Table View**: Parses CSV/TSV data into aligned ASCII tables with column dividers.
- **Code Blocks**: Formats code snippets in monospaced boxed blocks or `<font face="monospace">` Pango markup.
