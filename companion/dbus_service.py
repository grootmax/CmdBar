#!/usr/bin/env python3
import json
import os
import sys
import subprocess
from companion.companion_app import load_config, save_config, run_command_in_shell
from app.config_schema import validate_branding_config, get_effective_branding
from companion.sso_manager import SSOManager, SSOProviderConfig
from companion.stream_deck import get_stream_deck_manager
from companion.yubikey_auth import (
    YubiKeyAuthManager,
    is_sensitive_command,
    generate_emergency_codes,
    verify_and_consume_emergency_code,
)
from companion.event_triggers import EventTriggerEngine
from app.workspace_config import (
    WorkspaceManager,
    init_workspace_config,
    find_workspace_config_path,
    detect_project_type,
    PROJECT_TEMPLATES,
)
from companion.stream_deck import StreamDeckManager, get_stream_deck_manager


class CmdBarDBusService:
    """
    Python D-Bus Service implementation for CmdBar.
    Exposes AddCommand, RemoveCommand, ExecuteCommand, GetCommands,
    TriggerEvent, GetTriggers, AddTrigger, RemoveTrigger,
    SSO authentication methods, YubiKey 2FA Methods, Stream Deck APIs, workspace management, and manages signals for CommandExecuted,
    CommandOutput, and EventTriggered.
    :visibility: public
    """

    def __init__(self, config_path=None):
        self.config_path = config_path
        self._executed_listeners = []
        self._output_listeners = []
        self._sso_session_listeners = []
        config = load_config(self.config_path) if self.config_path else load_config()
        self._sso_manager = SSOManager(config)
        self.auth_manager = YubiKeyAuthManager()
        self._event_triggered_listeners = []
        self.trigger_engine = EventTriggerEngine()
        self.workspace_manager = WorkspaceManager()
        self.stream_deck_manager = get_stream_deck_manager(dbus_service=self)
        self.active_terminal_sessions = {}
        self.stream_deck = self.stream_deck_manager

    def is_yubikey_required(self, name: str) -> bool:
        if not name:
            return False
        config = load_config()
        clean_name = str(name).strip()
        found_cmd = None
        for cat in config.get("categories", []):
            for c in cat.get("commands", []):
                if (
                    c.get("name") == clean_name
                    or c.get("template") == clean_name
                    or c.get("command") == clean_name
                ):
                    found_cmd = c
                    break
            if found_cmd:
                break
        cmd_obj = found_cmd or clean_name
        return is_sensitive_command(cmd_obj, config.get("yubikey", {}))

    def authenticate_yubikey(
        self, name: str, mode: str = "touch", credential: str = ""
    ) -> tuple:
        config = load_config()
        clean_name = str(name).strip() if name else ""
        found_cmd = None
        if clean_name:
            for cat in config.get("categories", []):
                for c in cat.get("commands", []):
                    if (
                        c.get("name") == clean_name
                        or c.get("template") == clean_name
                        or c.get("command") == clean_name
                    ):
                        found_cmd = c
                        break
                if found_cmd:
                    break
        cmd_obj = found_cmd or clean_name

        auth_payload = {"mode": mode}
        if mode == "otp":
            auth_payload["otp"] = credential
        elif mode == "emergency":
            auth_payload["emergency_code"] = credential

        success, msg = self.auth_manager.authenticate_command(
            cmd_obj, auth_payload, config
        )
        if success and mode == "emergency":
            save_config(config)
        return success, msg

    def generate_emergency_codes(self, count: int = 5) -> str:
        config = load_config()
        yk_cfg = config.setdefault("yubikey", {})
        raw_codes, hashed_codes = generate_emergency_codes(count=count)
        yk_cfg["emergency_codes"] = hashed_codes
        save_config(config)
        return json.dumps(raw_codes)

    def verify_emergency_code(self, code: str) -> bool:
        config = load_config()
        yk_cfg = config.setdefault("yubikey", {})
        valid, msg = verify_and_consume_emergency_code(code, yk_cfg)
        if valid:
            save_config(config)
        return valid

    is_yubi_key_required = is_yubikey_required
    authenticate_yubi_key = authenticate_yubikey

    def add_listener(self, on_executed=None, on_output=None):
        if on_executed:
            self._executed_listeners.append(on_executed)
        if on_output:
            self._output_listeners.append(on_output)

    def add_command(self, name: str, command: str, category: str = "External") -> bool:
        if not name or not str(name).strip():
            return False
        if not command or not str(command).strip():
            return False

        cat_name = (
            str(category).strip() if category and str(category).strip() else "External"
        )
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
            cmds.append(
                {"name": clean_name, "template": clean_cmd, "command": clean_cmd}
            )

        saved = save_config(config)
        if saved and hasattr(self, "stream_deck_manager") and self.stream_deck_manager:
            self.stream_deck_manager.load_profiles(config)
        return saved

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
            if hasattr(self, "stream_deck_manager") and self.stream_deck_manager:
                self.stream_deck_manager.load_profiles(config)
        return removed

    def execute_command(self, name: str) -> bool:
        if not name or not str(name).strip():
            return False
        clean_name = str(name).strip()
        config = load_config()

        found_cmd = None
        for cat in config.get("categories", []):
            for c in cat.get("commands", []):
                if (
                    c.get("name") == clean_name
                    or c.get("template") == clean_name
                    or c.get("command") == clean_name
                ):
                    found_cmd = c
                    break
            if found_cmd:
                break

        cmd_name = found_cmd.get("name") if found_cmd else clean_name
        cmd_str = (
            found_cmd.get("template", found_cmd.get("command", clean_name))
            if found_cmd
            else clean_name
        )

        import time

        start_time = time.perf_counter()
        code, stdout, stderr = run_command_in_shell(cmd_str)
        exec_ms = (time.perf_counter() - start_time) * 1000.0
        success = code == 0

        for listener in self._output_listeners:
            try:
                listener(cmd_name, stdout, stderr)
            except Exception:
                pass

        for listener in self._executed_listeners:
            try:
                listener(cmd_name, code, success)
            except Exception:
                pass

        if hasattr(self, "stream_deck_manager") and self.stream_deck_manager:
            self.stream_deck_manager.update_command_feedback(
                cmd_name, code, success, exec_ms
            )

        return True

    def get_commands(self) -> list:
        config = load_config()
        all_cmds = []
        for cat in config.get("categories", []):
            cat_name = cat.get("name", "")
            for c in cat.get("commands", []):
                all_cmds.append(
                    {
                        "name": c.get("name", ""),
                        "command": c.get("template", c.get("command", "")),
                        "category": cat_name,
                        "placeholder": c.get("placeholder", ""),
                        "parameters": c.get("parameters", {}),
                    }
                )
        return all_cmds

    def get_commands_json(self) -> str:
        return json.dumps(self.get_commands())

    def get_branding(self) -> dict:
        config = load_config(self.config_path) if self.config_path else load_config()
        return get_effective_branding(config)

    def get_branding_json(self) -> str:
        return json.dumps(self.get_branding())

    def set_branding(self, json_branding: str) -> bool:
        if not json_branding or not str(json_branding).strip():
            return False
        try:
            parsed = (
                json.loads(json_branding)
                if isinstance(json_branding, str)
                else json_branding
            )
            if not validate_branding_config(parsed):
                return False
            config = (
                load_config(self.config_path) if self.config_path else load_config()
            )
            config["branding"] = parsed
            return (
                save_config(config, self.config_path)
                if self.config_path
                else save_config(config)
            )
        except Exception:
            return False

    def get_effective_app_name(self) -> str:
        branding = self.get_branding()
        if branding.get("enabled"):
            return branding.get("app_name") or "CmdBar"
        return "CmdBar"

    def sso_login(self, provider: str, protocol: str, credentials_json: str) -> str:
        """
        Executes SSO login for provider and protocol via DBus.
        """
        try:
            creds = json.loads(credentials_json) if credentials_json else {}
        except Exception:
            creds = {}

        if protocol == "saml":
            res = self._sso_manager.login_saml(provider, creds.get("saml_response", ""))
        else:
            claims = creds.get("claims", creds)
            tokens = creds.get("tokens", {})
            res = self._sso_manager.login_oidc_claims(provider, claims, tokens)

        if res.get("success") and res.get("session"):
            sess_id = res["session"]["session_id"]
            for listener in self._sso_session_listeners:
                try:
                    listener(sess_id, "active")
                except Exception:
                    pass

        return json.dumps(res)

    def sso_logout(self, session_id: str) -> bool:
        """
        Logs out active SSO session via DBus.
        """
        ok = self._sso_manager.session_manager.revoke_session(session_id)
        if ok:
            for listener in self._sso_session_listeners:
                try:
                    listener(session_id, "revoked")
                except Exception:
                    pass
        return ok

    def get_sso_session(self, session_id: str) -> str:
        """
        Returns active SSO session details as JSON.
        """
        sess = self._sso_manager.session_manager.get_session(session_id)
        return json.dumps(sess)

    def get_sso_providers(self) -> str:
        """
        Returns supported SSO provider presets as JSON.
        """
        return json.dumps(SSOProviderConfig.PRESETS)

    def validate_sso_access(self, session_id: str, category_name: str) -> bool:
        """
        Validates category access for active SSO session.
        """
        return self._sso_manager.validate_category_access(session_id, category_name)

    def get_resource_metrics(self) -> dict:
        if hasattr(self, "_resource_monitor") and self._resource_monitor:
            return self._resource_monitor.get_metrics_dict()
        from companion.resource_monitor import SystemResourceMonitor

        rm = SystemResourceMonitor()
        rm.sample_metrics()
        return rm.get_metrics_dict()

    def get_resource_metrics_json(self) -> str:
        res = self.get_resource_metrics()
        return json.dumps(res)

    def add_event_listener(self, on_event_triggered=None):
        if on_event_triggered:
            self._event_triggered_listeners.append(on_event_triggered)

    def trigger_event(self, event_type: str, payload_json: str = "{}") -> bool:
        """
        Triggers an event and processes matching triggers.
        :visibility: public
        """
        try:
            payload = json.loads(payload_json) if payload_json else {}
        except Exception:
            payload = {}

        def executor(cmd, params, context):
            return run_command_in_shell(cmd)

        results = self.trigger_engine.process_event(event_type, payload, command_executor=executor)
        for res in results:
            for listener in self._event_triggered_listeners:
                try:
                    listener(res["trigger_id"], event_type, res["command"], res["success"])
                except Exception:
                    pass
        return True

    def get_triggers(self) -> list:
        """
        Returns list of registered triggers.
        :visibility: public
        """
        return self.trigger_engine.get_triggers()

    def get_triggers_json(self) -> str:
        """
        Returns registered triggers as JSON string.
        :visibility: public
        """
        return json.dumps(self.get_triggers())

    def add_trigger(self, trigger_json: str) -> bool:
        """
        Adds a trigger from JSON string.
        :visibility: public
        """
        try:
            trig = json.loads(trigger_json)
            return self.trigger_engine.add_trigger(trig)
        except Exception:
            return False

    def remove_trigger(self, trigger_id: str) -> bool:
        """
        Removes a trigger by ID.
        :visibility: public
        """
        return self.trigger_engine.remove_trigger(trigger_id)

    def detect_workspace(self, cwd: str) -> tuple:
        path = find_workspace_config_path(cwd)
        has_ws = path is not None
        return has_ws, path or ""

    def init_workspace(self, cwd: str, template_name: str = None) -> tuple:
        try:
            cfg, path = init_workspace_config(cwd, template_name)
            self.workspace_manager.register_workspace(cwd)
            return True, path
        except Exception:
            return False, ""

    def switch_workspace(self, cwd: str) -> bool:
        try:
            global_cfg = load_config()
            self.workspace_manager.set_global_config(global_cfg)
            ws_cfg = self.workspace_manager.switch_workspace(cwd)
            return ws_cfg is not None
        except Exception:
            return False

    def list_workspaces(self) -> list:
        return self.workspace_manager.list_workspaces()

    def list_workspaces_json(self) -> str:
        return json.dumps(self.list_workspaces())

    def get_workspace_templates(self) -> dict:
        return PROJECT_TEMPLATES

    def get_stream_deck_profiles(self) -> str:
        """Returns JSON string containing available Stream Deck profiles and active profile."""
        if hasattr(self, "stream_deck_manager") and self.stream_deck_manager:
            summary = self.stream_deck_manager.get_status_summary()
            return json.dumps(
                {
                    "active_profile": summary["active_profile"],
                    "profiles": summary["available_profiles"],
                }
            )
        return json.dumps({"active_profile": "Default", "profiles": ["Default"]})

    def set_stream_deck_profile(self, profile_name: str) -> bool:
        """Switches the active Stream Deck profile."""
        if hasattr(self, "stream_deck_manager") and self.stream_deck_manager:
            return self.stream_deck_manager.switch_profile(profile_name)
        return False

    def get_stream_deck_status(self) -> str:
        """Returns diagnostic status JSON summary for Stream Deck integration."""
        if hasattr(self, "stream_deck_manager") and self.stream_deck_manager:
            return json.dumps(self.stream_deck_manager.get_status_summary())
        return json.dumps({})

    def trigger_stream_deck_button(self, key_index: int) -> bool:
        """Simulates key press on active Stream Deck grid."""
        if hasattr(self, "stream_deck_manager") and self.stream_deck_manager:
            res = self.stream_deck_manager.handle_key_down("simulated_ctx", key_index)
            return res.get("status") in ("executed", "profile_switched")
        return False

    def start_terminal_sharing(self, session_id: str, title: str = "CmdBar Shared Terminal") -> str:
        from companion.terminal_sharing import TerminalSharingSession
        session = TerminalSharingSession(session_id=session_id, title=title)
        session.start()
        self.active_terminal_sessions[session.session_id] = session
        return json.dumps(session.get_metrics())

    def stop_terminal_sharing(self, session_id: str) -> bool:
        if session_id in self.active_terminal_sessions:
            session = self.active_terminal_sessions.pop(session_id)
            session.end_session()
            return True
        return False

    def get_terminal_sharing_sessions(self) -> str:
        sessions_info = [s.get_metrics() for s in self.active_terminal_sessions.values()]
        return json.dumps(sessions_info)

    def stream_deck_press_key(self, key_index: int) -> bool:
        if hasattr(self.stream_deck, "press_key"):
            res = self.stream_deck.press_key(key_index)
            return bool(res.get("success", False))
        res = self.stream_deck.handle_key_down("dbus", key_index)
        return bool(res.get("status") in ("executed", "profile_switched"))

    def stream_deck_set_active_profile(self, profile_name: str) -> bool:
        if hasattr(self.stream_deck, "set_active_profile"):
            return self.stream_deck.set_active_profile(profile_name)
        return self.stream_deck.switch_profile(profile_name)

    def stream_deck_get_profile_grid(self) -> str:
        if hasattr(self.stream_deck, "render_profile_grid"):
            grid = self.stream_deck.render_profile_grid()
            return json.dumps(grid)
        grid = []
        prof = self.stream_deck.get_active_profile()
        for i in range(prof.max_keys):
            title, img = self.stream_deck.render_key_visual(i)
            btn = prof.get_button(i)
            grid.append({
                "key_index": i,
                "label": title,
                "svg_base64": img,
                "led_state": btn.state if btn else "idle"
            })
        return json.dumps(grid)
