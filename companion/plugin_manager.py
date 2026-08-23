"""
CmdBar Python Companion Plugin Manager.
Provides discovery, validation, installation, and status monitoring
for plugins stored in ~/.config/cmdbar/plugins/
"""

import json
import os
import re
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def get_plugins_dir() -> Path:
    """Returns path to the user's plugin directory (~/.config/cmdbar/plugins/)."""
    xdg_config = os.environ.get("XDG_CONFIG_HOME")
    if xdg_config:
        base_dir = Path(xdg_config)
    else:
        base_dir = Path.home() / ".config"
    plugins_dir = base_dir / "cmdbar" / "plugins"
    plugins_dir.mkdir(parents=True, exist_ok=True)
    return plugins_dir


def validate_manifest(manifest: Any) -> Tuple[bool, List[str], Dict[str, Any]]:
    """Validates a plugin manifest dict against CmdBar plugin schema requirements."""
    if not isinstance(manifest, dict):
        return False, ["Manifest must be a JSON object"], {}

    errors = []
    plugin_id = manifest.get("id")
    if (
        not plugin_id
        or not isinstance(plugin_id, str)
        or not re.match(r"^[a-zA-Z0-9_\-]+$", plugin_id)
    ):
        errors.append(
            "Plugin 'id' is required and must contain alphanumeric chars, dashes, or underscores."
        )

    if not manifest.get("name") or not isinstance(manifest.get("name"), str):
        errors.append("Plugin 'name' is required.")

    if not manifest.get("version") or not isinstance(manifest.get("version"), str):
        errors.append("Plugin 'version' is required.")

    allowed_permissions = {
        "commands",
        "clipboard",
        "events",
        "ui",
        "storage",
        "ai",
        "network",
    }
    permissions = manifest.get("permissions", [])
    if isinstance(permissions, list):
        for perm in permissions:
            if perm not in allowed_permissions:
                errors.append(f"Invalid permission '{perm}' requested.")

    clean_manifest = {
        "id": manifest.get("id", ""),
        "name": manifest.get("name", ""),
        "version": manifest.get("version", "1.0.0"),
        "description": manifest.get("description", ""),
        "author": manifest.get("author", "Unknown"),
        "main": manifest.get("main", "index.js"),
        "permissions": permissions if isinstance(permissions, list) else [],
        "enabled": manifest.get("enabled", True) is not False,
        "minCmdBarVersion": manifest.get("minCmdBarVersion", "1.0.0"),
        "commands": (
            manifest.get("commands", [])
            if isinstance(manifest.get("commands"), list)
            else []
        ),
    }

    return len(errors) == 0, errors, clean_manifest


class PythonPluginManager:
    """Manages discovery, installation, and lifecycle of plugins from Python companion apps."""

    def __init__(self, plugins_dir: Optional[Path] = None):
        self.plugins_dir = plugins_dir or get_plugins_dir()

    def discover_plugins(self) -> List[Dict[str, Any]]:
        """Scans the plugins directory and parses manifests."""
        self.plugins_dir.mkdir(parents=True, exist_ok=True)
        discovered = []

        for entry in self.plugins_dir.iterdir():
            if entry.is_dir():
                manifest_file = entry / "manifest.json"
                if not manifest_file.exists():
                    manifest_file = entry / "plugin.json"

                if manifest_file.exists():
                    try:
                        with open(manifest_file, "r", encoding="utf-8") as f:
                            data = json.load(f)
                        valid, errors, clean_manifest = validate_manifest(data)
                        if valid:
                            discovered.append(
                                {
                                    "dir": str(entry),
                                    "manifest": clean_manifest,
                                }
                            )
                    except Exception:
                        pass

        return discovered

    def install_plugin(
        self, manifest: Dict[str, Any], main_code: str = ""
    ) -> Dict[str, Any]:
        """Installs a plugin into the plugins directory."""
        valid, errors, clean_manifest = validate_manifest(manifest)
        if not valid:
            raise ValueError(f"Invalid manifest: {', '.join(errors)}")

        plugin_dir = self.plugins_dir / clean_manifest["id"]
        plugin_dir.mkdir(parents=True, exist_ok=True)

        manifest_path = plugin_dir / "manifest.json"
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(clean_manifest, f, indent=2)

        if main_code:
            main_file = plugin_dir / clean_manifest.get("main", "index.js")
            with open(main_file, "w", encoding="utf-8") as f:
                f.write(main_code)

        return {"dir": str(plugin_dir), "manifest": clean_manifest}

    def uninstall_plugin(self, plugin_id: str) -> bool:
        """Removes a plugin directory."""
        plugin_dir = self.plugins_dir / plugin_id
        if plugin_dir.exists() and plugin_dir.is_dir():
            shutil.rmtree(plugin_dir)
            return True
        return False

    def list_plugins(self) -> List[Dict[str, Any]]:
        """Returns list of plugin info dictionaries."""
        discovered = self.discover_plugins()
        return [item["manifest"] for item in discovered]
