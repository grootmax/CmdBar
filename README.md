# CmdBar

**Quick commands in your GNOME top bar.**

CmdBar is a modern GNOME Shell extension + companion app that puts your most-used commands right in the system status area.  
Click the indicator → choose a command → done.

Perfect for developers who live in the terminal and want one-click access to project shortcuts, infrastructure tools, and parameterized actions (ticket IDs, ECS tasks, etc.).

---

## Features

- **AI Natural Language Translator** – Prefix prompts with `/ai ` (e.g. `/ai deploy latest build to staging`) to translate natural language into executable shell commands via OpenAI, Anthropic (Claude), or Ollama (local model fallback) with secure API key storage and mandatory execution confirmation
- **Top-bar indicator** – Clean icon in the system status area (next to accessibility / network icons)
- **Global Keyboard Shortcut** – Open the CmdBar menu from anywhere using `Super+Space` (default), `Alt+Space`, `Super+Shift+Space`, or custom keybindings configured in Extension Preferences.
- **Dynamic menu** – Fully driven by a simple JSON file
- **Fuzzy search** – Search box at top of menu with real-time fuzzy matching (e.g., "gp" matches "git push origin"), character markup highlighting, relevance + usage frequency sorting, and full keyboard navigation (arrow keys, Enter, Escape)
- **Categories** – Group commands (Projects, Infrastructure, ECS, Tickets, etc.)
- **Copy to clipboard** – Each command menu item includes a copy button (`wl-copy` on Wayland / `xclip` on X11) to copy command strings without executing
- **Argument support** – Commands that need input (e.g. `prod <task-id>`, `feature TFG-877`) open a clean dialog
- **Management App** – Beautiful Libadwaita app to add, edit, reorder and test shortcuts
- **Plugin Architecture & Extension System** – Extend CmdBar capabilities with third-party plugins stored in `~/.config/cmdbar/plugins/` featuring sandboxed execution, permission checks, custom commands, events, and marketplace catalog search
- **Live reload** – Changes in the JSON are reflected after a quick reload
- **Ubuntu & GNOME ready** – Designed for GNOME 46+

---

## Screenshots

> *(Add screenshots here later)*  
> - Top-bar indicator  
> - Dropdown menu with categories  
> - Argument dialog  
> - Management app

---

## Installation & Local Setup

### 1. System Prerequisites

To build, run, and test **CmdBar** on **Ubuntu 24.04+ (GNOME 46+)**, you must ensure that all core dependencies for the GNOME shell extension, GJS (GNOME JavaScript), and PyGObject / Libadwaita companion apps are installed on your host system.

Run the following command to install the required system-level packages:

```bash
sudo apt update
sudo apt install -y \
  make \
  libglib2.0-bin \
  zenity \
  python3 \
  python3-pip \
  python3-gi \
  python3-gi-cairo \
  gir1.2-gtk-4.0 \
  gir1.2-adw-1 \
  nodejs \
  npm
```

- **GNOME Shell (46+)**: The extension leverages modern GNOME Shell 46 and 47 native APIs, including symbolic icon instantiation, standard widget layout properties, and native file handle path resolution.
- **PyGObject (`gi`) & Gtk4 / Libadwaita**: Power the beautiful Libadwaita management application (`app/main.py`).
- **Node.js & npm**: Required to run Jest unit tests (`npm run test`) and code-quality tools (ESLint, Prettier).
- **Zenity**: Used by the GNOME extension to prompt for user parameter inputs in pop-up dialogs.
- **make & libglib2.0-bin (`glib-compile-schemas`)**: Required to compile the XML GSettings schemas and install the extension.

---

### 2. Local Extension Installation & Activation

The GNOME Shell extension resides under the `extension/` directory. It must be placed in your user extension directory and its GSettings schemas compiled for GNOME to recognize and load it.

#### Step-by-Step Setup:

1. **Clone the repository**:
   ```bash
   git clone https://github.com/yourusername/cmdbar.git
   cd cmdbar
   ```

2. **Install using Makefile**:
   The Makefile automates GSettings schema compilation and local installation:
   ```bash
   make install
   ```
   *Alternatively, to do this manually:*
   ```bash
   # Compile GSettings schemas
   glib-compile-schemas extension/schemas/
   
   # Copy extension files to the local user directory
   mkdir -p ~/.local/share/gnome-shell/extensions/cmdbar@yourdomain.com
   cp -r extension/* ~/.local/share/gnome-shell/extensions/cmdbar@yourdomain.com/
   ```

3. **Restart GNOME Shell**:
   - **X11 session**: Press `Alt+F2`, type `r`, and press `Enter`.
   - **Wayland session**: Log out of your desktop session and log back in (Wayland does not support restarting the shell in-place). Alternatively, you can test inside a nested GNOME Shell instance:
     ```bash
     dbus-run-session -- gnome-shell --nested --wayland
     ```

4. **Enable the Extension**:
   Activate the extension using the command line:
   ```bash
   gnome-extensions enable cmdbar@yourdomain.com
   ```
   Or open the **Extensions** (or **Extension Manager**) desktop application and toggle on **CmdBar**.

---

### 3. Running the Companion Utilities

CmdBar comes with two companion utilities for managing your customized menus: a modern Libadwaita graphical application and a legacy Gtk-based/CLI companion utility.

#### Modern Libadwaita Application
The modern GUI allows you to manage categories, add or remove shortcuts, adjust parameter patterns, and see dry-run visual command previews in real-time.

Run it directly using Python 3:
```bash
python3 app/main.py
```
*Note: If no display server is detected (e.g., in a headless container or SSH session), the application falls back gracefully to a non-interactive CLI summary of the active shortcuts configuration.*

#### Legacy Companion Utility
A lightweight companion utility is also provided for backward compatibility and simpler systems:
```bash
python3 companion/companion_app.py
```
This utility manages configuration storage seamlessly and will also fallback gracefully to terminal-based output if the desktop environment / GTK is unavailable.

---

## Configuration Layout & Schemas

All active menu definitions, parameters, and application preferences are stored under your user configuration directory at `~/.config/cmdbar/`.

### Configuration Directory Structure
```text
~/.config/cmdbar/
├── config.json       # Configured shortcuts & categories for the companion apps
├── commands.json     # Extension-compatible top-bar commands schema
└── lock/             # Lock-file directory for thread/process safety during syncs
```

### Configuration Schemas

#### 1. Companion Application Schema (`~/.config/cmdbar/config.json`)
Used by `app/main.py` and `companion/companion_app.py`. This schema supports deep customization, execution modes (`shell-quoted` or `direct-array`), and robust parameter validation via regex.

```json
{
  "categories": [
    {
      "name": "System Utilities",
      "shortcuts": [
        {
          "name": "Ping Host",
          "command": "ping -c 3 <host>",
          "mode": "shell-quoted",
          "parameters": {
            "host": {
              "regex": "^[a-zA-Z0-9.-]+$",
              "error_message": "Invalid host format! Must contain only alphanumeric, dots, and dashes."
            }
          }
        },
        {
          "name": "Direct Exec",
          "command": "/usr/bin/echo \"Hello\" <arg>",
          "mode": "direct-array",
          "parameters": {
            "arg": {
              "regex": "^[a-zA-Z0-9_]+$",
              "error_message": "Invalid argument format! Must be alphanumeric or underscore."
            }
          }
        }
      ]
    }
  ]
}
```

#### 2. GNOME Shell Extension Schema (`~/.config/cmdbar/commands.json`)
Used directly by the GNOME Shell extension to load top-bar menus dynamically.

```json
{
  "categories": [
    {
      "name": "Projects",
      "commands": [
        {
          "name": "Build Current Project",
          "command": "make build"
        },
        {
          "name": "Start Task",
          "command": "echo Starting task <task-id>",
          "placeholder": "task-id"
        }
      ]
    }
  ]
}
```

---

## Quality Assurance & Testing

CmdBar includes robust test suites for both its JavaScript extension core and Python companion modules to ensure high stability and correct parameter substitution.

### 1. Running Unit Tests

#### JavaScript Jest Tests
Run the comprehensive Jest unit test suite covering command processors, configuration synchronization, and atomicity:
```bash
# Install node packages
npm install

# Run tests via Jest
npm run test

# Alternatively, run simple mock-less tests
npm run test:simple
```

#### Python Pytest Tests
Run the Python pytest test suite to verify configuration schemas, validation rules, companion logic, and app initialization:
```bash
# Set PYTHONPATH to root and run pytest
PYTHONPATH=. pytest tests/
```

### 2. Code Quality, Linters, and Formatters

We enforce high code-quality standards across the codebase. Ensure your changes adhere to formatting rules using the following utilities:

- **Python Formatting (Black)**:
  Format Python files to comply with PEP 8:
  ```bash
  black .
  ```
  Verify formatting without writing back changes:
  ```bash
  black --check .
  ```

- **JavaScript Linting (ESLint)**:
  Ensure clean code structure and check for common JS mistakes:
  ```bash
  npx eslint extension/ tests/
  ```

- **JavaScript & JSON Formatting (Prettier)**:
  Auto-format styles in `.js`, `.json`, `.css` files:
  ```bash
  npx prettier --write "extension/**/*.js" "tests/**/*.js" "*.json"
  ```

### 3. Makefile Cheat Sheet

The provided `Makefile` exposes helper commands to speed up your local workflow:

| Command | Action |
|---------|--------|
| `make install` | Compiles GSettings schemas and installs extension files to `~/.local/share/gnome-shell/extensions/` |
| `make uninstall` | Removes local extension files completely |
| `make compile-schemas` | Manually compile GSettings schemas in `extension/schemas/` |
| `make test` | Run the JavaScript Jest test suite |
| `make help` | Print available commands list |
