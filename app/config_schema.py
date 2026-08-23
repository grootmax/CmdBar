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
  "profiles": [
    {
      "name": "Production",
      "env": {
        "ENV": "production",
        "LOG_LEVEL": "warn"
      }
    },
    {
      "name": "Staging",
      "env": {
        "ENV": "staging",
        "LOG_LEVEL": "info"
      }
    },
    {
      "name": "Development",
      "env": {
        "ENV": "development",
        "LOG_LEVEL": "debug"
      }
    }
  ],
  "active_profile": "Development",
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

