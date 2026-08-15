# CmdBar Developer Specifications

This directory contains internal technical specifications and architectural notes for contributors.

## Extension Lifecycle & Architecture

The architecture of CmdBar is designed around two main components to maintain safety and speed:
1. **The GNOME Shell Extension (JavaScript / GJS)**: Direct interaction with the GNOME UI. Runs inside the shell's single-threaded event loop. Keep operations as non-blocking as possible.
2. **The Companion App (Python)**: Handles disk operations, custom subprocess spawning, and configuration updates.

### Extension Methods

- `init()`: Called once when the extension is loaded by GNOME.
- `enable()`: Called when the extension is toggled on. Sets up the top-bar indicator panel and binds listeners.
- `disable()`: Called when the extension is toggled off or uninstalled. Clean up all UI elements, listeners, and intervals!
