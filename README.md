# CmdBar

**Quick commands in your GNOME top bar.**

CmdBar is a modern GNOME Shell extension + companion app that puts your most-used commands right in the system status area.  
Click the indicator → choose a command → done.

Perfect for developers who live in the terminal and want one-click access to project shortcuts, infrastructure tools, and parameterized actions (ticket IDs, ECS tasks, etc.).

---

## Features

- **Top-bar indicator** – Clean icon in the system status area (next to accessibility / network icons)
- **Dynamic menu** – Fully driven by a simple JSON file
- **Categories** – Group commands (Projects, Infrastructure, ECS, Tickets, etc.)
- **Argument support** – Commands that need input (e.g. `prod <task-id>`, `feature TFG-877`) open a clean dialog
- **Management App** – Beautiful Libadwaita app to add, edit, reorder and test shortcuts
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

## Installation

### 1. Extension

```bash
# Clone the repository
git clone https://github.com/yourusername/cmdbar.git
cd cmdbar

# Install the extension
make install
# or manually:
# cp -r extension ~/.local/share/gnome-shell/extensions/cmdbar@yourdomain.com
