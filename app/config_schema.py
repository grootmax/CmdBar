import os
import json
import re
import shlex
import subprocess
import hmac
import hashlib
import secrets
import fnmatch
import time
import base64


def canonical_json(obj):
    if isinstance(obj, dict):
        clean = {k: v for k, v in obj.items() if k != "signature"}
        return json.dumps(clean, sort_keys=True, separators=(",", ":"))
    elif isinstance(obj, list):
        return "[" + ",".join(canonical_json(x) for x in obj) + "]"
    return json.dumps(obj, separators=(",", ":"))


def get_key_path(config_path):
    return os.path.join(os.path.dirname(config_path), ".key")


def get_or_create_signing_key(key_path):
    dir_path = os.path.dirname(key_path)
    os.makedirs(dir_path, exist_ok=True)
    if os.path.exists(key_path):
        try:
            with open(key_path, "r") as f:
                content = f.read().strip()
                if content:
                    return content
        except Exception:
            pass
    key = secrets.token_hex(32)
    try:
        with open(key_path, "w") as f:
            f.write(key)
        os.chmod(key_path, 0o600)
    except Exception:
        pass
    return key


def compute_signature(config_data, key):
    str_val = canonical_json(config_data)
    return hmac.new(
        key.encode("utf-8"), str_val.encode("utf-8"), hashlib.sha256
    ).hexdigest()


DEFAULT_CONFIG = {
    "sso": {
        "enabled": False,
        "default_provider": "azure",
        "auto_provision": True,
        "allowed_domains": ["example.com"],
        "default_role": "user",
        "group_claim": "groups",
        "session_timeout_minutes": 480,
        "idle_timeout_minutes": 120,
        "jit_provisioning": {
            "enabled": True,
            "default_role": "user",
            "attribute_mapping": {"email": "email", "name": "name", "groups": "groups"},
        },
        "providers": {
            "azure": {
                "name": "Azure Active Directory",
                "type": "azure",
                "protocol": "oidc",
                "tenant_id": "common",
                "client_id": "",
                "client_secret": "",
                "redirect_uri": "http://localhost:8080/callback/sso",
                "saml_sso_url": "https://login.microsoftonline.com/common/saml2",
                "saml_entity_id": "https://sts.windows.net/common/",
            },
            "okta": {
                "name": "Okta Workforce Identity",
                "type": "okta",
                "protocol": "oidc",
                "domain": "company.okta.com",
                "client_id": "",
                "client_secret": "",
                "redirect_uri": "http://localhost:8080/callback/sso",
                "saml_sso_url": "https://company.okta.com/app/sso/saml",
                "saml_entity_id": "http://www.okta.com/default",
            },
            "google": {
                "name": "Google Workspace SSO",
                "type": "google",
                "protocol": "oidc",
                "client_id": "",
                "client_secret": "",
                "redirect_uri": "http://localhost:8080/callback/sso",
                "saml_sso_url": "https://accounts.google.com/o/saml2/idp",
                "saml_entity_id": "https://accounts.google.com/o/saml2?idpid=default",
            },
        },
        "group_mappings": [
            {
                "id": "rule-admin",
                "group_pattern": "Admins",
                "sso_group": "CmdBar-Admins",
                "match_type": "contains",
                "role": "admin",
                "categories": ["System Utilities", "Infrastructure", "AI Assistant", "Projects"],
                "allowed_categories": ["*"],
            },
            {
                "id": "rule-dev",
                "group_pattern": "Developers",
                "sso_group": "Developers",
                "match_type": "contains",
                "role": "developer",
                "categories": ["Projects", "AI Assistant"],
                "allowed_categories": ["Projects"],
            },
        ],
        "session": {
            "max_ttl_seconds": 28800,
            "refresh_threshold_seconds": 300,
        },
    },
    "audit": {
        "enabled": True,
        "privacy_mode": False,
        "sensitive_keywords": [
            "password",
            "passwd",
            "secret",
            "token",
            "api_key",
            "apikey",
            "key",
            "credentials",
            "cred",
            "sudo",
            "auth",
            "bearer",
            "private_key",
        ],
    },
    "ai": {
        "provider": "openai",
        "model": "gpt-4o",
        "temperature": 0.2,
        "require_confirmation": True,
        "fallback_provider": "ollama",
        "fallback_model": "llama3",
    },
    "branding": {
        "enabled": False,
        "app_name": "CmdBar",
        "logo_path": "",
        "brand_colors": {
            "primary": "#3584e4",
            "accent": "#1c71d8",
            "background": "#2d2d2d",
            "text": "#ffffff",
        },
        "domain_alias": "",
        "custom_ssl": {
            "cert_path": "",
            "key_path": "",
            "ca_path": "",
            "verify_ssl": True,
        },
        "enterprise_identity": {
            "organization_name": "",
            "support_url": "",
            "support_email": "",
            "footer_text": "",
        },
    },
    "categories": [
        {
            "name": "System Utilities",
            "commands": [
                {
                    "name": "Ping Host",
                    "command": "ping -c 3 <host>",
                    "mode": "shell-quoted",
                    "parameters": {
                        "host": {
                            "regex": "^[a-zA-Z0-9.-]+$",
                            "error_message": "Invalid host format! Must contain only alphanumeric, dots, and dashes.",
                        }
                    },
                },
                {
                    "name": "Direct Exec",
                    "command": '/usr/bin/echo "Hello" <arg>',
                    "mode": "direct-array",
                    "parameters": {
                        "arg": {
                            "regex": "^[a-zA-Z0-9_]+$",
                            "error_message": "Invalid argument format! Must be alphanumeric or underscore.",
                        }
                    },
                },
            ],
        },
        {
            "name": "Git",
            "commands": [
                {
                    "name": "Git Status",
                    "command": "git status",
                    "mode": "shell-quoted",
                },
                {
                    "name": "Git Pull",
                    "command": "git pull origin {git-branch}",
                    "mode": "shell-quoted",
                },
                {
                    "name": "Git Push",
                    "command": "git push origin {git-branch}",
                    "mode": "shell-quoted",
                },
                {
                    "name": "Git Commit",
                    "command": 'git commit -m "<commit-message>"',
                    "mode": "shell-quoted",
                },
            ],
        },
    ],
    "yubikey": {
        "enabled": False,
        "default_mode": "touch",
        "timeout_seconds": 30,
        "registered_keys": [],
        "emergency_codes": [],
    },
    "profiles": [
        {
            "name": "Production",
            "env": {
                "ENV": "production",
                "LOG_LEVEL": "warn",
            },
        },
        {
            "name": "Staging",
            "env": {
                "ENV": "staging",
                "LOG_LEVEL": "info",
            },
        },
        {
            "name": "Development",
            "env": {
                "ENV": "development",
                "LOG_LEVEL": "debug",
            },
        },
    ],
    "active_profile": "Development",
    "policy": {
        "enabled": True,
        "mode": "blacklist",
        "blacklist": [
            "rm -rf *",
            "rm -rf /",
            "mkfs*",
            "dd if=*",
            ":(){ :|:& };:",
            "chmod -R 777 *",
            "shutdown*",
            "reboot*",
            "> /dev/sd*",
            "wget * | sh",
            "curl * | sh",
            "wget * | bash",
            "curl * | bash",
        ],
        "whitelist": [
            "echo *",
            "make *",
            "git *",
            "aws *",
            "ping *",
            "docker *",
            "python*",
            "node *",
            "npm *",
            "notify-send *",
            "deploy *",
            "pkill *",
            "zenity *",
        ],
        "rules": [],
        "overrides": [],
    },
    "iot": {
        "enabled": False,
        "mqtt": {
            "enabled": False,
            "host": "localhost",
            "port": 1883,
            "topic_prefix": "cmdbar",
            "username": "",
            "password": "",
        },
        "webhook": {
            "enabled": False,
            "host": "127.0.0.1",
            "port": 8088,
            "secret": "",
        },
        "home_automation": {
            "enabled": False,
            "platform": "homeassistant",
            "discovery_prefix": "homeassistant",
        },
        "sensor_triggers": [],
    },
    "triggers": [],
}


def get_config_path():
    config_dir = os.path.expanduser("~/.config/cmdbar")
    return os.path.join(config_dir, "config.json")


def load_config(path=None):
    if path is None:
        path = get_config_path()

    key_path = get_key_path(path)
    key = get_or_create_signing_key(key_path)

    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        # Fallback & migrate legacy commands.json if it exists
        legacy_path = os.path.join(os.path.dirname(path), "commands.json")
        if os.path.exists(legacy_path):
            try:
                with open(legacy_path, "r") as f:
                    legacy_config = json.load(f)
                # Convert shortcuts to commands if present
                for cat in legacy_config.get("categories", []):
                    if "shortcuts" in cat:
                        if "commands" not in cat:
                            cat["commands"] = cat.pop("shortcuts")
                        else:
                            del cat["shortcuts"]
                # Save as new unified config.json
                save_config(legacy_config, path)
                try:
                    os.remove(legacy_path)
                except Exception:
                    pass
                return legacy_config
            except Exception:
                pass

        # Otherwise, save & return DEFAULT_CONFIG
        default_copy = json.loads(json.dumps(DEFAULT_CONFIG))
        save_config(default_copy, path)
        default_copy.pop("signature", None)
        return default_copy

    try:
        with open(path, "r") as f:
            config_data = json.load(f)

        # Verify cryptographic signature
        sig = config_data.get("signature") if isinstance(config_data, dict) else None
        expected_sig = (
            compute_signature(config_data, key)
            if isinstance(config_data, dict)
            else None
        )

        if not sig or sig != expected_sig:
            backup_path = path + ".bak"
            try:
                if os.path.exists(path):
                    os.replace(path, backup_path)
            except Exception:
                pass
            try:
                subprocess.Popen(
                    [
                        "notify-send",
                        "Security Alert: Config Verification Failed",
                        "Untrusted or tampered configuration file detected. Archived to .bak and restored safe defaults.",
                    ]
                )
            except Exception:
                pass
            default_copy = json.loads(json.dumps(DEFAULT_CONFIG))
            save_config(default_copy, path)
            default_copy.pop("signature", None)
            return default_copy

        # Normalize and migrate loaded configuration
        migrated = False
        if "branding" in config_data and not validate_branding_config(config_data["branding"]):
            config_data["branding"] = json.loads(json.dumps(DEFAULT_CONFIG["branding"]))
            migrated = True
        if "white_label" in config_data and not validate_branding_config(config_data["white_label"]):
            config_data["white_label"] = json.loads(json.dumps(DEFAULT_CONFIG["branding"]))
            migrated = True
        if "yubikey" not in config_data or not isinstance(
            config_data.get("yubikey"), dict
        ):
            config_data["yubikey"] = json.loads(json.dumps(DEFAULT_CONFIG["yubikey"]))
            migrated = True
        for cat in config_data.get("categories", []):
            # Migrate shortcuts to commands
            if "shortcuts" in cat:
                if "commands" not in cat:
                    cat["commands"] = cat["shortcuts"]
                del cat["shortcuts"]
                migrated = True

            if "commands" in cat:
                for cmd in cat["commands"]:
                    # Support CLI Companion file loading without data structure mismatches
                    if "template" in cmd and "command" not in cmd:
                        cmd["command"] = cmd["template"]
                        migrated = True
                    if "parameters" in cmd and isinstance(cmd["parameters"], list):
                        params_dict = {}
                        for p in cmd["parameters"]:
                            if isinstance(p, dict):
                                p_name = p.get("name")
                                if p_name:
                                    p_cfg = {k: v for k, v in p.items() if k != "name"}
                                    params_dict[p_name] = p_cfg
                        cmd["parameters"] = params_dict
                        migrated = True

        if migrated:
            save_config(config_data, path)

        config_data.pop("signature", None)
        return config_data
    except Exception:
        # Fallback to default in memory if corrupt
        default_copy = json.loads(json.dumps(DEFAULT_CONFIG))
        default_copy.pop("signature", None)
        default_copy["_is_invalid"] = True
        return default_copy


def save_config(config_data, path=None):
    if path is None:
        path = get_config_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if isinstance(config_data, dict):
        key_path = get_key_path(path)
        key = get_or_create_signing_key(key_path)
        config_data["signature"] = compute_signature(config_data, key)
    from app.atomic_write import atomic_write_json

    atomic_write_json(path, config_data)


def validate_parameter_value(value, parameter_schema):
    """
    Validates a parameter value against its schema (regex + forbidden chars).
    Returns (is_valid, error_message).
    :visibility: public
    """
    value = str(value).strip() if value is not None else ""
    # 1. Check for forbidden characters
    forbidden = [";", "&&", "||", "|", "&", "`", "$", "(", ")", ">", "<"]
    for f in forbidden:
        if f in value:
            err = f"Input contains forbidden characters like '{f}'!"
            if parameter_schema.get("secure", False) and value:
                err = err.replace(value, "[REDACTED]")
            return False, err

    # 2. Check regex validation if any
    regex_pattern = parameter_schema.get("regex")
    if regex_pattern:
        try:
            if not re.match(regex_pattern, value):
                err = parameter_schema.get("error_message") or "Invalid input format!"
                if parameter_schema.get("secure", False) and value:
                    err = err.replace(value, "[REDACTED]")
                return False, err
        except Exception as e:
            err = f"Invalid regex pattern: {e}"
            if parameter_schema.get("secure", False) and value:
                err = err.replace(value, "[REDACTED]")
            return False, err

    return True, None

from app.sandbox_wrapper import (
    is_sandbox_enabled,
    wrap_command_in_sandbox,
)


def resolve_command_preview(
    command_template, mode, parameter_values, parameters_schema, sandbox_config=None
):
    """
    Resolves a command template for dry-run preview.
    Returns (resolved_string, errors_dict)
    :visibility: public
    """
    errors = {}

    schema_items = []
    if isinstance(parameters_schema, dict):
        for p_name, p_cfg in parameters_schema.items():
            item = dict(p_cfg) if isinstance(p_cfg, dict) else {}
            item["name"] = p_name
            schema_items.append(item)
    elif isinstance(parameters_schema, list):
        schema_items = parameters_schema

    # First, validate all parameters
    for param in schema_items:
        name = param.get("name")
        val = parameter_values.get(name, "")
        is_valid, err_msg = validate_parameter_value(val, param)
        if not is_valid:
            errors[name] = err_msg

    # We should mask secure parameter values *only* for the preview substitution.
    # The actual validation must have already run on the plain-text value.
    preview_values = {}
    for param in schema_items:
        name = param.get("name")
        val = parameter_values.get(name, "")
        val = str(val).strip() if val is not None else ""
        if param.get("secure", False):
            preview_values[name] = "*" * len(val) if val else ""
        else:
            preview_values[name] = val

    if isinstance(parameter_values, dict):
        for k, v in parameter_values.items():
            if k not in preview_values:
                preview_values[k] = str(v).strip() if v is not None else ""

    pattern = r"\{\{([^}]+)\}\}|<([^>]+)>|\{([^}]+)\}"
    if mode == "shell-quoted":
        # Substitution with shell quoting
        def replacer(match):
            ph = match.group(1) or match.group(2) or match.group(3)
            if ph in preview_values:
                val = preview_values[ph]
                return shlex.quote(val)
            return match.group(0)

        resolved = re.sub(pattern, replacer, command_template)
        if sandbox_config and is_sandbox_enabled(sandbox_config):
            try:
                tokens = shlex.split(resolved)
            except Exception:
                tokens = resolved.split()
            sandboxed_tokens = wrap_command_in_sandbox(tokens, sandbox_config)
            resolved = " ".join(shlex.quote(t) for t in sandboxed_tokens)
        return resolved, errors
    else:
        # direct-array mode
        try:
            parts = shlex.split(command_template)
        except Exception:
            parts = command_template.split()  # fallback

        resolved_parts = []
        for part in parts:

            def replacer_part(match):
                ph = match.group(1) or match.group(2) or match.group(3)
                if ph in preview_values:
                    return preview_values[ph]
                return match.group(0)

            resolved_part = re.sub(pattern, replacer_part, part)
            resolved_parts.append(resolved_part)

        if sandbox_config and is_sandbox_enabled(sandbox_config):
            resolved_parts = wrap_command_in_sandbox(resolved_parts, sandbox_config)
        # Preview representation for direct-array is the list of individual args
        array_preview = "Direct Array: " + " ".join(
            shlex.quote(p) for p in resolved_parts
        )
        # We can also append the list format to be 100% explicit
        array_preview += f"\nArgs List: {json.dumps(resolved_parts)}"
        return array_preview, errors

def validate_branding_config(branding):
    """
    Validates white label branding configuration structure.
    :visibility: public
    """
    if branding is None:
        return True
    if not isinstance(branding, dict):
        return False
    
    if "enabled" in branding and not isinstance(branding["enabled"], bool):
        return False
    if "app_name" in branding and not isinstance(branding["app_name"], str):
        return False
    if "logo_path" in branding and not isinstance(branding["logo_path"], str):
        return False
    
    if "brand_colors" in branding and branding["brand_colors"] is not None:
        if not isinstance(branding["brand_colors"], dict):
            return False
        hex_regex = r"^#(?:[0-9a-fA-F]{3,4}){1,2}$"
        for key in ["primary", "accent", "background", "text"]:
            val = branding["brand_colors"].get(key)
            if val is not None and val != "":
                if not isinstance(val, str):
                    return False
                if not re.match(hex_regex, val) and not re.match(r"^(rgb|hsl)a?\(", val) and not val.isalpha():
                    return False

    if "domain_alias" in branding and not isinstance(branding["domain_alias"], str):
        return False
    if branding.get("domain_alias") and isinstance(branding["domain_alias"], str) and branding["domain_alias"].strip():
        domain_str = branding["domain_alias"].strip()
        domain_regex = r"^(https?://)?([a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\])(:[0-9]+)?(/.*)?$"
        if not re.match(domain_regex, domain_str):
            return False

    if "custom_ssl" in branding and branding["custom_ssl"] is not None:
        if not isinstance(branding["custom_ssl"], dict):
            return False
        ssl_cfg = branding["custom_ssl"]
        if "cert_path" in ssl_cfg and not isinstance(ssl_cfg["cert_path"], str):
            return False
        if "key_path" in ssl_cfg and not isinstance(ssl_cfg["key_path"], str):
            return False
        if "ca_path" in ssl_cfg and not isinstance(ssl_cfg["ca_path"], str):
            return False
        if "verify_ssl" in ssl_cfg and not isinstance(ssl_cfg["verify_ssl"], bool):
            return False

    if "enterprise_identity" in branding and branding["enterprise_identity"] is not None:
        if not isinstance(branding["enterprise_identity"], dict):
            return False
        ent = branding["enterprise_identity"]
        for k in ["organization_name", "support_url", "support_email", "footer_text"]:
            if k in ent and not isinstance(ent[k], str):
                return False

    return True


def get_effective_branding(config):
    """
    Returns merged effective branding configuration dictionary with defaults.
    :visibility: public
    """
    default_branding = DEFAULT_CONFIG["branding"]
    raw_branding = (config or {}).get("branding") or (config or {}).get("white_label") or {}
    return {
        "enabled": bool(raw_branding.get("enabled", default_branding["enabled"])),
        "app_name": (raw_branding.get("app_name") or "").strip() or default_branding["app_name"],
        "logo_path": raw_branding.get("logo_path", default_branding["logo_path"]),
        "brand_colors": {
            "primary": (raw_branding.get("brand_colors") or {}).get("primary") or default_branding["brand_colors"]["primary"],
            "accent": (raw_branding.get("brand_colors") or {}).get("accent") or default_branding["brand_colors"]["accent"],
            "background": (raw_branding.get("brand_colors") or {}).get("background") or default_branding["brand_colors"]["background"],
            "text": (raw_branding.get("brand_colors") or {}).get("text") or default_branding["brand_colors"]["text"],
        },
        "domain_alias": raw_branding.get("domain_alias", default_branding["domain_alias"]),
        "custom_ssl": {
            "cert_path": (raw_branding.get("custom_ssl") or {}).get("cert_path") or default_branding["custom_ssl"]["cert_path"],
            "key_path": (raw_branding.get("custom_ssl") or {}).get("key_path") or default_branding["custom_ssl"]["key_path"],
            "ca_path": (raw_branding.get("custom_ssl") or {}).get("ca_path") or default_branding["custom_ssl"]["ca_path"],
            "verify_ssl": (raw_branding.get("custom_ssl") or {}).get("verify_ssl", default_branding["custom_ssl"]["verify_ssl"]),
        },
        "enterprise_identity": {
            "organization_name": (raw_branding.get("enterprise_identity") or {}).get("organization_name") or default_branding["enterprise_identity"]["organization_name"],
            "support_url": (raw_branding.get("enterprise_identity") or {}).get("support_url") or default_branding["enterprise_identity"]["support_url"],
            "support_email": (raw_branding.get("enterprise_identity") or {}).get("support_email") or default_branding["enterprise_identity"]["support_email"],
            "footer_text": (raw_branding.get("enterprise_identity") or {}).get("footer_text") or default_branding["enterprise_identity"]["footer_text"],
        }
    }


def get_effective_domain_url(branding_config, endpoint_path=""):
    """
    Resolves domain alias URL for enterprise server endpoints.
    :visibility: public
    """
    domain = ((branding_config or {}).get("domain_alias") or "").strip()
    if not domain:
        return endpoint_path
    if not domain.startswith("http://") and not domain.startswith("https://"):
        domain = "https://" + domain
    domain = domain.rstrip("/")
    path = endpoint_path if endpoint_path.startswith("/") else "/" + endpoint_path
    return domain + path


def get_ssl_context(branding_config):
    """
    Creates an SSLContext configured with custom enterprise SSL certificates/CAs.
    :visibility: public
    """
    import ssl
    ssl_cfg = (branding_config or {}).get("custom_ssl") or {}
    verify_ssl = ssl_cfg.get("verify_ssl", True)
    ca_path = ssl_cfg.get("ca_path")
    cert_path = ssl_cfg.get("cert_path")
    key_path = ssl_cfg.get("key_path")

    if not verify_ssl:
        ctx = ssl._create_unverified_context()
        return ctx

    ctx = ssl.create_default_context(cafile=ca_path if ca_path and os.path.exists(ca_path) else None)
    if cert_path and os.path.exists(cert_path):
        ctx.load_cert_chain(certfile=cert_path, keyfile=key_path if key_path and os.path.exists(key_path) else None)
    return ctx

def get_profiles(config):
    """
    Normalizes profiles section from config into a list of profile dicts.
    :visibility: public
    """
    if not isinstance(config, dict) or "profiles" not in config:
        return []
    profiles_raw = config["profiles"]
    if isinstance(profiles_raw, list):
        result = []
        for p in profiles_raw:
            if isinstance(p, str):
                result.append({"name": p, "env": {}})
            elif isinstance(p, dict):
                p_name = p.get("name", "Default")
                p_env = p.get("env") or p.get("envVars") or p.get("environment") or {}
                result.append({"name": p_name, "env": p_env})
        return result
    elif isinstance(profiles_raw, dict):
        result = []
        for name, val in profiles_raw.items():
            env_obj = {}
            if isinstance(val, dict):
                env_obj = val.get("env") or val.get("envVars") or val.get("environment") or val
            result.append({"name": name, "env": env_obj})
        return result
    return []

def get_active_profile_name(config):
    """
    Resolves active profile name from config.
    :visibility: public
    """
    if not isinstance(config, dict):
        return None
    if isinstance(config.get("active_profile"), str):
        return config["active_profile"]
    if isinstance(config.get("activeProfile"), str):
        return config["activeProfile"]
    profiles = get_profiles(config)
    return profiles[0]["name"] if profiles else None

def get_profile_env(config, profile_name=None):
    """
    Gets environment variables dict for specified profile name.
    :visibility: public
    """
    target_name = profile_name or get_active_profile_name(config)
    if not target_name:
        return {}
    profiles = get_profiles(config)
    target_lower = target_name.lower()
    for p in profiles:
        if p["name"].lower() == target_lower:
            return p.get("env", {})
    return {}

def is_command_visible_in_profile(cmd, active_profile):
    """
    Determines whether a command is visible in active profile context.
    :visibility: public
    """
    if not isinstance(cmd, dict):
        return True
    allowed_profiles = None
    if isinstance(cmd.get("profiles"), list):
        allowed_profiles = cmd["profiles"]
    elif isinstance(cmd.get("profiles"), str):
        allowed_profiles = [cmd["profiles"]]
    elif isinstance(cmd.get("profile"), str):
        allowed_profiles = [cmd["profile"]]

    if not allowed_profiles:
        return True
    if not active_profile:
        return True

    active_lower = active_profile.lower()
    for p in allowed_profiles:
        if isinstance(p, str):
            p_lower = p.lower()
            if p_lower in ("*", "all", active_lower):
                return True
    return False

def merge_environment(base_env, config, profile_name=None):
    """
    Merges profile env vars into base environment dict.
    :visibility: public
    """
    merged = dict(base_env or {})
    profile_env = get_profile_env(config, profile_name)
    for k, v in profile_env.items():
        if v is not None:
            merged[str(k)] = str(v)
    return merged


def match_pattern(command, pattern, pattern_type=None):
    """
    Evaluates whether a command matches a given pattern using specified strategy.
    Supported types: 'exact', 'substring', 'glob', 'regex', 'binary'.
    :visibility: public
    """
    if not command or not isinstance(command, str):
        return False
    if not pattern:
        return False

    cmd_str = command.strip()
    pat_str = str(pattern).strip()

    match_type = pattern_type
    if not match_type:
        if "*" in pat_str or "?" in pat_str:
            match_type = "glob"
        elif pat_str.startswith("^") or pat_str.endswith("$"):
            match_type = "regex"
        else:
            match_type = "substring"

    if match_type == "exact":
        return cmd_str == pat_str or cmd_str.lower() == pat_str.lower()

    if match_type == "substring":
        return pat_str.lower() in cmd_str.lower()

    if match_type == "glob":
        return fnmatch.fnmatch(cmd_str.lower(), pat_str.lower())

    if match_type == "regex":
        try:
            return bool(re.search(pat_str, cmd_str, re.IGNORECASE))
        except Exception:
            return False

    if match_type == "binary":
        try:
            tokens = shlex.split(cmd_str)
        except Exception:
            tokens = cmd_str.split()
        if not tokens:
            return False
        binary = tokens[0]
        return (
            binary == pat_str or
            binary.endswith("/" + pat_str) or
            pat_str.endswith("/" + binary) or
            pat_str.lower() in binary.lower()
        )

    return False


def is_user_in_context(user_context=None, rule_users=None, rule_groups=None):
    """
    Checks whether user or group context satisfies user/group restrictions on a policy rule.
    :visibility: public
    """
    username = user_context.get("username") if isinstance(user_context, dict) else None
    user_groups = user_context.get("groups") if isinstance(user_context, dict) else None

    if not username:
        try:
            import getpass
            username = getpass.getuser()
        except Exception:
            username = os.environ.get("USER") or os.environ.get("USERNAME") or "unknown"

    if user_groups is None:
        user_groups = []
        try:
            import grp
            group_ids = os.getgroups() if hasattr(os, "getgroups") else []
            for gid in group_ids:
                try:
                    user_groups.append(grp.getgrgid(gid).gr_name)
                except Exception:
                    pass
        except Exception:
            pass

    if rule_users and isinstance(rule_users, list) and len(rule_users) > 0:
        matches_user = any(u == "*" or u.lower() == username.lower() for u in rule_users)
        if not matches_user:
            return False

    if rule_groups and isinstance(rule_groups, list) and len(rule_groups) > 0:
        matches_group = any(
            g == "*" or any(ug.lower() == g.lower() for ug in user_groups)
            for g in rule_groups
        )
        if not matches_group:
            return False

    return True
DEFAULT_APPROVAL_SECRET = "cmdbar-approval-secret-key"

def create_approval_token(command, approver="admin", expires_in_sec=3600, key=None):
    """
    Creates a signed approval token for overriding a blocked command.
    :visibility: public
    """
    secret = key or DEFAULT_APPROVAL_SECRET
    expires_at = time.time() + expires_in_sec
    payload = json.dumps({"command": command, "approver": approver, "expiresAt": expires_at}, sort_keys=True)
    sig = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    token_data = {"payload": payload, "sig": sig}
    return base64.b64encode(json.dumps(token_data).encode("utf-8")).decode("utf-8")


def validate_approval_token(token_str, command=None, key=None):
    """
    Validates an approval token for a specific command.
    :visibility: public
    """
    if not token_str or not isinstance(token_str, str):
        return {"valid": False, "error": "Missing token", "tokenData": None}

    try:
        raw = base64.b64decode(token_str.encode("utf-8")).decode("utf-8")
        data_obj = json.loads(raw)
        payload = data_obj.get("payload")
        sig = data_obj.get("sig")
        data = json.loads(payload)

        if time.time() > data.get("expiresAt", 0):
            return {"valid": False, "error": "Approval token expired", "tokenData": data}

        if command and data.get("command") != "*" and data.get("command", "").strip() != command.strip():
            return {"valid": False, "error": "Token command mismatch", "tokenData": data}

        secret = key or DEFAULT_APPROVAL_SECRET
        expected_sig = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
        if sig != expected_sig:
            return {"valid": False, "error": "Invalid token signature", "tokenData": data}

        return {"valid": True, "error": None, "tokenData": data}
    except Exception as e:
        return {"valid": False, "error": f"Malformed approval token: {e}", "tokenData": None}


def grant_approval_override(overrides, command, approver="admin", expires_in_sec=3600):
    """
    Grants an approval override for a command in the overrides dict.
    :visibility: public
    """
    if not isinstance(overrides, dict):
        return None
    expires_at = time.time() + expires_in_sec
    entry = {
        "command": command,
        "approved_by": approver,
        "expires_at": expires_at,
        "created_at": time.time()
    }
    overrides[command.strip()] = entry
    return entry


def evaluate_command_policy(command, user_context=None, policy=None, overrides=None):
    """
    Evaluates a command against security policy rules (blacklist, whitelist, pattern matching, user/group filters, overrides).
    :visibility: public
    """
    if not command or not isinstance(command, str) or not command.strip():
        return {
            "allowed": False,
            "action": "block",
            "reason": "Command is empty or invalid.",
            "matchedRule": None,
            "requiresApproval": False,
            "canOverride": False,
            "overrideActive": False
        }

    cmd_str = command.strip()

    if policy and policy.get("enabled") is False:
        return {
            "allowed": True,
            "action": "allow",
            "reason": "Policy enforcement is disabled.",
            "matchedRule": None,
            "requiresApproval": False,
            "canOverride": False,
            "overrideActive": False
        }

    effective_policy = policy if isinstance(policy, dict) else {}
    effective_overrides = overrides if overrides is not None else effective_policy.get("overrides", {})

    if isinstance(effective_overrides, str):
        token_val = validate_approval_token(effective_overrides, cmd_str)
        if token_val.get("valid"):
            return {
                "allowed": True,
                "action": "allow",
                "reason": f"Execution allowed via valid approval token (approved by {token_val['tokenData'].get('approver')}).",
                "matchedRule": None,
                "requiresApproval": False,
                "canOverride": True,
                "overrideActive": True
            }
    elif isinstance(effective_overrides, dict):
        override_entry = effective_overrides.get(cmd_str)
        if override_entry:
            if isinstance(override_entry, dict) and "expires_at" in override_entry:
                if time.time() < override_entry["expires_at"]:
                    return {
                        "allowed": True,
                        "action": "allow",
                        "reason": f"Execution allowed via approved policy override (approved by {override_entry.get('approved_by', 'admin')}).",
                        "matchedRule": None,
                        "requiresApproval": False,
                        "canOverride": True,
                        "overrideActive": True
                    }
            elif override_entry is True:
                return {
                    "allowed": True,
                    "action": "allow",
                    "reason": "Execution allowed via policy override flag.",
                    "matchedRule": None,
                    "requiresApproval": False,
                    "canOverride": True,
                    "overrideActive": True
                }

    blacklist = effective_policy.get("blacklist", [])
    rules = effective_policy.get("rules", [])

    blacklist_rules = []
    for item in blacklist:
        if isinstance(item, str):
            blacklist_rules.append({"pattern": item, "action": "block", "allow_override": True})
        elif isinstance(item, dict):
            r = dict(item)
            r.setdefault("action", "block")
            r.setdefault("allow_override", True)
            blacklist_rules.append(r)
    for rule in rules:
        if isinstance(rule, dict) and rule.get("action") == "block":
            blacklist_rules.append(rule)

    for rule in blacklist_rules:
        if is_user_in_context(user_context, rule.get("users"), rule.get("groups")):
            if match_pattern(cmd_str, rule.get("pattern"), rule.get("type")):
                can_override = rule.get("allow_override") is not False
                return {
                    "allowed": False,
                    "action": "block",
                    "reason": rule.get("reason") or f"Command blocked by blacklist rule matching pattern '{rule.get('pattern')}'.",
                    "matchedRule": rule,
                    "requiresApproval": can_override,
                    "canOverride": can_override,
                    "overrideActive": False
                }

    whitelist = effective_policy.get("whitelist", [])
    whitelist_rules = []
    for item in whitelist:
        if isinstance(item, str):
            whitelist_rules.append({"pattern": item, "action": "allow"})
        elif isinstance(item, dict):
            r = dict(item)
            r.setdefault("action", "allow")
            whitelist_rules.append(r)
    for rule in rules:
        if isinstance(rule, dict) and rule.get("action") == "allow":
            whitelist_rules.append(rule)

    is_whitelist_mode = len(whitelist_rules) > 0 or effective_policy.get("mode") in ("whitelist_only", "hybrid")
    if is_whitelist_mode:
        matched_whitelist = False
        matched_rule = None
        for rule in whitelist_rules:
            if is_user_in_context(user_context, rule.get("users"), rule.get("groups")):
                if match_pattern(cmd_str, rule.get("pattern"), rule.get("type")):
                    matched_whitelist = True
                    matched_rule = rule
                    break

        if not matched_whitelist:
            return {
                "allowed": False,
                "action": "block",
                "reason": "Command is not in the approved whitelist.",
                "matchedRule": None,
                "requiresApproval": True,
                "canOverride": True,
                "overrideActive": False
            }

    return {
        "allowed": True,
        "action": "allow",
        "reason": "Command allowed by security policy.",
        "matchedRule": None,
        "requiresApproval": False,
        "canOverride": True,
        "overrideActive": False
    }
