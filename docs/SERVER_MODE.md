# CmdBar Headless Server Mode

CmdBar includes a headless server daemon providing a REST API, real-time WebSocket interface, configuration management, execution engine, monitoring metrics, and systemd service management.

## Overview

The server mode allows running CmdBar in headless environments (e.g., remote servers, CI/CD runners, headless Linux containers) without requiring a display server or GNOME Shell desktop environment.

- **Entry Point**: `python3 -m companion.server` or `python3 -m app.server`
- **Default Address**: `http://127.0.0.1:8080`
- **Protocols**: HTTP REST API + WebSocket (RFC 6455)

---

## CLI Options

```bash
python3 -m companion.server [OPTIONS]

Options:
  --host HOST          Host address to bind (default: 127.0.0.1 or CMDBAR_SERVER_HOST)
  --port PORT          Port to listen on (default: 8080 or CMDBAR_SERVER_PORT)
  --config PATH        Path to config.json file (default: CMDBAR_CONFIG_PATH)
  --daemon             Run server in background daemon process
  --install-service    Install systemd user service unit
  --uninstall-service  Uninstall systemd user service unit
  --status-service     Check status of systemd user service
  --log-level LEVEL    Set logging level (DEBUG, INFO, WARNING, ERROR)
  --version            Show server version
```

---

## REST API Endpoints

### 1. Health Check
- `GET /health` or `GET /api/v1/health`
- **Response**:
  ```json
  {
    "status": "ok",
    "service": "CmdBar-Server",
    "version": "1.0.0",
    "uptime_seconds": 124.5
  }
  ```

### 2. Server Monitoring & Metrics
- `GET /metrics` or `GET /api/v1/monitoring`
- **Response**:
  ```json
  {
    "status": "ok",
    "uptime_seconds": 320.12,
    "timestamp": "2026-08-23T12:00:00Z",
    "server": {
      "host": "127.0.0.1",
      "port": 8080,
      "active_websockets": 2
    },
    "metrics": {
      "total_requests": 45,
      "total_executions": 12,
      "successful_executions": 11,
      "failed_executions": 1,
      "avg_execution_time_ms": 14.5
    },
    "system": {
      "os": "posix",
      "platform": "linux",
      "python_version": "3.12.3",
      "cpu_count": 8,
      "memory_rss_mb": 24.5
    },
    "config": {
      "categories_count": 3,
      "shortcuts_count": 10,
      "config_path": "/home/user/.config/cmdbar/config.json"
    }
  }
  ```

### 3. Configuration Management
- `GET /api/v1/config`: Retrieve active configuration JSON.
- `POST /api/v1/config` or `PUT /api/v1/config`: Update full configuration object.
  - **Body**: Configuration JSON dictionary containing `categories`.

### 4. Shortcuts Management
- `GET /api/v1/shortcuts`: List all registered shortcuts.
- `POST /api/v1/shortcuts`: Add a new shortcut.
  - **Body**: `{"category": "Projects", "name": "Build", "command": "make build", "parameters": {}}`
- `GET /api/v1/shortcuts/<name>`: Get details of a shortcut by name.
- `PUT /api/v1/shortcuts/<name>`: Update shortcut details by name.
- `DELETE /api/v1/shortcuts/<name>`: Delete shortcut by name.

### 5. Execution Engine
- `POST /api/v1/execute` or `POST /api/v1/shortcuts/<name>/execute`
- **Body**:
  ```json
  {
    "name": "Git Checkout",
    "parameters": {
      "branch": "main"
    }
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "exit_code": 0,
    "stdout": "Switched to branch 'main'\n",
    "stderr": "",
    "duration_ms": 15.2,
    "command": "git checkout main"
  }
  ```

### 6. AI Translation
- `POST /api/v1/ai/translate`
- **Body**: `{"prompt": "deploy build to staging"}`
- **Response**: `{"prompt": "...", "command": "make deploy STAGING=1"}`

---

## WebSocket Interface (`/ws`)

Clients connect via WebSocket URL `ws://127.0.0.1:8080/ws`.

### Supported Client Messages:
- `{"action": "ping"}` -> Server responds with `{"event": "pong"}`
- `{"action": "get_config"}` -> Server responds with `{"event": "config", "data": {...}}`
- `{"action": "update_config", "config": {...}}` -> Server updates config and broadcasts `{"event": "config_updated", "data": {...}}`
- `{"action": "execute", "name": "...", "parameters": {...}}` -> Server streams `{"event": "started"}` and `{"event": "completed", ...}`
- `{"action": "subscribe"}` -> Server responds with `{"event": "subscribed"}`

---

## Systemd Integration

Install as a systemd user service:

```bash
# Install service unit
python3 -m companion.server --install-service

# Check service status
python3 -m companion.server --status-service

# Start service via systemctl
systemctl --user start cmdbar-server

# Uninstall service unit
python3 -m companion.server --uninstall-service
```
