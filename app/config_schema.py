import os
import json
import re
import shlex
import subprocess
import hmac
import hashlib
import secrets

def canonical_json(obj):
    if isinstance(obj, dict):
        clean = {k: v for k, v in obj.items() if k != "signature"}
        return json.dumps(clean, sort_keys=True, separators=(',', ':'))
    elif isinstance(obj, list):
        return '[' + ','.join(canonical_json(x) for x in obj) + ']'
    return json.dumps(obj, separators=(',', ':'))

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
    return hmac.new(key.encode("utf-8"), str_val.encode("utf-8"), hashlib.sha256).hexdigest()

DEFAULT_CONFIG = {
  "ai": {
    "provider": "openai",
    "model": "gpt-4o",
    "temperature": 0.2,
    "require_confirmation": True,
    "fallback_provider": "ollama",
    "fallback_model": "llama3"
  },
  "branding": {
    "enabled": False,
    "app_name": "CmdBar",
    "logo_path": "",
    "brand_colors": {
      "primary": "#3584e4",
      "accent": "#1c71d8",
      "background": "#2d2d2d",
      "text": "#ffffff"
    },
    "domain_alias": "",
    "custom_ssl": {
      "cert_path": "",
      "key_path": "",
      "ca_path": "",
      "verify_ssl": True
    },
    "enterprise_identity": {
      "organization_name": "",
      "support_url": "",
      "support_email": "",
      "footer_text": ""
    }
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
              "error_message": "Invalid host format! Must contain only alphanumeric, dots, and dashes."
            }
          }
        },
        {
          "name": "Direct Exec",
          "command": "/usr/bin/echo \"Hello\" <arg>",
          "mode": "direct-array",
          "parameters": {
            "arg": {
              "regex": "^[a-zA-Z0-9_]+$",
              "error_message": "Invalid argument format! Must be alphanumeric or underscore."
            }
          }
        }
      ]
    }
  ]
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
        expected_sig = compute_signature(config_data, key) if isinstance(config_data, dict) else None

        if not sig or sig != expected_sig:
            backup_path = path + ".bak"
            try:
                if os.path.exists(path):
                    os.replace(path, backup_path)
            except Exception:
                pass
            try:
                subprocess.Popen(["notify-send", "Security Alert: Config Verification Failed", "Untrusted or tampered configuration file detected. Archived to .bak and restored safe defaults."])
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
    forbidden = [';', '&&', '||', '|', '&', '`', '$', '(', ')', '>', '<']
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

def resolve_command_preview(command_template, mode, parameter_values, parameters_schema):
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
        return resolved, errors
    else:
        # direct-array mode
        try:
            parts = shlex.split(command_template)
        except Exception:
            parts = command_template.split() # fallback
            
        resolved_parts = []
        for part in parts:
            def replacer_part(match):
                ph = match.group(1) or match.group(2) or match.group(3)
                if ph in preview_values:
                    return preview_values[ph]
                return match.group(0)

            resolved_part = re.sub(pattern, replacer_part, part)
            resolved_parts.append(resolved_part)
            
        # Preview representation for direct-array is the list of individual args
        array_preview = "Direct Array: " + " ".join(shlex.quote(p) for p in resolved_parts)
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

