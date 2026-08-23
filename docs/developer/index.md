# CmdBar Developer Specifications

This directory contains internal technical specifications and architectural notes for contributors.

## Extension Lifecycle & Architecture

The architecture of CmdBar is designed around two main components to maintain safety and speed:
1. **The GNOME Shell Extension (JavaScript / GJS)**: Direct interaction with the GNOME UI. Runs inside the shell's single-threaded event loop. Keep operations as non-blocking as possible.
2. **The Companion App (Python)**: Handles disk operations, custom subprocess spawning, and configuration updates.

### Command Audit Logging Architecture

Command execution audit logging is implemented in `extension/auditLogger.js` (for GNOME Shell) and `companion/audit_logger.py` / `app/audit_logger.py` (for the Python companion utilities).
- **Log Location**: Defaults to `~/.local/share/cmdbar/audit.log` (respects `XDG_DATA_HOME` and `CMDBAR_AUDIT_LOG_PATH` override).
- **Log Format**: JSON line entries recording `timestamp` (ISO 8601), `user`, `command`, `exit_code`, and `duration_ms` / `duration`.
- **Daily Rotation**: Checks file modification date upon append; if the file belongs to a prior calendar day (`YYYY-MM-DD`), rotates the file to `audit.log.YYYY-MM-DD`.
- **Privacy Mode**: When `privacy_mode` is active in GSettings or configuration settings, commands containing sensitive keywords (e.g. `password`, `secret`, `token`, `sudo`) or parameter schemas marked with `secure: true` are excluded from the log.

### GNOME Shell 46+ Native API Modernization

CmdBar targets GNOME Shell 46 and 47 directly without legacy runtime fallback branches:
- **Widget Layout & Alignment**: All UI widgets (`St.BoxLayout`, `St.Label`, menu items) use standard GNOME Shell 46 layout properties (`style_class`, `vertical: true/false`, `y_align: Clutter.ActorAlign.CENTER`, `x_expand: true`).
- **Symbolic System Icons**: All indicators, category headers, command menu items, and confirmation dialogs instantiate symbolic icons using standard `St.Icon` with `icon_name` property.
- **Path Resolution & Filesystem Operations**: Installation root path resolution uses native `Gio.File` handle methods (`Extension.dir.get_path()`). Directory creation uses `make_directory_with_parents(null)` sync API, file moves use `move_finish(res)` without array destructuring, and `Gio` imports handle `giModule.default` for GNOME Shell 46+ compatibility.
