# Headless CLI-Only Server Mode Documentation

CmdBar provides a dedicated headless server mode for remote command administration, container environments, and headless servers without a GUI display server (X11/Wayland).

## Overview

The server mode is built with Python's standard `asyncio` framework and provides:
1. **REST API**: Management of categories, commands, configurations, and parametric execution.
2. **WebSocket Interface**: Real-time event streaming, configuration update notifications, and bidirectional RPC.
3. **Monitoring & Metrics Endpoint**: Uptime, request counts, active WebSocket clients, system RSS memory, and Prometheus exposition metrics format.
4. **systemd Integration**: Native systemd service unit file for automated background startup and process lifecycle management.

## Starting the Server

### Option 1: Using the Companion App CLI
```bash
python3 companion/companion_app.py --server --host 127.0.0.1 --port 8080
```

### Option 2: Using the Executable Launcher
```bash
scripts/cmdbar-server --host 0.0.0.0 --port 8080 --auth-token my-secret-token
```

### Options & Arguments
- `--host`: Bind address (default: `127.0.0.1`).
- `--port`: Port number (default: `8080`).
- `--config`: Path to custom configuration JSON file.
- `--auth-token`: Bearer authentication token for REST and WebSocket endpoints.

## REST API Specification

### Authentication
If `--auth-token` (or `CMDBAR_SERVER_TOKEN`) is enabled, include the token in request headers:
```http
Authorization: Bearer my-secret-token
```
Or as a query parameter: `?token=my-secret-token`.

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Server health status, uptime, and timestamp |
| `GET` | `/api/version` | Server version information |
| `GET` | `/metrics` | Operational statistics (JSON or Prometheus text format) |
| `GET` | `/api/config` | Retrieve active configuration JSON |
| `PUT` | `/api/config` | Update active configuration JSON |
| `GET` | `/api/categories` | List all categories |
| `POST` | `/api/categories` | Create new category `{"name": "CategoryName"}` |
| `DELETE` | `/api/categories/{name}` | Delete a category by name |
| `GET` | `/api/commands` | List all commands |
| `POST` | `/api/commands` | Create new command |
| `PUT` | `/api/commands/{name}` | Edit existing command |
| `DELETE` | `/api/commands/{name}` | Delete command by name |
| `POST` | `/api/execute` | Execute command with parameters `{"command_name": "...", "parameters": {...}}` |

## WebSocket Protocol (`/ws`)

Connect to `ws://localhost:8080/ws`.

### Message Types:
- `ping` -> `{"type": "pong"}`
- `subscribe` -> `{"type": "subscribe", "topic": "events"}`
- `execute` -> Runs command and streams `execution_started` and `execution_finished` events.

## systemd Service Setup

To run as a background daemon:
```bash
scripts/install_systemd_service.sh
systemctl --user enable --now cmdbar-server.service
```
