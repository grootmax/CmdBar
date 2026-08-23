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

### Sandboxed Execution Mode Architecture

CmdBar supports isolated sandboxed execution on a per-command basis:
- **Sandbox Engines**: Supports `bwrap` (Bubblewrap), `flatpak-spawn`, and `firejail`.
- **Security Profiles**:
  - `strict`: Enforces strict read-only system mounts, tmpfs `/tmp` & `/home`, drops capabilities, and unshares networking.
  - `permissive`: Binds host root filesystem while allowing customizable network isolation.
  - `custom`: Explicit user-defined filesystem isolation and network settings.
- **Integration**:
  - JavaScript wrapper (`extension/sandboxWrapper.js`) integrates into GJS execution paths (`runCommandAsync`, `_executeCommandAsync`, `executeCommand`).
  - Python wrapper (`app/sandbox_wrapper.py`) integrates into `app/config_schema.py` (`resolve_command_preview`) and `app/main.py` Libadwaita companion editor.

### Output Parser & Formatter Module

The output parser module (`extension/outputFormatter.js`) automatically detects and formats command outputs:
- **Format Auto-Detection**: Detects JSON, CSV, TSV, Code, and plain text formats automatically.
- **JSON Pretty-Printing & Syntax Highlighting**: Formats raw JSON strings with configurable indentation, Pango markup syntax highlighting for GNOME Shell labels, and ANSI color codes.
- **Table View**: Parses CSV/TSV data into aligned ASCII tables with column dividers.
- **Code Blocks**: Formats code snippets in monospaced boxed blocks or `<font face="monospace">` Pango markup.

### Command Result Caching Architecture

CmdBar supports caching read-only command outputs with TTL logic to eliminate redundant process execution:
- **Command Tagging**: Commands are tagged via `cacheable: true`, `type: "cacheable"`, or explicit `ttl` / `cache_ttl` values in `config.json` or `commands.json`. Untagged commands default to realtime (`cacheable: false`).
- **TTL Logic & Persistence**: Cached outputs (stdout, stderr, exit status, timestamp, TTL) are stored in `CommandCacheStore` and persisted atomically to `~/.config/cmdbar/cache.json`.
- **Manual Cache Refresh**: Menu items for cacheable commands feature a dedicated refresh button (`view-refresh-symbolic`) to force re-executing the process and updating the cache store.
- **Cache Invalidation**: Cache entries can be invalidated individually using `invalidateCommandCache(key)` or purged completely via `clearCommandCache()`. Expired entries are automatically pruned.
