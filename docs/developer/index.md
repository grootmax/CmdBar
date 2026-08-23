# CmdBar Developer Specifications

This directory contains internal technical specifications and architectural notes for contributors.

## Extension Lifecycle & Architecture

The architecture of CmdBar is designed around two main components to maintain safety and speed:
1. **The GNOME Shell Extension (JavaScript / GJS)**: Direct interaction with the GNOME UI. Runs inside the shell's single-threaded event loop. Keep operations as non-blocking as possible.
2. **The Companion App (Python)**: Handles disk operations, custom subprocess spawning, and configuration updates.

### Environment Variable Profiles & Subprocess Spawning

Environment variable profiles allow defining named sets of environment variables (`Production`, `Staging`, `Development`) overlaid onto subprocess execution environments:
- **Profile Resolution & Env Merging**: `getProfiles`, `getProfileEnv`, and `getMergedEnvironment` resolve profile configurations and overlay variables onto base process environments prior to subprocess launching.
- **Subprocess Spawning**: In GJS, subprocesses are launched via `Gio.SubprocessLauncher` with profile variables injected via `launcher.setenv(key, val, true)`. In Python, `Gio.SubprocessLauncher` or `subprocess.Popen(..., env=env)` overlays active profile environment variables.
- **Profile-Specific Command Visibility**: `isCommandVisibleInProfile(cmd, activeProfile)` filters command visibility in top-bar menus based on `cmd.profiles` or `cmd.profile` rules.

CmdBar targets GNOME Shell 46 and 47 directly without legacy runtime fallback branches:
- **Widget Layout & Alignment**: All UI widgets (`St.BoxLayout`, `St.Label`, menu items) use standard GNOME Shell 46 layout properties (`style_class`, `vertical: true/false`, `y_align: Clutter.ActorAlign.CENTER`, `x_expand: true`).
- **Symbolic System Icons**: All indicators, category headers, command menu items, and confirmation dialogs instantiate symbolic icons using standard `St.Icon` with `icon_name` property.
- **Path Resolution & Filesystem Operations**: Installation root path resolution uses native `Gio.File` handle methods (`Extension.dir.get_path()`). Directory creation uses `make_directory_with_parents(null)` sync API, file moves use `move_finish(res)` without array destructuring, and `Gio` imports handle `giModule.default` for GNOME Shell 46+ compatibility.
