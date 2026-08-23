# CmdBar User Guide

Welcome to CmdBar! CmdBar is a modern GNOME Shell extension and companion app that puts your most-used commands right in your system status area.

## Getting Started

1. **Install the extension**: Run `make install` inside the repository.
2. **Restart GNOME Shell**: Press `Alt + F2`, type `r`, and press Enter (or log out and back in on Wayland).
3. **Configure your commands**: Edit `commands.json` or use our companion management app.
4. **Access your commands**: Click the indicator on your GNOME top-bar and choose a command!

## Core Features

- **Dynamic Menu**: Fully driven by JSON config files.
- **Quick Notes & Scratchpad**: Quick plain-text notes with Markdown support (Pango & HTML rendering), tag organization, fast search, attached executable commands, share links (`cmdbar://note/share?data=...`), and cross-device atomic sync.
- **Clipboard History**: Integrated command palette clipboard manager tracking up to 50 entries with search, pinning, clear history, and click-to-paste functionality.
- **Support for Arguments**: Interactive dialogs for commands requiring user parameters.
- **Local Live Reload**: Configuration changes sync instantly.
