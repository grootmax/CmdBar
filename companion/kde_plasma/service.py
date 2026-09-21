"""
CmdBar KDE Plasma D-Bus Service and Integration Controller.
Unifies KWallet, KWin, System Tray, and Theme Adapter into a single service interface (org.kde.CmdBar).
"""

import json
from typing import Dict, Any, List, Optional
from companion.companion_app import load_config, save_config, run_command_in_shell
from companion.kde_plasma.kwallet import KWalletManager
from companion.kde_plasma.kwin import KWinManager
from companion.kde_plasma.system_tray import SystemTrayManager
from companion.kde_plasma.theme import PlasmaThemeAdapter


class CmdBarKdeService:
    def __init__(self, config_path: Optional[str] = None):
        self.config_path = config_path
        self.kwallet = KWalletManager()
        self.kwin = KWinManager()
        self.system_tray = SystemTrayManager()
        self.theme = PlasmaThemeAdapter()
        self.kwallet.open_wallet()

    def add_command(self, name: str, command: str, category: str = "External") -> bool:
        if not name or not str(name).strip():
            return False
        if not command or not str(command).strip():
            return False

        cat_name = str(category).strip() if category and str(category).strip() else "External"
        config = load_config()
        categories = config.setdefault("categories", [])

        target_cat = None
        for cat in categories:
            if cat.get("name") == cat_name:
                target_cat = cat
                break

        if not target_cat:
            target_cat = {"name": cat_name, "commands": []}
            categories.append(target_cat)

        cmds = target_cat.setdefault("commands", [])
        clean_name = str(name).strip()
        clean_cmd = str(command).strip()

        existing = None
        for c in cmds:
            if c.get("name") == clean_name:
                existing = c
                break

        if existing:
            existing["template"] = clean_cmd
            existing["command"] = clean_cmd
        else:
            cmds.append({"name": clean_name, "template": clean_cmd, "command": clean_cmd})

        return save_config(config)

    def remove_command(self, name: str) -> bool:
        if not name or not str(name).strip():
            return False
        clean_name = str(name).strip()
        config = load_config()
        categories = config.get("categories", [])

        removed = False
        for cat in categories:
            cmds = cat.get("commands", [])
            init_len = len(cmds)
            cat["commands"] = [c for c in cmds if c.get("name") != clean_name]
            if len(cat["commands"]) < init_len:
                removed = True

        if removed:
            save_config(config)
        return removed

    def execute_command(self, name: str) -> Dict[str, Any]:
        if not name or not str(name).strip():
            return {"success": False, "exit_code": -1, "stdout": "", "stderr": "Invalid command name"}

        clean_name = str(name).strip()
        config = load_config()

        found_cmd = None
        for cat in config.get("categories", []):
            for c in cat.get("commands", []):
                if c.get("name") == clean_name or c.get("template") == clean_name or c.get("command") == clean_name:
                    found_cmd = c
                    break
            if found_cmd:
                break

        cmd_str = found_cmd.get("template", found_cmd.get("command", clean_name)) if found_cmd else clean_name
        code, stdout, stderr = run_command_in_shell(cmd_str)

        success = (code == 0)
        return {
            "success": success,
            "exit_code": code,
            "stdout": stdout,
            "stderr": stderr,
            "command": cmd_str,
        }

    def get_commands(self) -> str:
        config = load_config()
        return json.dumps(config)

    def save_secret(self, key: str, value: str) -> bool:
        return self.kwallet.write_secret(key, value)

    def get_secret(self, key: str) -> Optional[str]:
        return self.kwallet.read_secret(key)

    def get_active_window_context(self) -> Dict[str, Any]:
        return self.kwin.get_active_window_context()

    def register_shortcut(self, shortcut: str = "Meta+Space") -> bool:
        return self.kwin.register_shortcut(shortcut)

    def send_notification(self, title: str, body: str, icon: Optional[str] = None) -> int:
        return self.system_tray.send_notification(title, body, icon)
