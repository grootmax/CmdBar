# CmdBar User Guide

Welcome to CmdBar! CmdBar is a modern command palette for GNOME Shell and KDE Plasma that puts your most-used commands right in your system status bar and panel.

## Getting Started

### GNOME Shell
1. **Install the extension**: Run `make install` inside the repository.
2. **Restart GNOME Shell**: Press `Alt + F2`, type `r`, and press Enter (or log out and back in on Wayland).
3. **Configure your commands**: Edit `commands.json` or use our companion management app.
4. **Access your commands**: Click the indicator on your GNOME top-bar and choose a command!

### KDE Plasma
1. **Install the Plasmoid**: Run `make install-plasma` inside the repository.
2. **Add Widget**: Right-click panel → **Add Widgets...** → Drag **CmdBar** to panel or system tray.
3. **Shortcut**: Use `Meta+Space` to trigger the CmdBar menu globally.

## Core Features

- **GNOME Shell & KDE Plasma Support**: Native top-bar extension for GNOME and Plasmoid widget / system tray integration for KDE Plasma.
- **KWallet Integration**: Secure API key and secret storage for LLM prompts and tokens.
- **KWin Shortcut Binds**: Global shortcut triggers and active window context extraction.
- **Dynamic Menu**: Fully driven by JSON config files.
- **Clipboard History**: Integrated command palette clipboard manager tracking up to 50 entries with search, pinning, clear history, and click-to-paste functionality.
- **Support for Arguments**: Interactive dialogs for commands requiring user parameters.
- **Local Live Reload**: Configuration changes sync instantly.

