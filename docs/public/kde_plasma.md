# KDE Plasma Support Guide

CmdBar provides first-class native support for the KDE Plasma desktop environment (Plasma 5 & 6).

## Overview

KDE Plasma integration includes:
- **Native Plasmoid Applet (`org.kde.cmdbar`)**: Add CmdBar directly to your Plasma top panel, system tray, or desktop.
- **System Tray Applet**: Operates via standard `StatusNotifierItem` specification with active status, tooltips, and context menus.
- **KWin Integration**: Managed window positioning, borderless overlay rules, and global hotkeys (`Meta+Space`).
- **KWallet Integration**: Secure API key storage for AI natural language translation using KDE Wallet (`org.kde.kwalletd5` / `org.kde.kwalletd6`).
- **Breeze Theme Palette**: Automatic light and dark mode color scheme detection reading directly from `~/.config/kdeglobals`.

## Installation

```bash
# Install Plasmoid package using Makefile
make install-kde
```

After installation:
1. Right-click on your KDE Plasma panel or desktop.
2. Select **Add Widgets...**.
3. Search for **CmdBar**.
4. Drag and drop the CmdBar applet onto your panel or desktop.
