import os
import json
import re
import shlex

DEFAULT_CONFIG = {
  "categories": [
    {
      "name": "System Utilities",
      "shortcuts": [
        {
          "name": "Ping Host",
          "command": "ping -c 3 <host>",
          "mode": "shell-quoted",
          "parameters": [
            {
              "name": "host",
              "regex": "^[a-zA-Z0-9.-]+$",
              "error_message": "Invalid host format! Must contain only alphanumeric, dots, and dashes."
            }
          ]
        },
        {
          "name": "Direct Exec",
          "command": "/usr/bin/echo \"Hello\" <arg>",
          "mode": "direct-array",
          "parameters": [
            {
              "name": "arg",
              "regex": "^[a-zA-Z0-9_]+$",
              "error_message": "Invalid argument format! Must be alphanumeric or underscore."
            }
          ]
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
    
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        save_config(DEFAULT_CONFIG, path)
        return DEFAULT_CONFIG
    
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception:
        # Fallback to default if corrupt
        return DEFAULT_CONFIG

def save_config(config_data, path=None):
    if path is None:
        path = get_config_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(config_data, f, indent=2)

def validate_parameter_value(value, parameter_schema):
    """
    Validates a parameter value against its schema (regex + forbidden chars).
    Returns (is_valid, error_message).
    :visibility: public
    """
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
    
    # First, validate all parameters
    for param in parameters_schema:
        name = param.get("name")
        val = parameter_values.get(name, "")
        is_valid, err_msg = validate_parameter_value(val, param)
        if not is_valid:
            errors[name] = err_msg
            
    # We should mask secure parameter values *only* for the preview substitution.
    # The actual validation must have already run on the plain-text value.
    preview_values = {}
    for param in parameters_schema:
        name = param.get("name")
        val = parameter_values.get(name, "")
        if param.get("secure", False):
            preview_values[name] = "*" * len(val) if val else ""
        else:
            preview_values[name] = val

    if mode == "shell-quoted":
        # Substitution with shell quoting
        resolved = command_template
        for param in parameters_schema:
            name = param.get("name")
            val = preview_values.get(name, "")
            # Quote the value safely
            quoted_val = shlex.quote(val)
            resolved = resolved.replace(f"<{name}>", quoted_val)
        return resolved, errors
    else:
        # direct-array mode
        try:
            parts = shlex.split(command_template)
        except Exception:
            parts = command_template.split() # fallback
            
        resolved_parts = []
        for part in parts:
            for param in parameters_schema:
                name = param.get("name")
                val = preview_values.get(name, "")
                part = part.replace(f"<{name}>", val)
            resolved_parts.append(part)
            
        # Preview representation for direct-array is the list of individual args
        array_preview = "Direct Array: " + " ".join(shlex.quote(p) for p in resolved_parts)
        # We can also append the list format to be 100% explicit
        array_preview += f"\nArgs List: {json.dumps(resolved_parts)}"
        return array_preview, errors
