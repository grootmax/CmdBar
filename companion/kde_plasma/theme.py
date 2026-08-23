"""
Plasma Theme Adapter for CmdBar Python Companion.
Parses KDE kdeglobals / KColorScheme settings and provides theme palettes,
CSS custom variables, and formatting color schemes matching KDE Plasma HIG.
"""

import os
import configparser
from typing import Dict, Any, Callable, Set, Tuple


class PlasmaThemeAdapter:
    def __init__(self, is_dark: bool = True, scheme_name: str = "BreezeDark"):
        self.is_dark = is_dark
        self.scheme_name = scheme_name
        self._listeners: Set[Callable[[bool, Dict[str, str]], None]] = set()
        self._palette = self._build_palette(self.is_dark)
        self.detect_system_theme()

    def _build_palette(self, dark: bool) -> Dict[str, str]:
        if dark:
            return {
                "windowBackground": "#2a2e32",
                "windowText": "#fcfcfc",
                "viewBackground": "#232629",
                "viewText": "#fcfcfc",
                "headerBackground": "#31363b",
                "headerText": "#eff0f1",
                "buttonBackground": "#31363b",
                "buttonText": "#eff0f1",
                "highlight": "#3daee9",
                "highlightedText": "#ffffff",
                "tooltipBackground": "#31363b",
                "tooltipText": "#eff0f1",
                "borderColor": "#4d4d4d",
                "codeBackground": "#1b1e20",
                "successColor": "#2ecc71",
                "errorColor": "#e74c3c",
            }
        else:
            return {
                "windowBackground": "#eff0f1",
                "windowText": "#232629",
                "viewBackground": "#ffffff",
                "viewText": "#232629",
                "headerBackground": "#e3e5e7",
                "headerText": "#232629",
                "buttonBackground": "#e3e5e7",
                "buttonText": "#232629",
                "highlight": "#3daee9",
                "highlightedText": "#ffffff",
                "tooltipBackground": "#fcfcfc",
                "tooltipText": "#232629",
                "borderColor": "#bcbebf",
                "codeBackground": "#f5f5f5",
                "successColor": "#27ae60",
                "errorColor": "#c0392b",
            }

    def detect_system_theme(self) -> bool:
        """
        Parses ~/.config/kdeglobals file if present.
        """
        config_path = os.path.expanduser("~/.config/kdeglobals")
        if os.path.exists(config_path):
            try:
                parser = configparser.ConfigParser()
                parser.read(config_path)
                if "General" in parser and "ColorScheme" in parser["General"]:
                    scheme = parser["General"]["ColorScheme"]
                    self.scheme_name = scheme
                    self.is_dark = "dark" in scheme.lower()
                    self._palette = self._build_palette(self.is_dark)
                    return True
            except Exception:
                pass
        return False

    def set_dark(self, dark: bool) -> Dict[str, str]:
        self.is_dark = bool(dark)
        self.scheme_name = "BreezeDark" if self.is_dark else "BreezeLight"
        self._palette = self._build_palette(self.is_dark)
        self._notify()
        return dict(self._palette)

    def set_scheme(self, scheme: str) -> Dict[str, str]:
        if not scheme or not isinstance(scheme, str):
            return dict(self._palette)
        name = scheme.strip()
        self.scheme_name = name
        self.is_dark = "dark" in name.lower()
        self._palette = self._build_palette(self.is_dark)
        self._notify()
        return dict(self._palette)

    def get_palette(self) -> Dict[str, str]:
        return dict(self._palette)

    def to_css_variables(self) -> str:
        p = self._palette
        return f"""
        :root {{
            --plasma-window-bg: {p['windowBackground']};
            --plasma-window-fg: {p['windowText']};
            --plasma-view-bg: {p['viewBackground']};
            --plasma-view-fg: {p['viewText']};
            --plasma-button-bg: {p['buttonBackground']};
            --plasma-button-fg: {p['buttonText']};
            --plasma-highlight: {p['highlight']};
            --plasma-highlight-fg: {p['highlightedText']};
            --plasma-border: {p['borderColor']};
            --plasma-code-bg: {p['codeBackground']};
        }}
        """.strip()

    def get_formatting_colors(self) -> Dict[str, str]:
        p = self._palette
        return {
            "key": p["highlight"],
            "string": p["successColor"],
            "number": "#f39c12",
            "boolean": "#9b59b6",
            "nullValue": "#95a5a6",
            "border": p["borderColor"],
            "bg": p["codeBackground"],
            "fg": p["viewText"],
        }

    def on_theme_changed(self, callback: Callable[[bool, Dict[str, str]], None]):
        if callable(callback):
            self._listeners.add(callback)

    def _notify(self):
        for cb in list(self._listeners):
            try:
                cb(self.is_dark, self._palette)
            except Exception:
                pass
