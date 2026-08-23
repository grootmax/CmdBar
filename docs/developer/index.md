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

## Standardized Command Confirmation Guardrails

CmdBar enforces execution safety across desktop GUI and CLI execution paths using consistent confirmation guardrails:

- **Verification Status Check**: Before spawning any subprocess, the system checks whether the command is explicitly marked as `verified: true`.
- **Shared Dialog Utilities**: Unverified commands trigger a modal confirmation prompt (`Adw.MessageDialog` in desktop GUI or interactive prompt in CLI).
- **Token Evaluation & Redaction**: Parameter values are evaluated via `tokenize_and_substitute` and sensitive arguments (passwords, tokens, secrets) are redacted in confirmation previews using `get_preview_tokens`.
- **Immediate Cancellation**: Cancelling the confirmation prompt prevents process creation and halts command execution immediately.

