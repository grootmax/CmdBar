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

### Shared Audit Trail Module

The shared audit trail module (`extension/sharedAuditTrail.js` and `companion/shared_audit_trail.py`) provides enterprise-grade team security auditing:
- **Shared Team Audit Trail**: Aggregates multi-user activity across teams (`teamId`, `workspaceId`, `userId`, `action`, `resource`, `status`, `severity`, `timestamp`, `ipAddress`, `metadata`).
- **Cryptographic Tamper-Evident Hash Chain**: Each audit entry is signed with SHA-256 HMAC linked to the previous entry signature to detect tampering or record deletion.
- **GDPR Privacy & Data Governance**: Automated PII masking for passwords, API keys, bearer tokens, emails, SSNs, and IP addresses. Includes GDPR Right to be Forgotten (`purgeUserData`) for pseudonymization and data retention policy pruning.
- **Compliance Reporting**: Evaluates security controls and exports formal compliance reports for SOC2, ISO27001, GDPR, HIPAA, and PCI-DSS in JSON, CSV, HTML, and Markdown formats.
- **SIEM Export Integration**: Formats and dispatches audit events to SIEM receivers using CEF (Common Event Format), LEEF, Syslog (RFC 5424), Splunk HEC, and Elastic Common Schema (ECS).
- **Security Anomaly Detection & Real-Time Alerts**: Detects threat patterns including failure spikes, off-hours activity, unauthorized privilege escalation attempts, rapid execution velocity, and hash chain tampering with real-time alert callbacks and rate-limiting.
