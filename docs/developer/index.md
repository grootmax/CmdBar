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

## Cloud Services Integration

CmdBar provides built-in modules for AWS, GCP, and Azure to list cloud infrastructure resources as dynamic command parameters:
- **AWS**: EC2 instances, S3 buckets, Lambda functions.
- **GCP**: GCE VM instances, Cloud Run services.
- **Azure**: Virtual Machines, Function Apps.
- **Credential Management**: Reads credentials from environment variables (`AWS_PROFILE`, `GOOGLE_APPLICATION_CREDENTIALS`, `AZURE_SUBSCRIPTION_ID`), user configuration, or CLI auth sessions.
- **Caching Layer**: Caches discovered resources locally in `~/.config/cmdbar/cloud_cache.json` with configurable TTL (default: 300s).

