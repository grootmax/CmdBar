# CmdBar Plugin Architecture & Extension System

CmdBar includes a sandboxed plugin and extension system that allows third-party developers to extend top-bar capabilities, register custom dynamic commands, hook into system events, interact with the clipboard, and integrate AI filters.

---

## 1. Plugin Directory Structure

Plugins are stored in the user's configuration directory at `~/.config/cmdbar/plugins/` (or `$XDG_CONFIG_HOME/cmdbar/plugins/`).

Each plugin resides in its own subfolder:

```text
~/.config/cmdbar/plugins/
└── my-sample-plugin/
    ├── manifest.json
    └── index.js
```

---

## 2. Plugin Manifest (`manifest.json`)

Every plugin must contain a `manifest.json` (or `plugin.json`) file specifying metadata and permissions:

```json
{
  "id": "my-sample-plugin",
  "name": "Sample Developer Plugin",
  "version": "1.0.0",
  "description": "Adds developer utility shortcuts and event hooks",
  "author": "CmdBar Developer",
  "main": "index.js",
  "permissions": ["commands", "clipboard", "events", "ui", "storage", "ai"],
  "enabled": true,
  "minCmdBarVersion": "1.0.0",
  "commands": [
    {
      "name": "Static Plugin Action",
      "command": "echo 'Hello from static plugin command'",
      "category": "Plugins"
    }
  ]
}
```

### Manifest Fields
- `id`: Unique alphanumeric identifier (dashes/underscores allowed).
- `name`: Display name of the plugin.
- `version`: Version string (e.g. `1.0.0`).
- `description`: Brief summary of plugin capabilities.
- `author`: Plugin author or organization.
- `main`: Entrypoint JavaScript file (defaults to `index.js`).
- `permissions`: List of permissions requested (`commands`, `clipboard`, `events`, `ui`, `storage`, `ai`, `network`).
- `enabled`: Boolean toggle (`true` by default).

---

## 3. Sandboxed Plugin API (`PluginAPI`)

Plugin scripts run inside an isolated execution sandbox and receive an `api` object containing permitted APIs:

```javascript
/**
 * Plugin entrypoint activation hook
 * @param {Object} api - Sandboxed Plugin API surface
 */
function activate(api) {
  console.log(`Activating plugin: ${api.manifest.name}`);

  // Register dynamic command
  api.commands.register({
    name: 'Dynamic Git Switch',
    command: 'git checkout main',
    category: 'Plugins',
  });

  // Event listener
  api.events.on('command:execute', (data) => {
    console.log(`Command triggered: ${data.command}`);
  });

  // Storage
  api.storage.set('lastUsed', Date.now());

  // UI Notification
  api.ui.notify('Plugin Activated', 'Sample plugin loaded successfully');
}
```

### Available API Modules
- `api.commands`: `register(cmd)`, `unregister(cmdId)`, `getCommands()`
- `api.events`: `on(event, fn)`, `off(event, fn)`, `emit(event, data)`
- `api.clipboard`: `copy(text)`, `paste(text)`
- `api.ui`: `notify(title, message)`
- `api.storage`: `get(key)`, `set(key, val)`, `remove(key)`, `clear()`
- `api.ai`: `registerPromptFilter(fn)`

---

## 4. Python Companion App Integration

The Python companion manager (`companion/plugin_manager.py`) provides CLI and programmatic management:

```bash
# List installed plugins
python3 companion/companion_app.py --plugins
```

---

## 5. Security & Isolation

- **Permission Checking**: Every API call verifies requested permissions against `manifest.permissions`. Attempting ungranted actions throws a descriptive permission error.
- **Error Isolation**: Runtime exceptions in plugin handlers or activation functions are safely caught and logged, preventing host GNOME Shell crashes.
