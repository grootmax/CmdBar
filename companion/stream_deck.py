#!/usr/bin/env python3
"""
CmdBar Stream Deck Integration Module

Provides full integration with Elgato Stream Deck devices and software.
Supports visual buttons for commands, feedback LEDs, dynamic labels,
profile switching, and performance optimizations.
"""

import os
import json
import time
import base64
import re
import hashlib
import threading
from typing import Dict, List, Optional, Tuple, Any
from companion.companion_app import load_config, save_config, run_command_in_shell


def _load_config_data(path=None):
    if path:
        os.environ["CMDBAR_CONFIG_PATH"] = path
    return load_config()


def _save_config_data(data, path=None):
    if path:
        os.environ["CMDBAR_CONFIG_PATH"] = path
    return save_config(data)


class LEDState:
    """
    LED feedback states for Stream Deck keys.
    :visibility: public
    """
    IDLE = "idle"
    RUNNING = "running"
    SUCCESS = "success"
    ERROR = "error"

    COLOR_MAP = {
        "idle": "#4A5568",      # Slate Gray
        "running": "#ECC94B",   # Amber / Yellow
        "success": "#48BB78",   # Green
        "error": "#F56565"      # Red
    }

    SYMBOL_MAP = {
        "idle": "⚪",
        "running": "⚡",
        "success": "✓",
        "error": "✗"
    }


class DeviceModel:
    """
    Stream Deck device models and grid layouts.
    :visibility: public
    """
    MINI = "MINI"          # 2x3 (6 keys)
    ORIGINAL = "ORIGINAL"  # 3x5 (15 keys)
    XL = "XL"              # 4x8 (32 keys)
    PLUS = "PLUS"          # 2x4 (8 keys + dials)

    CONFIGS = {
        "MINI": {"rows": 2, "cols": 3, "keys": 6},
        "ORIGINAL": {"rows": 3, "cols": 5, "keys": 15},
        "XL": {"rows": 4, "cols": 8, "keys": 32},
        "PLUS": {"rows": 2, "cols": 4, "keys": 8}
    }


class StreamDeckKey:
    """
    Represents an individual Stream Deck key binding and display properties.
    :visibility: public
    """
    def __init__(
        self,
        key_index: int,
        command_name: str = "",
        label_template: str = "{name}",
        custom_label: str = "",
        icon: str = "utilities-terminal-symbolic",
        bg_color: str = "#1A202C",
        text_color: str = "#FFFFFF",
        led_state: str = LEDState.IDLE,
        action_type: str = "command",
        target_profile: str = "",
        parameters: Optional[Dict[str, Any]] = None
    ):
        self.key_index = int(key_index)
        self.command_name = str(command_name)
        self.label_template = str(label_template) if label_template else "{name}"
        self.custom_label = str(custom_label)
        self.icon = str(icon) if icon else "utilities-terminal-symbolic"
        self.bg_color = str(bg_color)
        self.text_color = str(text_color)
        self.led_state = str(led_state)
        self.action_type = str(action_type)  # "command", "switch_profile", "brightness", "toggle_led"
        self.target_profile = str(target_profile)
        self.parameters = dict(parameters) if isinstance(parameters, dict) else {}
        self.last_output = ""
        self.last_executed = 0.0
        self.execution_time_ms = 0.0

    def to_dict(self) -> Dict[str, Any]:
        """
        Converts key data to dictionary format.
        :visibility: public
        """
        return {
            "key_index": self.key_index,
            "command_name": self.command_name,
            "label_template": self.label_template,
            "custom_label": self.custom_label,
            "icon": self.icon,
            "bg_color": self.bg_color,
            "text_color": self.text_color,
            "led_state": self.led_state,
            "action_type": self.action_type,
            "target_profile": self.target_profile,
            "parameters": self.parameters,
            "last_output": self.last_output,
            "last_executed": self.last_executed,
            "execution_time_ms": self.execution_time_ms
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "StreamDeckKey":
        """
        Creates a StreamDeckKey instance from a dictionary.
        :visibility: public
        """
        key = cls(
            key_index=data.get("key_index", 0),
            command_name=data.get("command_name", ""),
            label_template=data.get("label_template", "{name}"),
            custom_label=data.get("custom_label", ""),
            icon=data.get("icon", "utilities-terminal-symbolic"),
            bg_color=data.get("bg_color", "#1A202C"),
            text_color=data.get("text_color", "#FFFFFF"),
            led_state=data.get("led_state", LEDState.IDLE),
            action_type=data.get("action_type", "command"),
            target_profile=data.get("target_profile", ""),
            parameters=data.get("parameters", {})
        )
        key.last_output = data.get("last_output", "")
        key.last_executed = data.get("last_executed", 0.0)
        key.execution_time_ms = data.get("execution_time_ms", 0.0)
        return key


class StreamDeckProfile:
    """
    Represents a layout profile mapping keys for a specific device model.
    :visibility: public
    """
    def __init__(
        self,
        name: str,
        device_model: str = DeviceModel.ORIGINAL,
        bg_color: str = "#0D1117",
        auto_switch_category: Optional[str] = None
    ):
        self.name = str(name).strip()
        self.device_model = device_model if device_model in DeviceModel.CONFIGS else DeviceModel.ORIGINAL
        self.bg_color = str(bg_color)
        self.auto_switch_category = auto_switch_category
        self.keys: Dict[int, StreamDeckKey] = {}

    def get_max_keys(self) -> int:
        """
        Returns max number of keys for profile device model.
        :visibility: public
        """
        return DeviceModel.CONFIGS.get(self.device_model, {}).get("keys", 15)

    def set_key(self, key: StreamDeckKey):
        """
        Sets a key binding on this profile.
        :visibility: public
        """
        if 0 <= key.key_index < self.get_max_keys():
            self.keys[key.key_index] = key

    def get_key(self, key_index: int) -> Optional[StreamDeckKey]:
        """
        Retrieves a key by index.
        :visibility: public
        """
        return self.keys.get(int(key_index))

    def remove_key(self, key_index: int) -> bool:
        """
        Removes a key binding by index.
        :visibility: public
        """
        idx = int(key_index)
        if idx in self.keys:
            del self.keys[idx]
            return True
        return False

    def to_dict(self) -> Dict[str, Any]:
        """
        Converts profile to dictionary format.
        :visibility: public
        """
        return {
            "name": self.name,
            "device_model": self.device_model,
            "bg_color": self.bg_color,
            "auto_switch_category": self.auto_switch_category,
            "keys": {str(idx): key.to_dict() for idx, key in self.keys.items()}
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "StreamDeckProfile":
        """
        Creates a StreamDeckProfile instance from a dictionary.
        :visibility: public
        """
        profile = cls(
            name=data.get("name", "Default"),
            device_model=data.get("device_model", DeviceModel.ORIGINAL),
            bg_color=data.get("bg_color", "#0D1117"),
            auto_switch_category=data.get("auto_switch_category")
        )
        keys_data = data.get("keys", {})
        if isinstance(keys_data, dict):
            for idx_str, k_data in keys_data.items():
                try:
                    k_obj = StreamDeckKey.from_dict(k_data)
                    profile.set_key(k_obj)
                except Exception:
                    pass
        return profile


class StreamDeckManager:
    """
    Main Manager for Stream Deck integration in CmdBar.
    Manages profiles, button bindings, feedback LEDs, dynamic labels,
    key rendering, execution, and performance optimization.
    :visibility: public
    """
    def __init__(self, config_path: Optional[str] = None):
        self.config_path = config_path
        self.profiles: Dict[str, StreamDeckProfile] = {}
        self.active_profile_name: str = "Default"
        self._lock = threading.Lock()
        self._render_cache: Dict[str, Dict[str, Any]] = {}
        self._execution_listeners: List[Any] = []
        self._stats = {
            "total_renders": 0,
            "cache_hits": 0,
            "key_presses": 0,
            "avg_render_time_ms": 0.0,
            "avg_press_latency_ms": 0.0
        }
        self.load_profiles()

    def add_execution_listener(self, listener: Any):
        """
        Adds a callback listener for key execution events.
        :visibility: public
        """
        if listener not in self._execution_listeners:
            self._execution_listeners.append(listener)

    def load_profiles(self):
        """
        Loads Stream Deck profiles from main CmdBar configuration.
        :visibility: public
        """
        with self._lock:
            config = _load_config_data(self.config_path)
            sd_config = config.get("stream_deck", {})
            self.active_profile_name = sd_config.get("active_profile", "Default")
            
            raw_profiles = sd_config.get("profiles", {})
            self.profiles = {}

            if isinstance(raw_profiles, dict) and raw_profiles:
                for p_name, p_data in raw_profiles.items():
                    self.profiles[p_name] = StreamDeckProfile.from_dict(p_data)

            # Ensure default profile exists
            if "Default" not in self.profiles:
                default_profile = StreamDeckProfile("Default", device_model=DeviceModel.ORIGINAL)
                # Auto-populate default profile with existing commands from config
                categories = config.get("categories", [])
                key_idx = 0
                max_keys = default_profile.get_max_keys()
                for cat in categories:
                    for cmd in cat.get("commands", []):
                        if key_idx >= max_keys:
                            break
                        cmd_name = cmd.get("name", f"Command {key_idx + 1}")
                        key = StreamDeckKey(
                            key_index=key_idx,
                            command_name=cmd_name,
                            label_template="{name}",
                            icon="utilities-terminal-symbolic",
                            bg_color="#1A202C"
                        )
                        default_profile.set_key(key)
                        key_idx += 1
                    if key_idx >= max_keys:
                        break
                self.profiles["Default"] = default_profile

            if self.active_profile_name not in self.profiles:
                self.active_profile_name = list(self.profiles.keys())[0]

    def save_profiles(self) -> bool:
        """
        Saves Stream Deck profiles back to main CmdBar configuration.
        :visibility: public
        """
        with self._lock:
            config = _load_config_data(self.config_path)
            config["stream_deck"] = {
                "active_profile": self.active_profile_name,
                "profiles": {p_name: prof.to_dict() for p_name, prof in self.profiles.items()}
            }
            return _save_config_data(config, self.config_path)

    def create_profile(
        self,
        name: str,
        device_model: str = DeviceModel.ORIGINAL,
        auto_switch_category: Optional[str] = None
    ) -> StreamDeckProfile:
        """
        Creates a new profile and saves configuration.
        :visibility: public
        """
        clean_name = str(name).strip()
        if not clean_name:
            raise ValueError("Profile name cannot be empty.")
        
        profile = StreamDeckProfile(clean_name, device_model=device_model, auto_switch_category=auto_switch_category)
        self.profiles[clean_name] = profile
        self.save_profiles()
        return profile

    def delete_profile(self, name: str) -> bool:
        """
        Deletes a profile by name. Cannot delete the active or last remaining profile.
        :visibility: public
        """
        clean_name = str(name).strip()
        if clean_name not in self.profiles:
            return False
        if len(self.profiles) <= 1:
            return False  # Do not delete last profile
        
        del self.profiles[clean_name]
        if self.active_profile_name == clean_name:
            self.active_profile_name = list(self.profiles.keys())[0]
        
        self.save_profiles()
        return True

    def get_profile(self, name: str) -> Optional[StreamDeckProfile]:
        """
        Gets profile by name.
        :visibility: public
        """
        return self.profiles.get(str(name).strip())

    def list_profiles(self) -> List[str]:
        """
        Lists all available profile names.
        :visibility: public
        """
        return list(self.profiles.keys())

    def set_active_profile(self, name: str) -> bool:
        """
        Switches current active profile.
        :visibility: public
        """
        clean_name = str(name).strip()
        if clean_name in self.profiles:
            self.active_profile_name = clean_name
            self.clear_render_cache()
            self.save_profiles()
            return True
        return False

    def get_active_profile(self) -> StreamDeckProfile:
        """
        Returns the active StreamDeckProfile.
        :visibility: public
        """
        return self.profiles[self.active_profile_name]

    def set_key_binding(
        self,
        key_index: int,
        command_name: str,
        label_template: str = "{name}",
        custom_label: str = "",
        icon: str = "utilities-terminal-symbolic",
        bg_color: str = "#1A202C",
        action_type: str = "command",
        target_profile: str = "",
        parameters: Optional[Dict[str, Any]] = None,
        profile_name: Optional[str] = None
    ) -> StreamDeckKey:
        """
        Binds or updates a key configuration on a profile.
        :visibility: public
        """
        p_name = profile_name or self.active_profile_name
        profile = self.get_profile(p_name)
        if not profile:
            raise ValueError(f"Profile '{p_name}' does not exist.")

        key = StreamDeckKey(
            key_index=key_index,
            command_name=command_name,
            label_template=label_template,
            custom_label=custom_label,
            icon=icon,
            bg_color=bg_color,
            action_type=action_type,
            target_profile=target_profile,
            parameters=parameters
        )
        profile.set_key(key)
        self.clear_render_cache()
        self.save_profiles()
        return key

    def clear_key_binding(self, key_index: int, profile_name: Optional[str] = None) -> bool:
        """
        Clears key binding at key_index on specified profile or active profile.
        :visibility: public
        """
        p_name = profile_name or self.active_profile_name
        profile = self.get_profile(p_name)
        if not profile:
            return False
        res = profile.remove_key(key_index)
        if res:
            self.clear_render_cache()
            self.save_profiles()
        return res

    def auto_switch_for_category(self, category_name: str) -> Optional[str]:
        """
        Auto-switches to the profile matching auto_switch_category if found.
        :visibility: public
        """
        if not category_name:
            return None
        cat_lower = category_name.strip().lower()
        for p_name, profile in self.profiles.items():
            if profile.auto_switch_category and profile.auto_switch_category.strip().lower() == cat_lower:
                if self.set_active_profile(p_name):
                    return p_name
        return None

    def update_key_led_state(
        self,
        key_index: int,
        state: str,
        last_output: Optional[str] = None,
        profile_name: Optional[str] = None
    ):
        """
        Updates LED state and output info for a key.
        :visibility: public
        """
        p_name = profile_name or self.active_profile_name
        profile = self.get_profile(p_name)
        if profile:
            key = profile.get_key(key_index)
            if key:
                key.led_state = state
                if last_output is not None:
                    key.last_output = last_output
                self.clear_render_cache(key_index)

    def resolve_dynamic_label(self, key: StreamDeckKey, context: Optional[Dict[str, Any]] = None) -> str:
        """
        Resolves dynamic label template variables for key display.
        :visibility: public
        """
        if key.custom_label:
            tmpl = key.custom_label
        else:
            tmpl = key.label_template or "{name}"

        ctx = {
            "name": key.command_name or "Unbound",
            "status": key.led_state,
            "time": time.strftime("%H:%M"),
            "last_output": key.last_output[:20] if key.last_output else "",
            "execution_time": f"{key.execution_time_ms:.0f}ms" if key.execution_time_ms else ""
        }
        if isinstance(context, dict):
            ctx.update(context)
        if isinstance(key.parameters, dict):
            ctx.update(key.parameters)

        def replacer(match):
            var_name = match.group(1).strip()
            return str(ctx.get(var_name, match.group(0)))

        res = re.sub(r"\{([^}]+)\}", replacer, tmpl)
        # Format / truncate long labels for small Stream Deck screen
        lines = res.split("\n")
        truncated_lines = [line[:16] for line in lines[:3]]
        return "\n".join(truncated_lines)

    def render_key_visual(self, key_index: int, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Renders visual button representation (SVG markup, LED color, dynamic label)
        for a key slot on active profile. Uses render caching for high performance.
        :visibility: public
        """
        start_t = time.perf_counter()
        profile = self.get_active_profile()
        key = profile.get_key(key_index)

        cache_key = f"{profile.name}:{key_index}:{key.to_dict() if key else 'empty'}:{context}"
        cache_hash = hashlib.md5(cache_key.encode("utf-8")).hexdigest()

        if cache_hash in self._render_cache:
            self._stats["cache_hits"] += 1
            return self._render_cache[cache_hash]

        if key is None:
            label = ""
            bg_color = profile.bg_color
            led_color = LEDState.COLOR_MAP["idle"]
            led_state = LEDState.IDLE
            icon = ""
            action_type = "none"
        else:
            label = self.resolve_dynamic_label(key, context)
            bg_color = key.bg_color
            led_state = key.led_state
            led_color = LEDState.COLOR_MAP.get(led_state, LEDState.COLOR_MAP["idle"])
            icon = key.icon
            action_type = key.action_type

        # Generate clean SVG render buffer
        svg = self._generate_key_svg(label, bg_color, led_color, led_state, icon)
        svg_base64 = "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode("utf-8")

        result = {
            "key_index": key_index,
            "label": label,
            "bg_color": bg_color,
            "led_state": led_state,
            "led_color": led_color,
            "led_symbol": LEDState.SYMBOL_MAP.get(led_state, "⚪"),
            "action_type": action_type,
            "svg": svg,
            "svg_base64": svg_base64
        }

        self._render_cache[cache_hash] = result
        elapsed_ms = (time.perf_counter() - start_t) * 1000.0
        self._stats["total_renders"] += 1
        n = self._stats["total_renders"]
        self._stats["avg_render_time_ms"] = ((n - 1) * self._stats["avg_render_time_ms"] + elapsed_ms) / n

        return result

    def _generate_key_svg(
        self,
        label: str,
        bg_color: str,
        led_color: str,
        led_state: str,
        icon: str
    ) -> str:
        """
        Helper method to produce vector SVG visual layout for Stream Deck button key.
        """
        label_lines = label.split("\n") if label else []
        text_elements = []
        y_start = 42 if len(label_lines) <= 1 else (36 if len(label_lines) == 2 else 28)
        for idx, line in enumerate(label_lines):
            y_pos = y_start + (idx * 16)
            text_elements.append(
                f'<text x="36" y="{y_pos}" font-family="sans-serif" font-size="11" font-weight="bold" '
                f'fill="#FFFFFF" text-anchor="middle">{self._escape_xml(line)}</text>'
            )

        text_markup = "\n".join(text_elements)
        pulse_anim = ""
        if led_state == LEDState.RUNNING:
            pulse_anim = '<animate attributeName="opacity" values="0.4;1.0;0.4" dur="1s" repeatCount="indefinite" />'

        svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">
  <rect width="72" height="72" rx="10" ry="10" fill="{bg_color}" stroke="#2D3748" stroke-width="2"/>
  <circle cx="60" cy="12" r="5" fill="{led_color}">{pulse_anim}</circle>
  {text_markup}
</svg>"""
        return svg

    def _escape_xml(self, text: str) -> str:
        return (
            text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&apos;")
        )

    def render_profile_grid(self, context: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """
        Renders full visual key grid for active profile.
        :visibility: public
        """
        profile = self.get_active_profile()
        max_keys = profile.get_max_keys()
        grid = []
        for i in range(max_keys):
            grid.append(self.render_key_visual(i, context))
        return grid

    def press_key(
        self,
        key_index: int,
        context_params: Optional[Dict[str, Any]] = None,
        async_execution: bool = False
    ) -> Dict[str, Any]:
        """
        Triggers button press on specified key index.
        Executes action (command or profile switch), manages feedback LED state transitions,
        and returns result metadata.
        :visibility: public
        """
        start_t = time.perf_counter()
        profile = self.get_active_profile()
        key = profile.get_key(key_index)

        if key is None:
            return {
                "success": False,
                "key_index": key_index,
                "error": "No binding assigned to key index."
            }

        self._stats["key_presses"] += 1

        # Handle Profile Switch action
        if key.action_type == "switch_profile":
            target = key.target_profile
            switched = self.set_active_profile(target)
            elapsed_ms = (time.perf_counter() - start_t) * 1000.0
            return {
                "success": switched,
                "key_index": key_index,
                "action_type": "switch_profile",
                "target_profile": target,
                "execution_time_ms": elapsed_ms
            }

        # Handle Command Execution action
        # 1. Update LED to RUNNING
        self.update_key_led_state(key_index, LEDState.RUNNING)

        config = _load_config_data(self.config_path)
        cmd_str = None
        for cat in config.get("categories", []):
            for c in cat.get("commands", []):
                if c.get("name") == key.command_name:
                    cmd_str = c.get("command") or c.get("template")
                    break
            if cmd_str:
                break

        if not cmd_str:
            cmd_str = key.command_name

        def _execute():
            sub_start = time.perf_counter()
            code, stdout, stderr = run_command_in_shell(cmd_str)
            exec_ms = (time.perf_counter() - sub_start) * 1000.0
            
            success = (code == 0)
            output = stdout.strip() if stdout else stderr.strip()

            key.last_output = output
            key.last_executed = time.time()
            key.execution_time_ms = exec_ms

            led_st = LEDState.SUCCESS if success else LEDState.ERROR
            self.update_key_led_state(key_index, led_st, last_output=output)

            result_meta = {
                "success": success,
                "key_index": key_index,
                "command_name": key.command_name,
                "command_str": cmd_str,
                "code": code,
                "stdout": stdout,
                "stderr": stderr,
                "execution_time_ms": exec_ms
            }

            for listener in self._execution_listeners:
                try:
                    listener(key_index, key.command_name, result_meta)
                except Exception:
                    pass

            return result_meta

        if async_execution:
            thread = threading.Thread(target=_execute)
            thread.daemon = True
            thread.start()
            elapsed_ms = (time.perf_counter() - start_t) * 1000.0
            return {
                "success": True,
                "key_index": key_index,
                "status": "async_started",
                "execution_time_ms": elapsed_ms
            }
        else:
            res = _execute()
            total_latency_ms = (time.perf_counter() - start_t) * 1000.0
            n = self._stats["key_presses"]
            self._stats["avg_press_latency_ms"] = ((n - 1) * self._stats["avg_press_latency_ms"] + total_latency_ms) / n
            res["total_latency_ms"] = total_latency_ms
            return res

    def clear_render_cache(self, key_index: Optional[int] = None):
        """
        Clears render cache.
        :visibility: public
        """
        if key_index is None:
            self._render_cache.clear()
        else:
            to_del = [k for k in self._render_cache if f":{key_index}:" in k]
            for k in to_del:
                del self._render_cache[k]

    def export_profile_json(self, profile_name: str) -> str:
        """
        Exports a profile to JSON string.
        :visibility: public
        """
        profile = self.get_profile(profile_name)
        if not profile:
            raise ValueError(f"Profile '{profile_name}' not found.")
        return json.dumps(profile.to_dict(), indent=2)

    def import_profile_json(self, json_data: str) -> StreamDeckProfile:
        """
        Imports a profile from JSON string.
        :visibility: public
        """
        data = json.loads(json_data)
        profile = StreamDeckProfile.from_dict(data)
        self.profiles[profile.name] = profile
        self.save_profiles()
        return profile

    def get_performance_stats(self) -> Dict[str, Any]:
        """
        Returns performance stats and cache metrics.
        :visibility: public
        """
        return {
            "active_profile": self.active_profile_name,
            "total_profiles": len(self.profiles),
            "cached_renders_count": len(self._render_cache),
            "total_renders": self._stats["total_renders"],
            "cache_hits": self._stats["cache_hits"],
            "key_presses": self._stats["key_presses"],
            "avg_render_time_ms": round(self._stats["avg_render_time_ms"], 4),
            "avg_press_latency_ms": round(self._stats["avg_press_latency_ms"], 4)
        }
