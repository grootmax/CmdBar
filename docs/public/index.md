# CmdBar User Guide

Welcome to CmdBar! CmdBar is a modern GNOME Shell extension and companion app that puts your most-used commands right in your system status area.

## Getting Started

1. **Install the extension**: Run `make install` inside the repository.
2. **Restart GNOME Shell**: Press `Alt + F2`, type `r`, and press Enter (or log out and back in on Wayland).
3. **Configure your commands**: Edit `commands.json`, use our GTK companion app, or launch the **Web Dashboard** (`make dashboard` or `python3 scripts/serve_dashboard.py`).
4. **Access your commands**: Click the indicator on your GNOME top-bar and choose a command!

## Core Features

- **Web Dashboard**: Interactive web UI with drag-and-drop category & command editor, real-time top-bar preview, team collaboration workspace profiles, mobile responsiveness, and PWA offline capability.
- **Dynamic Menu**: Fully driven by JSON config files.
- **Clipboard History**: Integrated command palette clipboard manager tracking up to 50 entries with search, pinning, clear history, and click-to-paste functionality.
- **Support for Arguments**: Interactive dialogs for commands requiring user parameters.
- **Local Live Reload**: Configuration changes sync instantly across desktop and web environments.

## Web Dashboard Usage

Start the web dashboard server:
```bash
make dashboard
# or
python3 scripts/serve_dashboard.py --port 8080
```
Open your browser at `http://localhost:8080` to access:
- **Drag-and-Drop Editor**: Easily reorder commands and categories.
- **Real-Time Preview**: Live GNOME top-bar simulation with search matching.
- **Team Collaboration**: Export, import, and merge team configurations with conflict resolution.
- **Offline Capable**: Works offline via Progressive Web App (PWA) Service Worker caching.
