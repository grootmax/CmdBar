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

### Command Security Policy Engine Specification

The Security Policy Engine (`extension/commandPolicy.js` and `app/policy_manager.py`) evaluates execution eligibility for commands before process invocation:

1. **Policy Evaluation Priority**:
   - **Active Override Token**: Valid override tokens skip policy evaluation and permit execution.
   - **User & Group Rules**: Evaluates scoped `deny` or `allow` rules matching the user/group context.
   - **Blacklist Filter**: Rejects command if matching blacklisted patterns in `blacklist` or `combined` modes.
   - **Whitelist Filter**: Rejects command if not matching whitelisted patterns in `whitelist` or `combined` modes.

2. **Pattern Matching Engine**:
   - `globToRegex(pattern)`: Converts wildcards (`*`, `?`) to regexes.
   - `matchPattern(cmd, pattern)`: Handles exact, glob, `regex:`, and binary prefix matching.

3. **Approval Request Lifecycle**:
   - `requestApproval(commandStr, requesterContext, reason)`: Instantiates request object with unique ID.
   - `approveRequest(requestId, approverContext, ttlMs)`: Issues time-bound `token_appr_*` token.
   - `rejectRequest(requestId, approverContext, reason)`: Marks request rejected.
   - `grantOverride(commandPattern, approverContext, ttlMs)`: Directly issues `token_dir_*` token for command pattern.

