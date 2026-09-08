# CmdBar Web Dashboard User Guide

The **CmdBar Web Dashboard** provides an intuitive, web-based graphical interface for managing your command shortcuts, AI configuration, team presets, and live preview dry-runs.

---

## Features Overview

### 1. Web UI Configuration & Drag-and-Drop Editor
- **Drag-and-Drop Reordering**: Drag and drop categories to reorder them in your menu. Drag and drop command cards within a category or between categories to organize actions.
- **Touch-Friendly Layout**: Mobile responsive design automatically adapts to smartphones, tablets, and desktop displays with dedicated touch controls.

### 2. Real-Time Command Preview
- As you configure command templates and parameter validation rules, enter test values into the **Live Command Preview** panel.
- Preview resolved command strings in real time with automatic shell quoting (`shell-quoted`) or direct process argument lists (`direct-array`).
- Receive instant visual warnings for invalid inputs or forbidden shell characters.

### 3. Team Collaboration & Presets
- **Role-Based Views**: Switch between **Admin**, **Editor**, and **Viewer** roles to test access control and preview permissions.
- **Pre-packaged Presets**: Instantly load team presets for **DevOps**, **Frontend**, and **SRE** environments.
- **Config Export & Import**: Export configuration JSON files with team signature metadata and import shared team templates easily.

### 4. Offline Capabilities & PWA Support
- Built as a Progressive Web Application (PWA) with a dedicated Service Worker.
- Automatically caches app shell assets (`index.html`, `dashboard.js`, `style.css`, `sw.js`, `manifest.json`).
- Enables offline editing with automatic `localStorage` synchronization when network connectivity is lost.

---

## Running the Web Dashboard

Launch the Web Dashboard via the Python companion utility:

```bash
python3 companion/companion_app.py --dashboard --port 8080
```

Or run the dedicated web server module directly:

```bash
python3 -m companion.web_dashboard --port 8080 --open
```

Navigate to `http://localhost:8080/` in your web browser.
