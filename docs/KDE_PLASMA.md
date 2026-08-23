# CmdBar KDE Plasma Integration Guide

CmdBar provides first-class native integration for **KDE Plasma 5 & 6**, featuring a panel Plasmoid applet, StatusNotifierItem system tray icon, KWin global keyboard shortcut bindings, KWallet secret management, and KDE Plasma Breeze theme adaptation.

---

## Key Features

1. **Native Plasmoid Widget**: Fits seamlessly into KDE Plasma panels or desktop layouts. Offers compact mode (icon + status badge) and full popup representation (search bar, categories, copy to clipboard, parameter dialog, and output console).
2. **System Tray Integration**: Full StatusNotifierItem (`org.kde.StatusNotifierItem`) support with status indicator states (`Active`, `Passive`, `NeedsAttention`), tooltips, context menu, and desktop notifications (`notify-send`).
3. **KWin Integration**: Global keyboard shortcut registration via KGlobalAccel (`Meta+Space` default). Extracts active window context (`windowClass`, `windowTitle`, `pid`, `desktop`) for contextual commands.
4. **KWallet Key Storage**: Integrates with `org.kde.kwalletd5` / `org.kde.kwalletd6` to securely store LLM API keys (OpenAI, Anthropic, Ollama) and sensitive command tokens in the `CmdBar` wallet folder.
5. **Plasma Breeze Theme Sync**: Dynamically syncs colors (Breeze Light / Breeze Dark) with system palette (`KColorScheme` / `~/.config/kdeglobals`), applying matching background, text, highlight, and syntax highlighting colors.

---

## Installation & Setup

### 1. Install System Prerequisites

On Ubuntu / Kubuntu 24.04+ or KDE Neon:
```bash
sudo apt update
sudo apt install -y plasma-widgets-addons kwalletcli qdbus-qt5 python3-pip
```

### 2. Install the Plasmoid Widget

Run the Makefile target or install using `kpackagetool5`:
```bash
make install-plasma
```

Or manually:
```bash
kpackagetool5 -t Plasma/Applet -i kde-plasma/
```

### 3. Add CmdBar to Plasma Panel or System Tray

1. Right-click on your KDE Plasma panel → **Add Widgets...**
2. Search for **CmdBar**.
3. Drag and drop **CmdBar** onto your panel or system tray.
4. Press `Meta+Space` (or your configured shortcut) to open CmdBar from anywhere!

---

## Architecture Overview

- **`kde-plasma/`**: QML Plasmoid applet structure (`metadata.json`, `contents/ui/main.qml`, `contents/ui/ConfigGeneral.qml`, `contents/code/cmdbar_plasma.js`).
- **`extension/`**: JavaScript modules (`kwalletClient.js`, `kwinIntegration.js`, `systemTray.js`, `plasmaTheme.js`).
- **`companion/kde_plasma/`**: Python companion modules (`kwallet.py`, `kwin.py`, `system_tray.py`, `theme.py`, `service.py`).
- **D-Bus Service**: `org.kde.CmdBar` exposing methods for command execution, shortcut registration, KWallet secrets, and window context.
