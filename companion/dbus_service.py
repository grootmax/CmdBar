#!/usr/bin/env python3
import json
import os
import sys
import subprocess
from companion.companion_app import load_config, save_config, run_command_in_shell
from companion.sso_manager import SSOManager, SSOProviderConfig

class CmdBarDBusService:
    """
    Python D-Bus Service implementation for CmdBar.
    Exposes AddCommand, RemoveCommand, ExecuteCommand, GetCommands,
    SSO authentication methods, and manages signals.
    :visibility: public
    """
    def __init__(self, config_path=None):
        self.config_path = config_path
        self._executed_listeners = []
        self._output_listeners = []
        self._sso_session_listeners = []
        config = load_config()
        self._sso_manager = SSOManager(config)

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

    def execute_command(self, name: str) -> bool:
        if not name or not str(name).strip():
            return False
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

        cmd_name = found_cmd.get("name") if found_cmd else clean_name
        cmd_str = found_cmd.get("template", found_cmd.get("command", clean_name)) if found_cmd else clean_name

        code, stdout, stderr = run_command_in_shell(cmd_str)
        success = (code == 0)

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

        return True

    def get_commands(self) -> list:
        config = load_config()
        all_cmds = []
        for cat in config.get("categories", []):
            cat_name = cat.get("name", "")
            for c in cat.get("commands", []):
                all_cmds.append({
                    "name": c.get("name", ""),
                    "command": c.get("template", c.get("command", "")),
                    "category": cat_name,
                    "placeholder": c.get("placeholder", ""),
                    "parameters": c.get("parameters", {})
                })
        return all_cmds

    def get_commands_json(self) -> str:
        return json.dumps(self.get_commands())

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
