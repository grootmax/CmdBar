"""
System Tray Manager for CmdBar Python Companion in KDE Plasma.
Implements org.kde.StatusNotifierItem / org.freedesktop.StatusNotifierItem D-Bus interface
and org.freedesktop.Notifications integration.
"""

import time
import subprocess
from typing import Dict, Any, List, Optional, Callable


class SystemTrayManager:
    def __init__(self, id_str: str = "cmdbar-system-tray", title: str = "CmdBar Quick Menu", icon_name: str = "utilities-terminal"):
        self.id = id_str
        self.title = title
        self.icon_name = icon_name
        self.status = "Active"  # Active, Passive, NeedsAttention
        self.tooltip = "CmdBar Command Palette"
        self.badge_count = 0
        self.is_visible = True
        self._menu_items = [
            {"id": "toggle", "label": "Toggle CmdBar Menu", "action": None},
            {"id": "exec", "label": "Run Command...", "action": None},
            {"id": "prefs", "label": "Preferences", "action": None},
            {"id": "quit", "label": "Quit", "action": None},
        ]
        self._notifications: List[Dict[str, Any]] = []

    def update_status(self, status: str = "Active", badge_count: int = 0) -> Dict[str, Any]:
        """
        Updates status notifier item status ('Active', 'Passive', 'NeedsAttention') and badge count.
        """
        if status in ("Active", "Passive", "NeedsAttention"):
            self.status = status
        self.badge_count = max(0, badge_count)
        return {"status": self.status, "badge_count": self.badge_count}

    def set_tooltip(self, text: str) -> str:
        if text and isinstance(text, str):
            self.tooltip = text.strip()
        return self.tooltip

    def get_menu_items(self) -> List[Dict[str, Any]]:
        return list(self._menu_items)

    def trigger_menu_item(self, item_id: str) -> bool:
        for item in self._menu_items:
            if item["id"] == item_id:
                if item["action"] and callable(item["action"]):
                    item["action"](item_id)
                    return True
        return False

    def on_menu_item(self, item_id: str, callback: Callable[[str], None]) -> bool:
        for item in self._menu_items:
            if item["id"] == item_id:
                item["action"] = callback
                return True
        self._menu_items.append({"id": item_id, "label": item_id, "action": callback})
        return True

    def send_notification(self, title: str, body: str, icon: Optional[str] = None) -> int:
        """
        Sends desktop notification using notify-send or D-Bus org.freedesktop.Notifications.
        """
        notif_id = len(self._notifications) + 1
        icon_str = icon or self.icon_name
        notif_obj = {
            "id": notif_id,
            "title": title or "CmdBar",
            "body": body or "",
            "icon": icon_str,
            "timestamp": time.time(),
        }
        self._notifications.append(notif_obj)

        try:
            subprocess.run([
                "notify-send",
                "-i", icon_str,
                title or "CmdBar",
                body or ""
            ], capture_output=True, text=True, timeout=2)
        except Exception:
            pass

        return notif_id

    def set_visible(self, visible: bool) -> bool:
        self.is_visible = bool(visible)
        return self.is_visible
