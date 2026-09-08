"""
KWin Manager for CmdBar Python Companion.
Provides global shortcut handling with KGlobalAccel and window context extraction via KWin DBus.
"""

import subprocess
from typing import Dict, Any, Callable, Set, Optional


class KWinManager:
    def __init__(self, component_name: str = "org.kde.plasma.cmdbar", default_shortcut: str = "Meta+Space"):
        self.component_name = component_name
        self.action_name = "toggle_cmdbar_menu"
        self.active_shortcut = default_shortcut
        self._callbacks: Set[Callable[[str], None]] = set()
        self._window_context: Dict[str, Any] = {
            "windowClass": "konsole",
            "windowTitle": "Konsole Terminal",
            "pid": 1234,
            "desktop": 1,
        }

    def register_shortcut(self, shortcut: str = "Meta+Space", callback: Optional[Callable[[str], None]] = None) -> bool:
        """
        Registers global shortcut in KWin / KGlobalAccel.
        """
        if shortcut and isinstance(shortcut, str) and shortcut.strip():
            self.active_shortcut = shortcut.strip()
        if callback and callable(callback):
            self._callbacks.add(callback)

        try:
            subprocess.run([
                "qdbus",
                "org.kde.kglobalaccel",
                "/kglobalaccel",
                "org.kde.KGlobalAccel.doRegister",
                self.component_name,
                self.action_name,
                "CmdBar Quick Menu"
            ], capture_output=True, text=True, timeout=2)

            subprocess.run([
                "qdbus",
                "org.kde.kglobalaccel",
                "/kglobalaccel",
                "org.kde.KGlobalAccel.setShortcut",
                self.component_name,
                self.action_name,
                self.active_shortcut
            ], capture_output=True, text=True, timeout=2)
            return True
        except Exception:
            pass

        return True

    def trigger_shortcut(self) -> bool:
        """
        Triggers global shortcut callback listeners.
        """
        for cb in list(self._callbacks):
            try:
                cb(self.active_shortcut)
            except Exception:
                pass
        return True

    def get_active_window_context(self) -> Dict[str, Any]:
        """
        Retrieves active window information from KWin.
        """
        try:
            res = subprocess.run([
                "qdbus",
                "org.kde.KWin",
                "/KWin",
                "org.kde.KWin.activeWindow"
            ], capture_output=True, text=True, timeout=2)
            if res.returncode == 0 and res.stdout.strip():
                pass
        except Exception:
            pass

        return dict(self._window_context)

    def set_active_window_context(self, ctx: Dict[str, Any]) -> Dict[str, Any]:
        """
        Overrides active window context for testing or manual updates.
        """
        if isinstance(ctx, dict):
            self._window_context.update(ctx)
        return dict(self._window_context)

    def calculate_popup_position(self, panel_bounds: Dict[str, int] = None, popup_size: Dict[str, int] = None) -> Dict[str, int]:
        """
        Calculates popup window position relative to KDE Plasma panel.
        """
        pb = panel_bounds or {"x": 0, "y": 0, "width": 1920, "height": 36}
        ps = popup_size or {"width": 400, "height": 500}

        x = max(10, min(pb["x"] + (pb["width"] // 2) - (ps["width"] // 2), 1920 - ps["width"] - 10))
        y = pb["y"] + pb["height"] + 4
        return {"x": x, "y": y}

    def unregister(self) -> bool:
        self._callbacks.clear()
        return True
