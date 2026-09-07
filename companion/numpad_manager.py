#!/usr/bin/env python3
"""
Numpad Macro Pad Manager for CmdBar (Python implementation).
Manages 10 instant commands per layer (0-9), layer switching, and visual ASCII overlay HUD.
"""

import json
from typing import Dict, Any, List, Optional, Tuple, Union

DEFAULT_NUMPAD_CONFIG = {
    "enabled": True,
    "active_layer": 0,
    "overlay_visible": False,
    "layers": [
        {
            "id": "default",
            "name": "Default",
            "bindings": {
                "0": {"name": "System Status", "command": "top -b -n 1 | head -n 10"},
                "1": {"name": "Build Project", "command": "make build"},
                "2": {"name": "Run Tests", "command": "npm test"},
                "3": {"name": "Deploy Staging", "command": "echo Deploying to staging"},
                "4": {"name": "Mute Audio", "command": "pactl set-sink-mute @DEFAULT_SINK@ toggle"},
                "5": {"name": "Play/Pause Media", "command": "playerctl play-pause"},
                "6": {"name": "Screenshot Region", "command": "gnome-screenshot -a"},
                "7": {"name": "Toggle Terminal", "command": "gnome-terminal"},
                "8": {"name": "Git Status", "command": "git status"},
                "9": {"name": "Clear Cache", "command": "sync; echo 3 > /proc/sys/vm/drop_caches"}
            }
        },
        {
            "id": "gaming",
            "name": "Gaming",
            "bindings": {
                "0": {"name": "Mute Mic", "command": "pactl set-source-mute @DEFAULT_SOURCE@ toggle"},
                "1": {"name": "FPS Overlay", "command": "mangohud --toggle"},
                "2": {"name": "Record Replay", "command": "obs-cli replay-save"},
                "3": {"name": "Discord Overlay", "command": "discord-overlay-toggle"},
                "4": {"name": "Volume Down", "command": "pactl set-sink-volume @DEFAULT_SINK@ -5%"},
                "5": {"name": "Volume Up", "command": "pactl set-sink-volume @DEFAULT_SINK@ +5%"},
                "6": {"name": "Game Mode Toggle", "command": "gamemoded -t"},
                "7": {"name": "Performance Mode", "command": "powerprofilesctl set performance"},
                "8": {"name": "Balanced Mode", "command": "powerprofilesctl set balanced"},
                "9": {"name": "Power Saver Mode", "command": "powerprofilesctl set power-saver"}
            }
        },
        {
            "id": "dev",
            "name": "Developer",
            "bindings": {
                "0": {"name": "Git Pull", "command": "git pull origin main"},
                "1": {"name": "Git Push", "command": "git push origin"},
                "2": {"name": "Docker PS", "command": "docker ps"},
                "3": {"name": "Docker Up", "command": "docker-compose up -d"},
                "4": {"name": "Docker Down", "command": "docker-compose down"},
                "5": {"name": "Logs Tail", "command": "journalctl -f -u cmdbar"},
                "6": {"name": "Lint Code", "command": "npm run lint"},
                "7": {"name": "Build Docs", "command": "make compile"},
                "8": {"name": "Serve Docs", "command": "python3 scripts/serve_docs.py"},
                "9": {"name": "Clean Build", "command": "make clean"}
            }
        }
    ]
}


class NumpadManager:
    """
    Python Numpad Macro Pad Manager.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config if config is not None else {}
        self._overlay_visible = False

    def get_numpad_config(self) -> Dict[str, Any]:
        if "numpad" not in self.config or not isinstance(self.config["numpad"], dict):
            self.config["numpad"] = json.loads(json.dumps(DEFAULT_NUMPAD_CONFIG))
        np = self.config["numpad"]
        if "layers" not in np or not isinstance(np["layers"], list):
            np["layers"] = json.loads(json.dumps(DEFAULT_NUMPAD_CONFIG["layers"]))
        return np

    def is_enabled(self) -> bool:
        np = self.get_numpad_config()
        return np.get("enabled", True) is not False

    def set_enabled(self, enabled: bool) -> None:
        np = self.get_numpad_config()
        np["enabled"] = bool(enabled)

    def get_layers(self) -> List[Dict[str, Any]]:
        np = self.get_numpad_config()
        return np.get("layers", [])

    def get_active_layer_index(self) -> int:
        np = self.get_numpad_config()
        layers = self.get_layers()
        if not layers:
            return 0
        raw_idx = np.get("active_layer", 0)
        idx = 0
        if isinstance(raw_idx, int):
            idx = raw_idx
        elif isinstance(raw_idx, str):
            found_idx = next((i for i, l in enumerate(layers) if l.get("id") == raw_idx or l.get("name") == raw_idx), None)
            if found_idx is not None:
                idx = found_idx
            else:
                try:
                    idx = int(raw_idx)
                except ValueError:
                    idx = 0
        if idx < 0 or idx >= len(layers):
            idx = 0
        return idx

    def get_active_layer(self) -> Optional[Dict[str, Any]]:
        layers = self.get_layers()
        idx = self.get_active_layer_index()
        if 0 <= idx < len(layers):
            return layers[idx]
        return None

    def switch_layer(self, target: Union[int, str]) -> int:
        np = self.get_numpad_config()
        layers = self.get_layers()
        if not layers:
            return 0

        new_idx = 0
        if isinstance(target, int):
            new_idx = target % len(layers)
        elif isinstance(target, str):
            found_idx = next((i for i, l in enumerate(layers) if l.get("id") == target or l.get("name") == target), None)
            if found_idx is not None:
                new_idx = found_idx
            else:
                try:
                    new_idx = int(target) % len(layers)
                except ValueError:
                    new_idx = 0

        np["active_layer"] = new_idx
        return new_idx

    def cycle_layer(self) -> int:
        layers = self.get_layers()
        if not layers:
            return 0
        current = self.get_active_layer_index()
        next_idx = (current + 1) % len(layers)
        return self.switch_layer(next_idx)

    def get_binding(self, key_digit: Union[int, str]) -> Optional[Dict[str, Any]]:
        key_str = str(key_digit)
        layer = self.get_active_layer()
        if not layer or "bindings" not in layer:
            return None
        return layer["bindings"].get(key_str)

    def set_binding(self, layer_index_or_id: Union[int, str], key_digit: Union[int, str], binding_obj: Dict[str, Any]) -> bool:
        layers = self.get_layers()
        target_layer = None
        if isinstance(layer_index_or_id, int) and 0 <= layer_index_or_id < len(layers):
            target_layer = layers[layer_index_or_id]
        elif isinstance(layer_index_or_id, str):
            target_layer = next((l for l in layers if l.get("id") == layer_index_or_id or l.get("name") == layer_index_or_id), None)
            if not target_layer:
                try:
                    parsed = int(layer_index_or_id)
                    if 0 <= parsed < len(layers):
                        target_layer = layers[parsed]
                except ValueError:
                    pass

        if not target_layer:
            return False

        if "bindings" not in target_layer or not isinstance(target_layer["bindings"], dict):
            target_layer["bindings"] = {}

        target_layer["bindings"][str(key_digit)] = binding_obj
        return True

    def trigger_key(self, key_digit: Union[int, str], executor=None) -> Dict[str, Any]:
        if not self.is_enabled():
            return {"success": False, "reason": "Numpad disabled"}

        binding = self.get_binding(key_digit)
        if not binding or not (binding.get("command") or binding.get("template")):
            return {"success": False, "reason": f"No binding for key {key_digit}"}

        name = binding.get("name", f"Numpad Key {key_digit}")
        cmd = binding.get("command") or binding.get("template")

        if callable(executor):
            try:
                executor(name, cmd, binding)
            except Exception:
                pass

        return {"success": True, "key": int(key_digit), "name": name, "command": cmd}

    def toggle_overlay(self) -> bool:
        self._overlay_visible = not self._overlay_visible
        np = self.get_numpad_config()
        np["overlay_visible"] = self._overlay_visible
        return self._overlay_visible

    def is_overlay_visible(self) -> bool:
        return self._overlay_visible

    def get_overlay_data(self) -> Dict[str, Any]:
        layer = self.get_active_layer()
        layers = self.get_layers()
        active_idx = self.get_active_layer_index()
        bindings = layer.get("bindings", {}) if layer else {}

        grid_keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0"]
        grid = []
        for k in grid_keys:
            b = bindings.get(k)
            cmd = (b.get("command") or b.get("template")) if b else ""
            grid.append({
                "key": k,
                "name": b.get("name") if b else "Unbound",
                "command": cmd,
                "bound": bool(b and cmd)
            })

        return {
            "enabled": self.is_enabled(),
            "activeLayerIndex": active_idx,
            "activeLayerName": layer.get("name", "None") if layer else "None",
            "layerCount": len(layers),
            "layers": [{"index": i, "name": l.get("name", ""), "id": l.get("id", ""), "active": i == active_idx} for i, l in enumerate(layers)],
            "grid": grid
        }

    def format_overlay_ascii(self) -> str:
        data = self.get_overlay_data()
        lines = []
        lines.append("+---------------------------------------------+")
        lines.append(f"| CmdBar Numpad Macro Pad - Layer: {data['activeLayerName'][:11].ljust(11)}|")
        lines.append("+---------------------------------------------+")

        def find_key(k):
            return next((item for item in data["grid"] if item["key"] == k), {"name": "Unbound"})

        k7, k8, k9 = find_key("7"), find_key("8"), find_key("9")
        lines.append(f"| [7] {k7['name'][:10].ljust(10)} | [8] {k8['name'][:10].ljust(10)} | [9] {k9['name'][:10].ljust(10)} |")

        k4, k5, k6 = find_key("4"), find_key("5"), find_key("6")
        lines.append(f"| [4] {k4['name'][:10].ljust(10)} | [5] {k5['name'][:10].ljust(10)} | [6] {k6['name'][:10].ljust(10)} |")

        k1, k2, k3 = find_key("1"), find_key("2"), find_key("3")
        lines.append(f"| [1] {k1['name'][:10].ljust(10)} | [2] {k2['name'][:10].ljust(10)} | [3] {k3['name'][:10].ljust(10)} |")

        k0 = find_key("0")
        lines.append(f"| [0] {k0['name'][:38].ljust(38)} |")
        lines.append("+---------------------------------------------+")
        return "\n".join(lines)
