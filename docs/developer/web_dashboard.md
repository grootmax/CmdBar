# CmdBar Web Dashboard Developer & API Architecture

This document covers the architectural design and REST API endpoints of the **CmdBar Web Dashboard** component.

---

## Architecture Overview

The Web Dashboard consists of two primary layers:

1. **Frontend App (`dashboard/`)**:
   - `index.html`: Responsive HTML5 application shell.
   - `dashboard.js`: JS application state manager (`DashboardApp`), preview resolution engine, drag-and-drop handler, and team collaboration manager.
   - `style.css`: Theme-aware CSS custom properties with mobile breakpoints (`@media (max-width: 768px)`).
   - `sw.js`: Service Worker providing Cache-First offline caching for static assets and Network-First for REST APIs.
   - `manifest.json`: Web App Manifest defining PWA metadata.

2. **Backend Server (`companion/web_dashboard.py`)**:
   - Implements `CmdBarDashboardHandler`, an `http.server.SimpleHTTPRequestHandler` subclass.
   - Serves static files and provides JSON REST API endpoints.

---

## REST API Specification

### `GET /api/status`
- **Response**: `{ "status": "online", "version": "1.0.0", "service": "CmdBar Web Dashboard", "offline_capable": true }`

### `GET /api/config`
- **Response**: Returns active JSON configuration object loaded via `app.config_schema.load_config()`.

### `POST /api/config`
- **Body**: JSON configuration object.
- **Action**: Validates schema and saves configuration atomically via `save_config()`.

### `POST /api/preview`
- **Body**: `{ "template": string, "mode": string, "parameter_values": object, "parameters_schema": object }`
- **Response**: `{ "resolved": string, "errors": object }`

### `GET /api/team/presets`
- **Response**: JSON dictionary of available pre-packaged team presets (`DevOps`, `Frontend`, `SRE`).

### `POST /api/team/collaborate`
- **Body**: `{ "action": "apply_preset", "preset_name": string }`
- **Response**: `{ "success": true, "config": object }`

### `GET /api/export`
- **Response**: Config JSON augmented with `_export_timestamp` and `_exported_by`.

### `POST /api/import`
- **Body**: Imported JSON configuration object.
