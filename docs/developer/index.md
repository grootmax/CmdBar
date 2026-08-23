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

### Shared Audit Trail & Compliance Module

The audit trail module (`extension/auditTrail.js`) provides security logging and enterprise compliance:
- **Shared Audit Trail**: Tamper-evident SHA-256 hash chaining over JSON audit logs for team activity.
- **GDPR Compliance**: Automatic PII scrubbing for emails, IP addresses, tokens, and API keys, plus data retention purging and user anonymization.
- **Anomaly Detection Engine**: Rule-based detection for execution bursts, failure spikes, dangerous shell commands, AI prompt injections, and log tampering.
- **Compliance Reports**: Generates compliance reports mapped to SOC2, ISO27001, GDPR, and HIPAA frameworks in JSON, HTML, Markdown, and CSV formats.
- **SIEM Export**: Exports structured logs to Syslog (RFC 5424), Splunk HEC, Elastic ECS, Datadog, and CEF formats.
- **Real-Time Alerts**: AlertManager with deduplication cooldown windows, system desktop notifications, and webhook dispatching.

