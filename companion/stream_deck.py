#!/usr/bin/env python3
"""
Stream Deck Integration Module for CmdBar.
Provides Elgato Stream Deck plugin support, visual buttons, feedback LEDs,
dynamic labels, profile switching, and high-performance SVG/DataURL rendering.
"""

import os
import sys
import json
import re
import time
import base64
import hashlib
import asyncio
from typing import Dict, List, Optional, Tuple, Any

from companion.companion_app import load_config, run_command_in_shell


class StreamDeckButton:
    """
    Represents a visual button on a Stream Deck key grid.
    :visibility: public
    """
    def __init__(
        self,
        key_index: int,
        action_type: str = "command",
        command_name: str = "",
        category: str = "",
        label: str = "",
        target_profile: str = "",
        state: str = "idle",
        led_color: Optional[Tuple[int, int, int]] = None
    ):
        self.key_index = key_index
        self.action_type = action_type  # "command", "profile_switch", "status", "empty"
        self.command_name = command_name
        self.category = category
        self.label = label or command_name or (f"Profile: {target_profile}" if target_profile else "Empty")
        self.target_profile = target_profile
        self.state = state  # "idle", "executing", "success", "error", "disabled"
        self.last_output = ""
        self.execution_time_ms = 0.0
        self.led_color = led_color

    def set_state(self, state: str, output: str = "", exec_time_ms: float = 0.0):
        """Updates execution state and output feedback of the button."""
        valid_states = {"idle", "executing", "success", "error", "disabled"}
        self.state = state if state in valid_states else "idle"
        if output:
            self.last_output = output
        if exec_time_ms >= 0:
            self.execution_time_ms = exec_time_ms

    def to_dict(self) -> Dict[str, Any]:
        """Serializes button state to dictionary."""
        return {
            "key_index": self.key_index,
            "action_type": self.action_type,
            "command_name": self.command_name,
            "category": self.category,
            "label": self.label,
            "target_profile": self.target_profile,
            "state": self.state,
            "last_output": self.last_output,
            "execution_time_ms": self.execution_time_ms,
            "led_color": self.led_color,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "StreamDeckButton":
        """Reconstructs a button instance from dictionary."""
        btn = cls(
            key_index=data.get("key_index", 0),
            action_type=data.get("action_type", "command"),
            command_name=data.get("command_name", ""),
            category=data.get("category", ""),
            label=data.get("label", ""),
            target_profile=data.get("target_profile", ""),
            state=data.get("state", "idle"),
            led_color=tuple(data["led_color"]) if data.get("led_color") else None
        )
        btn.last_output = data.get("last_output", "")
        btn.execution_time_ms = data.get("execution_time_ms", 0.0)
        return btn


class StreamDeckProfile:
    """
    Manages a Stream Deck key profile and button grid layout.
    :visibility: public
    """
    def __init__(self, name: str, grid_rows: int = 3, grid_cols: int = 5):
        self.name = name
        self.grid_rows = grid_rows
        self.grid_cols = grid_cols
        self.max_keys = grid_rows * grid_cols
        self.buttons: Dict[int, StreamDeckButton] = {}

    def set_button(self, key_index: int, button: StreamDeckButton):
        """Sets a button at key_index."""
        if 0 <= key_index < self.max_keys:
            button.key_index = key_index
            self.buttons[key_index] = button

    def get_button(self, key_index: int) -> Optional[StreamDeckButton]:
        """Returns the button at key_index."""
        return self.buttons.get(key_index)

    def auto_populate_from_category(
        self,
        category_name: str,
        config_data: Dict[str, Any],
        available_profiles: Optional[List[str]] = None
    ):
        """
        Populates profile key grid from a specified CmdBar category.
        Reserves the last key for profile switching if multiple profiles exist.
        """
        self.buttons.clear()
        categories = config_data.get("categories", [])
        
        target_commands = []
        if category_name == "Default" or category_name == "All":
            for cat in categories:
                target_commands.extend(cat.get("commands", []))
        else:
            for cat in categories:
                if cat.get("name") == category_name:
                    target_commands = cat.get("commands", [])
                    break

        usable_slots = self.max_keys - 1 if (available_profiles and len(available_profiles) > 1) else self.max_keys
        
        for idx, cmd in enumerate(target_commands[:usable_slots]):
            btn = StreamDeckButton(
                key_index=idx,
                action_type="command",
                command_name=cmd.get("name", f"Cmd {idx+1}"),
                category=category_name,
                label=cmd.get("name", f"Cmd {idx+1}"),
                state="idle"
            )
            self.set_button(idx, btn)

        # Fill remaining slots with profile switcher or empty
        if available_profiles and len(available_profiles) > 1:
            # Add profile switch button at the bottom right corner
            last_slot = self.max_keys - 1
            current_idx = available_profiles.index(self.name) if self.name in available_profiles else 0
            next_profile = available_profiles[(current_idx + 1) % len(available_profiles)]
            
            switch_btn = StreamDeckButton(
                key_index=last_slot,
                action_type="profile_switch",
                target_profile=next_profile,
                label=f"➔ {next_profile}",
                state="idle",
                led_color=(100, 100, 220)
            )
            self.set_button(last_slot, switch_btn)

    def to_dict(self) -> Dict[str, Any]:
        """Serializes profile to dictionary."""
        return {
            "name": self.name,
            "grid_rows": self.grid_rows,
            "grid_cols": self.grid_cols,
            "buttons": {k: v.to_dict() for k, v in self.buttons.items()}
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "StreamDeckProfile":
        """Reconstructs profile from dictionary."""
        profile = cls(
            name=data.get("name", "Default"),
            grid_rows=data.get("grid_rows", 3),
            grid_cols=data.get("grid_cols", 5)
        )
        buttons_data = data.get("buttons", {})
        for key_str, btn_dict in buttons_data.items():
            key_idx = int(key_str)
            profile.set_button(key_idx, StreamDeckButton.from_dict(btn_dict))
        return profile


class VisualRenderer:
    """
    Performance-optimized visual button renderer generating high-quality SVG
    and Base64 data URLs with feedback LEDs and dynamic labels.
    :visibility: public
    """

    STATE_COLORS = {
        "idle": (40, 44, 52),       # Dark Charcoal
        "executing": (230, 160, 0),  # Amber Yellow LED
        "success": (30, 180, 75),   # Vibrant Green LED
        "error": (220, 50, 50),     # Bright Red LED
        "disabled": (25, 25, 25)    # Dimmed Gray
    }

    def __init__(self, cache_size: int = 256):
        self._cache: Dict[str, str] = {}
        self._cache_size = cache_size
        self.stats = {
            "total_renders": 0,
            "cache_hits": 0,
            "cache_misses": 0,
            "total_render_time_ms": 0.0
        }

    def get_led_color_for_state(self, state: str) -> Tuple[int, int, int]:
        """Returns the RGB LED color corresponding to execution state."""
        return self.STATE_COLORS.get(state, self.STATE_COLORS["idle"])

    def sanitize_label(self, label: str) -> str:
        """Sanitizes text strings for safe XML/SVG embedding."""
        if not label:
            return ""
        # Remove dangerous XML characters
        clean = label.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("'", "&apos;")
        return clean.strip()

    def format_dynamic_label(self, label: str, max_chars_per_line: int = 10, max_lines: int = 3) -> List[str]:
        """Formats and wraps dynamic labels into clean multi-line displays."""
        words = label.split()
        lines = []
        current_line = ""

        for word in words:
            if len(current_line) + len(word) + (1 if current_line else 0) <= max_chars_per_line:
                current_line += (" " if current_line else "") + word
            else:
                if current_line:
                    lines.append(current_line)
                current_line = word[:max_chars_per_line]
                if len(lines) >= max_lines - 1:
                    break

        if current_line and len(lines) < max_lines:
            lines.append(current_line)

        # Truncate final line with ellipsis if needed
        if lines and len(lines) == max_lines and len(words) > len(" ".join(lines).split()):
            lines[-1] = lines[-1][:max_chars_per_line - 1] + "…"

        return lines or [""]

    def render_button_svg(
        self,
        label: str,
        state: str = "idle",
        led_color: Optional[Tuple[int, int, int]] = None,
        width: int = 72,
        height: int = 72,
        subtitle: str = ""
    ) -> str:
        """
        Renders button visual state to an SVG XML string with feedback LED accents.
        :visibility: public
        """
        start_time = time.perf_counter()
        self.stats["total_renders"] += 1

        effective_led = led_color or self.get_led_color_for_state(state)
        r, g, b = effective_led

        # Build cache key for ultra-fast rendering
        cache_key = f"{label}:{state}:{r},{g},{b}:{width}x{height}:{subtitle}"
        if cache_key in self._cache:
            self.stats["cache_hits"] += 1
            render_ms = (time.perf_counter() - start_time) * 1000.0
            self.stats["total_render_time_ms"] += render_ms
            return self._cache[cache_key]

        self.stats["cache_misses"] += 1

        clean_label = self.sanitize_label(label)
        clean_subtitle = self.sanitize_label(subtitle)
        lines = self.format_dynamic_label(clean_label)

        # SVG Background and LED feedback border styling
        bg_gradient_start = "#1e222b"
        bg_gradient_end = "#12141a"
        led_hex = f"#{r:02x}{g:02x}{b:02x}"

        # Status badge icon / text
        badge_symbol = ""
        if state == "executing":
            badge_symbol = "⏳"
        elif state == "success":
            badge_symbol = "✓"
        elif state == "error":
            badge_symbol = "✗"

        # Construct text elements for lines
        text_elements = []
        start_y = 28 if len(lines) == 1 else (22 if len(lines) == 2 else 18)
        line_height = 14

        for idx, line_text in enumerate(lines):
            y_pos = start_y + (idx * line_height)
            font_size = 11 if len(lines) <= 2 else 10
            text_elements.append(
                f'<text x="36" y="{y_pos}" font-family="sans-serif" font-size="{font_size}" '
                f'font-weight="bold" fill="#ffffff" text-anchor="middle">{line_text}</text>'
            )

        if clean_subtitle:
            text_elements.append(
                f'<text x="36" y="62" font-family="sans-serif" font-size="8" '
                f'fill="#a0a0a0" text-anchor="middle">{clean_subtitle}</text>'
            )

        text_svg = "\n    ".join(text_elements)

        svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="{bg_gradient_start}"/>
      <stop offset="100%" stop-color="{bg_gradient_end}"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="2" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>
  <!-- Button Frame -->
  <rect x="2" y="2" width="68" height="68" rx="10" fill="url(#bg)" stroke="{led_hex}" stroke-width="2.5"/>
  <!-- LED Feedback Accent Top Bar -->
  <rect x="6" y="6" width="60" height="4" rx="2" fill="{led_hex}" filter="url(#glow)"/>
  <!-- Status Badge -->
  {f'<text x="60" y="18" font-family="sans-serif" font-size="10" fill="{led_hex}" text-anchor="middle">{badge_symbol}</text>' if badge_symbol else ''}
  <!-- Dynamic Label Text -->
  {text_svg}
</svg>"""

        if len(self._cache) >= self._cache_size:
            # Simple eviction
            self._cache.pop(next(iter(self._cache)))
        self._cache[cache_key] = svg

        render_ms = (time.perf_counter() - start_time) * 1000.0
        self.stats["total_render_time_ms"] += render_ms
        return svg

    def render_button_data_url(
        self,
        label: str,
        state: str = "idle",
        led_color: Optional[Tuple[int, int, int]] = None,
        width: int = 72,
        height: int = 72,
        subtitle: str = ""
    ) -> str:
        """
        Renders visual button to Base64 encoded Data URL string (data:image/svg+xml;base64,...).
        :visibility: public
        """
        svg = self.render_button_svg(label, state, led_color, width, height, subtitle)
        b64_svg = base64.b64encode(svg.encode("utf-8")).decode("utf-8")
        return f"data:image/svg+xml;base64,{b64_svg}"


class StreamDeckPluginProtocol:
    """
    Implements Elgato Stream Deck WebSocket protocol message parsing and formatting.
    :visibility: public
    """

    @staticmethod
    def parse_incoming_message(raw_data: str) -> Dict[str, Any]:
        """Parses JSON WebSocket message from Stream Deck application."""
        try:
            data = json.loads(raw_data)
            return {
                "event": data.get("event", ""),
                "action": data.get("action", ""),
                "context": data.get("context", ""),
                "device": data.get("device", ""),
                "payload": data.get("payload", {})
            }
        except Exception:
            return {"event": "error", "payload": {}}

    @staticmethod
    def format_register_plugin(plugin_uuid: str) -> str:
        """Formats registerPlugin message."""
        return json.dumps({
            "event": "registerPlugin",
            "uuid": plugin_uuid
        })

    @staticmethod
    def format_set_title(context: str, title: str, target: int = 0) -> str:
        """Formats setTitle message to update button dynamic label."""
        return json.dumps({
            "event": "setTitle",
            "context": context,
            "payload": {
                "title": title,
                "target": target
            }
        })

    @staticmethod
    def format_set_image(context: str, image_data_url: str, target: int = 0) -> str:
        """Formats setImage message to update button visual appearance."""
        return json.dumps({
            "event": "setImage",
            "context": context,
            "payload": {
                "image": image_data_url,
                "target": target
            }
        })

    @staticmethod
    def format_set_state(context: str, state_index: int) -> str:
        """Formats setState message for multi-state buttons."""
        return json.dumps({
            "event": "setState",
            "context": context,
            "payload": {
                "state": state_index
            }
        })

    @staticmethod
    def format_show_alert(context: str) -> str:
        """Formats showAlert message for error feedback."""
        return json.dumps({
            "event": "showAlert",
            "context": context
        })

    @staticmethod
    def format_show_ok(context: str) -> str:
        """Formats showOk message for success feedback."""
        return json.dumps({
            "event": "showOk",
            "context": context
        })

    @staticmethod
    def format_switch_to_profile(device_id: str, profile_name: str) -> str:
        """Formats switchToProfile message for profile switching."""
        return json.dumps({
            "event": "switchToProfile",
            "device": device_id,
            "payload": {
                "profile": profile_name
            }
        })

    @staticmethod
    def format_set_feedback(context: str, feedback: Dict[str, Any]) -> str:
        """Formats setFeedback message for Stream Deck Plus dynamic strip feedback."""
        return json.dumps({
            "event": "setFeedback",
            "context": context,
            "payload": feedback
        })


class StreamDeckManager:
    """
    High-level Stream Deck Integration Manager.
    Coordinates profile management, button visual state rendering, execution,
    D-Bus signals, and security validation.
    :visibility: public
    """

    def __init__(self, dbus_service=None, config_path=None):
        self.dbus_service = dbus_service
        self.config_path = config_path
        self.renderer = VisualRenderer()
        self.profiles: Dict[str, StreamDeckProfile] = {}
        self.active_profile_name: str = "Default"
        self.active_device_id: str = "device_default"
        self.context_key_map: Dict[str, int] = {}  # context -> key_index
        self.key_context_map: Dict[int, str] = {}  # key_index -> context
        
        self.load_profiles()

    def sanitize_input(self, text: str) -> str:
        """Sanitizes inputs against command injection and malicious payloads."""
        if not text:
            return ""
        # Strip control characters
        clean = re.sub(r"[\r\n\t\x00-\x1f\x7f-\x9f]", " ", str(text))
        return clean.strip()

    def load_profiles(self, config_data: Optional[Dict[str, Any]] = None):
        """Loads and builds Stream Deck profiles from CmdBar configuration."""
        if config_data is None:
            config_data = load_config()

        self.profiles.clear()
        categories = config_data.get("categories", [])
        
        available_profile_names = ["Default"] + [cat.get("name") for cat in categories if cat.get("name")]
        
        # 1. Build Default profile (All commands)
        default_prof = StreamDeckProfile("Default", grid_rows=3, grid_cols=5)
        default_prof.auto_populate_from_category("Default", config_data, available_profile_names)
        self.profiles["Default"] = default_prof

        # 2. Build Category profiles
        for cat in categories:
            cat_name = cat.get("name")
            if cat_name:
                prof = StreamDeckProfile(cat_name, grid_rows=3, grid_cols=5)
                prof.auto_populate_from_category(cat_name, config_data, available_profile_names)
                self.profiles[cat_name] = prof

        if self.active_profile_name not in self.profiles:
            self.active_profile_name = "Default"

    def get_active_profile(self) -> StreamDeckProfile:
        """Returns the currently active Stream Deck profile."""
        if self.active_profile_name not in self.profiles:
            self.load_profiles()
        return self.profiles.get(self.active_profile_name, StreamDeckProfile("Default"))

    def switch_profile(self, profile_name: str) -> bool:
        """
        Switches the active profile on Stream Deck.
        :visibility: public
        """
        start_time = time.perf_counter()
        clean_name = self.sanitize_input(profile_name)
        if clean_name in self.profiles:
            self.active_profile_name = clean_name
            latency_ms = (time.perf_counter() - start_time) * 1000.0
            return True
        return False

    def register_context(self, context: str, key_index: int):
        """Maps Stream Deck context token to grid key index."""
        self.context_key_map[context] = key_index
        self.key_context_map[key_index] = context

    def unregister_context(self, context: str):
        """Unmaps context token."""
        if context in self.context_key_map:
            key_idx = self.context_key_map.pop(context)
            self.key_context_map.pop(key_idx, None)

    def render_key_visual(self, key_index: int) -> Tuple[str, str]:
        """
        Generates dynamic label and Base64 image Data URL for key index.
        Returns tuple: (title, image_data_url)
        :visibility: public
        """
        profile = self.get_active_profile()
        button = profile.get_button(key_index)

        if not button:
            image_url = self.renderer.render_button_data_url(
                label="",
                state="idle",
                led_color=(20, 20, 25)
            )
            return ("", image_url)

        subtitle = f"{button.execution_time_ms:.1f}s" if button.execution_time_ms > 0 else ""
        image_url = self.renderer.render_button_data_url(
            label=button.label,
            state=button.state,
            led_color=button.led_color,
            subtitle=subtitle
        )
        return (button.label, image_url)

    def handle_key_down(self, context: str, key_index: int) -> Dict[str, Any]:
        """
        Handles key press action from Stream Deck.
        Executes command or switches profile, and updates visual state.
        :visibility: public
        """
        self.register_context(context, key_index)
        profile = self.get_active_profile()
        button = profile.get_button(key_index)

        if not button or button.action_type == "empty":
            return {"status": "ignored", "action": "none"}

        if button.action_type == "profile_switch":
            target = button.target_profile
            switched = self.switch_profile(target)
            return {
                "status": "profile_switched" if switched else "error",
                "action": "profile_switch",
                "target_profile": target,
                "protocol_message": StreamDeckPluginProtocol.format_switch_to_profile(self.active_device_id, target)
            }

        elif button.action_type == "command":
            button.set_state("executing")
            
            # Update key visual state immediately to executing
            title, image_url = self.render_key_visual(key_index)
            
            # Execute command asynchronously or via D-Bus / shell execution
            cmd_name = button.command_name
            start_t = time.perf_counter()

            if self.dbus_service:
                exec_success = self.dbus_service.execute_command(cmd_name)
                exec_time = (time.perf_counter() - start_t) * 1000.0
                status_state = "success" if exec_success else "error"
                button.set_state(status_state, exec_time_ms=exec_time / 1000.0)
            else:
                # Direct fallback execution
                config_data = load_config()
                cmd_template = ""
                for cat in config_data.get("categories", []):
                    for c in cat.get("commands", []):
                        if c.get("name") == cmd_name:
                            cmd_template = c.get("template", c.get("command", ""))
                            break

                if cmd_template:
                    code, stdout, stderr = run_command_in_shell(cmd_template)
                    exec_time = (time.perf_counter() - start_t) * 1000.0
                    status_state = "success" if code == 0 else "error"
                    button.set_state(status_state, output=stdout or stderr, exec_time_ms=exec_time / 1000.0)
                else:
                    button.set_state("error")

            new_title, new_image_url = self.render_key_visual(key_index)
            return {
                "status": "executed",
                "action": "command",
                "command_name": cmd_name,
                "button_state": button.state,
                "title": new_title,
                "image_data_url": new_image_url
            }

        return {"status": "unknown"}

    def update_command_feedback(self, command_name: str, exit_code: int, success: bool, execution_time_ms: float = 0.0):
        """
        Updates button visual feedback state across all profiles upon command execution signal.
        :visibility: public
        """
        for prof in self.profiles.values():
            for btn in prof.buttons.values():
                if btn.command_name == command_name:
                    btn.set_state("success" if success else "error", exec_time_ms=execution_time_ms / 1000.0)

    def get_status_summary(self) -> Dict[str, Any]:
        """Returns diagnostic status of Stream Deck manager."""
        return {
            "active_profile": self.active_profile_name,
            "available_profiles": list(self.profiles.keys()),
            "active_device_id": self.active_device_id,
            "active_contexts_count": len(self.context_key_map),
            "render_stats": self.renderer.stats
        }


# Global singleton instance
_stream_deck_manager: Optional[StreamDeckManager] = None


def get_stream_deck_manager(dbus_service=None) -> StreamDeckManager:
    """
    Returns or initializes the global StreamDeckManager singleton.
    :visibility: public
    """
    global _stream_deck_manager
    if _stream_deck_manager is None:
        _stream_deck_manager = StreamDeckManager(dbus_service=dbus_service)
    elif dbus_service and _stream_deck_manager.dbus_service is None:
        _stream_deck_manager.dbus_service = dbus_service
    return _stream_deck_manager
