#!/usr/bin/env python3
import sys
import os
import json
import re
import shlex
import subprocess
import argparse
import hmac
import hashlib
import secrets
from companion.ai_translator import is_ai_command, translate_natural_language_to_command

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

# Check for GTK/Adwaita availability
GUI_AVAILABLE = False
try:
    import gi
    gi.require_version('Gtk', '4.0')
    gi.require_version('Adw', '1')
    from gi.repository import Gtk, Adw, GLib, Gio
    GUI_AVAILABLE = True
except (ImportError, ValueError):
    GUI_AVAILABLE = False


def set_uniform_margin(widget, margin: int):
    """
    Applies uniform margins (top, bottom, start, end) in integer pixels to a UI container widget.
    :visibility: public
    """
    if widget is None:
        return
    margin_val = int(margin)
    if hasattr(widget, "set_margin_top"):
        widget.set_margin_top(margin_val)
    if hasattr(widget, "set_margin_bottom"):
        widget.set_margin_bottom(margin_val)
    if hasattr(widget, "set_margin_start"):
        widget.set_margin_start(margin_val)
    if hasattr(widget, "set_margin_end"):
        widget.set_margin_end(margin_val)


apply_uniform_margin = set_uniform_margin
set_margin_all = set_uniform_margin

if GUI_AVAILABLE:
    if not hasattr(Gtk.Widget, "set_margin_all"):
        Gtk.Widget.set_margin_all = set_uniform_margin


def get_config_path():
    """
    Returns the path to the configuration file, supporting environment variable override.
    """
    if os.environ.get('CMDBAR_CONFIG_PATH'):
        return os.environ['CMDBAR_CONFIG_PATH']
    return os.path.expanduser('~/.config/cmdbar/config.json')


def init_config():
    """
    Initializes the configuration directory and file with default values if it doesn't exist.
    """
    config_path = get_config_path()
    os.makedirs(os.path.dirname(config_path), exist_ok=True)
    if not os.path.exists(config_path):
        default_config = {
            "categories": [
                {
                    "name": "Projects",
                    "commands": [
                        {
                            "name": "Git Checkout",
                            "template": "git checkout {branch}",
                            "parameters": {
                                "branch": {
                                    "regex": r"^[a-zA-Z0-9_\-/\\.]+$",
                                    "placeholder": "Enter branch name"
                                }
                            }
                        },
                        {
                            "name": "Docker Logs",
                            "template": "docker logs {container_id}",
                            "parameters": {
                                "container_id": {
                                    "placeholder": "Enter container ID"
                                }
                            }
                        }
                    ]
                }
            ]
        }
        save_config(default_config)
    return config_path


def load_config(path=None):
    """
    Loads and parses the configuration file, verifying its signature.
    """
    config_path = path if path else init_config()
    key_path = get_key_path(config_path)
    key = get_or_create_signing_key(key_path)
    try:
        with open(config_path, "r") as f:
            config_data = json.load(f)
        
        # Verify cryptographic signature
        sig = config_data.get("signature") if isinstance(config_data, dict) else None
        expected_sig = compute_signature(config_data, key) if isinstance(config_data, dict) else None

        if not sig or sig != expected_sig:
            backup_path = config_path + ".bak"
            try:
                if os.path.exists(config_path):
                    os.replace(config_path, backup_path)
            except Exception:
                pass
            config_data = {
                "categories": [
                    {
                        "name": "Projects",
                        "commands": [
                            {
                                "name": "Git Checkout",
                                "template": "git checkout {branch}",
                                "parameters": {
                                    "branch": {
                                        "regex": r"^[a-zA-Z0-9_\-/\\.]+$",
                                        "placeholder": "Enter branch name"
                                    }
                                }
                            },
                            {
                                "name": "Docker Logs",
                                "template": "docker logs {container_id}",
                                "parameters": {
                                    "container_id": {
                                        "placeholder": "Enter container ID"
                                    }
                                }
                            }
                        ]
                    }
                ]
            }
            save_config(config_data)
            return config_data
    except (json.JSONDecodeError, OSError) as e:
        print(f"Error loading configuration: {e}", file=sys.stderr)
        return {"categories": []}

    # Normalize config_data for CLI companion compatibility
    migrated = False
    for cat in config_data.get("categories", []):
        # Convert legacy "shortcuts" to "commands"
        if "shortcuts" in cat:
            if "commands" not in cat:
                cat["commands"] = cat["shortcuts"]
            del cat["shortcuts"]
            migrated = True

        if "commands" in cat:
            for cmd in cat["commands"]:
                # Translate "command" -> "template"
                if "command" in cmd and "template" not in cmd:
                    cmd["template"] = cmd["command"]
                    migrated = True
                # Translate "parameters" list of dicts -> dict
                if "parameters" in cmd and isinstance(cmd["parameters"], list):
                    params_dict = {}
                    for p in cmd["parameters"]:
                        p_name = p.get("name")
                        if p_name:
                            p_cfg = {}
                            if "regex" in p:
                                p_cfg["regex"] = p["regex"]
                            if "placeholder" in p:
                                p_cfg["placeholder"] = p["placeholder"]
                            params_dict[p_name] = p_cfg
                    cmd["parameters"] = params_dict
                    migrated = True

    if migrated:
        save_config(config_data)

    return config_data


def save_config(config_data, path=None):
    """
    Saves the configuration to the file safely with a cryptographic signature.
    """
    config_path = path if path else get_config_path()
    os.makedirs(os.path.dirname(config_path), exist_ok=True)
    if isinstance(config_data, dict):
        key_path = get_key_path(config_path)
        key = get_or_create_signing_key(key_path)
        config_data["signature"] = compute_signature(config_data, key)
    try:
        # Write to a temporary file first, then rename, to avoid corrupted configs
        tmp_path = config_path + ".tmp"
        with open(tmp_path, "w") as f:
            json.dump(config_data, f, indent=4)
        os.replace(tmp_path, config_path)
        return True
    except OSError as e:
        print(f"Error saving configuration: {e}", file=sys.stderr)
        return False


def validate_input(value, pattern=None):
    r"""
    Validates user input against a regex pattern.
    If no pattern is provided, defaults to standard alphanumeric pattern: ^[a-zA-Z0-9_\-]+$
    :visibility: public
    """
    value = str(value).strip() if value is not None else ""
    if not pattern:
        pattern = r"^[a-zA-Z0-9_\-]+$"
    try:
        compiled = re.compile(pattern)
        # We use search to match GJS's RegExp.test() behavior, but check for matches
        return bool(compiled.search(value))
    except re.error:
        return False


def find_placeholders(template):
    """
    Extracts all placeholders from command template. E.g. {branch}, {{service}}, or <host> -> ['branch', 'service', 'host']
    """
    if not template or not isinstance(template, str):
        return []
    pattern = r"\{\{([^}]+)\}\}|<([^>]+)>|\{([^}]+)\}"
    matches = re.findall(pattern, template)
    placeholders = []
    for g1, g2, g3 in matches:
        ph = g1 or g2 or g3
        if ph and ph not in placeholders:
            placeholders.append(ph)
    return placeholders


def substitute_and_quote_command(template, params_data):
    """
    Replaces placeholders in template with shell-quoted parameter values.
    Supports {ph}, {{ph}}, and <ph> placeholder syntaxes.
    """
    if not template or not isinstance(template, str):
        return ""

    def replacer(match):
        ph = match.group(1) or match.group(2) or match.group(3)
        if ph in params_data:
            val = str(params_data[ph]).strip() if params_data[ph] is not None else ""
            return shlex.quote(val)
        return match.group(0)

    pattern = r"\{\{([^}]+)\}\}|<([^>]+)>|\{([^}]+)\}"
    return re.sub(pattern, replacer, template)


def tokenize_and_substitute(template, params=None):
    if not template:
        return []
    if isinstance(template, list):
        tokens = list(template)
    else:
        tokens = shlex.split(template)
    if not params:
        return tokens
    result = []
    for token in tokens:
        sub = token
        for k, v in params.items():
            str_v = str(v) if v is not None else ""
            sub = sub.replace(f"{{{k}}}", str_v)
            sub = sub.replace(f"<{k}>", str_v)
            sub = sub.replace(f"{{{{{k}}}}}", str_v)
        result.append(sub)
    return result


def get_preview_tokens(tokens, params=None, schema=None):
    if not tokens:
        return []
    secure_keys = set()
    if isinstance(schema, list):
        for item in schema:
            if isinstance(item, dict) and item.get("secure"):
                secure_keys.add(item.get("name"))
    elif isinstance(schema, dict):
        for k, v in schema.items():
            if isinstance(v, dict) and v.get("secure"):
                secure_keys.add(k)
    preview = []
    for token in tokens:
        sub = token
        if params:
            for k, v in params.items():
                val_str = str(v) if v is not None else ""
                is_secure = (k in secure_keys) or any(s in k.lower() for s in ["password", "secret", "token"])
                replace_val = "[REDACTED]" if is_secure else val_str
                sub = sub.replace(f"{{{k}}}", replace_val)
                sub = sub.replace(f"<{k}>", replace_val)
                sub = sub.replace(f"{{{{{k}}}}}", replace_val)
                if is_secure and val_str and val_str in sub:
                    sub = sub.replace(val_str, "[REDACTED]")
        preview.append(sub)
    return preview


def run_command_in_shell(command_str):
    """
    Runs the given command string inside a shell and returns (exit_code, stdout, stderr).
    """
    try:
        res = subprocess.run(command_str, shell=True, text=True, capture_output=True)
        return res.returncode, res.stdout, res.stderr
    except Exception as e:
        return -1, "", str(e)


# =====================================================================
# CLI / INTERACTIVE COMPANION APP MODE
# =====================================================================

def run_cli_mode():
    print("===============================================")
    print("   CmdBar Companion Management App (CLI Mode)   ")
    print("===============================================")
    
    while True:
        config_data = load_config()
        print("\nMain Menu:")
        print("1. List Categories & Commands")
        print("2. Add Category")
        print("3. Add Command")
        print("4. Edit Command")
        print("5. Delete Command/Category")
        print("6. Test-Run Command Template")
        print("7. Manage Cron Schedules")
        print("8. Exit")
        
        choice = input("\nEnter choice [1-8]: ").strip()
        if choice == "1":
            list_categories_and_commands(config_data)
        elif choice == "2":
            add_category(config_data)
        elif choice == "3":
            add_command(config_data)
        elif choice == "4":
            edit_command(config_data)
        elif choice == "5":
            delete_item(config_data)
        elif choice == "6":
            test_run_command_flow(config_data)
        elif choice == "7":
            manage_schedules_cli(config_data)
        elif choice == "8":
            print("Goodbye!")
            break
        else:
            print("Invalid choice, please try again.")


def manage_schedules_cli(config_data):
    from app.cron_scheduler import is_valid_cron_expression, CronScheduler, get_next_run_time
    schedules = config_data.setdefault("schedules", [])

    print("\n--- Manage Cron Schedules ---")
    print("1. List Schedules")
    print("2. Add Schedule")
    print("3. Delete Schedule")
    print("4. Run Schedule Now")
    print("5. Back")

    sub_choice = input("Enter choice [1-5]: ").strip()
    if sub_choice == "1":
        if not schedules:
            print("\nNo schedules configured.")
            return
        for i, s in enumerate(schedules, 1):
            print(f"\n[{i}] Schedule: {s.get('name')}")
            print(f"    Command : {s.get('command')}")
            print(f"    Cron    : {s.get('schedule')}")
            print(f"    Timezone: {s.get('timezone', 'Local')}")
            print(f"    Status  : {s.get('last_status', 'never_run')}")
            try:
                nxt = get_next_run_time(s.get('schedule'), tz_str=s.get('timezone', 'Local'))
                print(f"    Next Run: {nxt.isoformat()}")
            except Exception:
                pass
    elif sub_choice == "2":
        name = input("Enter Schedule Name: ").strip()
        if not name:
            print("Name cannot be empty.")
            return
        cmd = input("Enter Command String: ").strip()
        if not cmd:
            print("Command cannot be empty.")
            return
        cron_expr = input("Enter Cron Expression (e.g., '0 0 * * *' or '@hourly'): ").strip()
        if not is_valid_cron_expression(cron_expr):
            print("Invalid cron expression.")
            return
        tz = input("Enter Timezone (default 'Local', e.g. 'UTC', 'America/New_York'): ").strip() or "Local"
        
        new_s = {
            "id": f"sched-{len(schedules) + 1}",
            "name": name,
            "command": cmd,
            "schedule": cron_expr,
            "timezone": tz,
            "enabled": True,
            "prevent_overlap": True,
            "email_reports": {"enabled": False, "recipients": [], "trigger": "on_failure"},
            "last_run": None,
            "next_run": None,
            "last_status": "never_run",
            "last_output": "",
            "last_error": ""
        }
        schedules.append(new_s)
        save_config(config_data)
        print(f"Schedule '{name}' added successfully!")
    elif sub_choice == "3":
        if not schedules:
            print("No schedules to delete.")
            return
        for i, s in enumerate(schedules, 1):
            print(f"{i}. {s.get('name')} ({s.get('schedule')})")
        idx_str = input("Select schedule number to delete: ").strip()
        if idx_str.isdigit() and 1 <= int(idx_str) <= len(schedules):
            removed = schedules.pop(int(idx_str) - 1)
            save_config(config_data)
            print(f"Removed schedule '{removed.get('name')}'.")
        else:
            print("Invalid index.")
    elif sub_choice == "4":
        if not schedules:
            print("No schedules available.")
            return
        for i, s in enumerate(schedules, 1):
            print(f"{i}. {s.get('name')} ({s.get('command')})")
        idx_str = input("Select schedule number to run now: ").strip()
        if idx_str.isdigit() and 1 <= int(idx_str) <= len(schedules):
            s = schedules[int(idx_str) - 1]
            scheduler = CronScheduler()
            res = scheduler.run_job_now(s.get("id"))
            s["last_run"] = res.get("timestamp")
            s["last_status"] = res.get("status")
            s["last_output"] = res.get("stdout")
            s["last_error"] = res.get("stderr")
            save_config(config_data)
            print(f"Execution complete: {res.get('status').upper()} (exit code {res.get('exit_code')})")
            if res.get("stdout"):
                print(f"STDOUT:\n{res.get('stdout')}")
            if res.get("stderr"):
                print(f"STDERR:\n{res.get('stderr')}")


def list_categories_and_commands(config_data):
    categories = config_data.get("categories", [])
    if not categories:
        print("\nNo categories defined.")
        return
    
    for i, cat in enumerate(categories, 1):
        print(f"\n[{i}] Category: {cat.get('name')}")
        commands = cat.get("commands", [])
        if not commands:
            print("    (No commands)")
        for j, cmd in enumerate(commands, 1):
            print(f"    {i}.{j} {cmd.get('name')}")
            print(f"        Template: {cmd.get('template')}")
            params = cmd.get("parameters", {})
            if params:
                print(f"        Parameters:")
                for ph, cfg in params.items():
                    print(f"          - {{{ph}}}: regex={cfg.get('regex', 'default')}, placeholder={cfg.get('placeholder', '')}")


def add_category(config_data):
    name = input("Enter new category name: ").strip()
    if not name:
        print("Category name cannot be empty.")
        return
    
    config_data.setdefault("categories", []).append({
        "name": name,
        "commands": []
    })
    if save_config(config_data):
        print(f"Category '{name}' added successfully!")


def add_command(config_data):
    categories = config_data.get("categories", [])
    if not categories:
        print("Please add a category first.")
        return
    
    print("\nSelect Category:")
    for idx, cat in enumerate(categories, 1):
        print(f"{idx}. {cat['name']}")
    
    try:
        cat_idx = int(input("Select category number: ")) - 1
        if cat_idx < 0 or cat_idx >= len(categories):
            print("Invalid category selection.")
            return
    except ValueError:
        print("Invalid selection.")
        return
    
    category = categories[cat_idx]
    
    name = input("Enter command name (e.g. Git Checkout): ").strip()
    if not name:
        print("Command name cannot be empty.")
        return
        
    template = input("Enter command template (e.g. git checkout {branch}): ").strip()
    if not template:
        print("Template cannot be empty.")
        return
        
    placeholders = find_placeholders(template)
    parameters = {}
    
    for ph in placeholders:
        print(f"\nConfiguring parameter: {{{ph}}}")
        placeholder_text = input(f"Enter helper placeholder text for {{{ph}}}: ").strip()
        regex_pattern = input(f"Enter custom validation regex (press enter for default alphanumeric): ").strip()
        
        param_cfg = {}
        if placeholder_text:
            param_cfg["placeholder"] = placeholder_text
        if regex_pattern:
            param_cfg["regex"] = regex_pattern
        
        parameters[ph] = param_cfg
        
    new_cmd = {
        "name": name,
        "template": template,
        "parameters": parameters
    }
    
    category.setdefault("commands", []).append(new_cmd)
    if save_config(config_data):
        print(f"Command '{name}' added to category '{category['name']}'!")


def edit_command(config_data):
    categories = config_data.get("categories", [])
    all_cmds = []
    
    print("\nSelect Command to Edit:")
    counter = 1
    for cat in categories:
        for cmd in cat.get("commands", []):
            print(f"{counter}. [{cat['name']}] {cmd['name']}")
            all_cmds.append(cmd)
            counter += 1
            
    if not all_cmds:
        print("No commands available to edit.")
        return
        
    try:
        selection = int(input("Enter command number: ")) - 1
        if selection < 0 or selection >= len(all_cmds):
            print("Invalid selection.")
            return
    except ValueError:
        print("Invalid selection.")
        return
        
    cmd = all_cmds[selection]
    print(f"\nEditing '{cmd['name']}'")
    
    new_name = input(f"Enter new name [{cmd['name']}]: ").strip()
    if new_name:
        cmd['name'] = new_name
        
    new_template = input(f"Enter new template [{cmd['template']}]: ").strip()
    if new_template:
        cmd['template'] = new_template
        # Rebuild parameters
        placeholders = find_placeholders(new_template)
        old_params = cmd.get("parameters", {})
        new_params = {}
        for ph in placeholders:
            old_cfg = old_params.get(ph, {})
            print(f"\nConfiguring parameter: {{{ph}}}")
            placeholder_text = input(f"Enter placeholder helper [{old_cfg.get('placeholder', '')}]: ").strip()
            regex_pattern = input(f"Enter validation regex [{old_cfg.get('regex', 'default')}]: ").strip()
            
            param_cfg = {}
            param_cfg["placeholder"] = placeholder_text if placeholder_text else old_cfg.get('placeholder', '')
            param_cfg["regex"] = regex_pattern if regex_pattern else old_cfg.get('regex', '')
            
            # Clean up empty strings
            if not param_cfg["placeholder"]:
                param_cfg.pop("placeholder", None)
            if not param_cfg["regex"]:
                param_cfg.pop("regex", None)
                
            new_params[ph] = param_cfg
        cmd['parameters'] = new_params
        
    if save_config(config_data):
        print("Command edited successfully!")


def delete_item(config_data):
    categories = config_data.get("categories", [])
    print("\nSelect what to delete:")
    print("1. Delete a Command")
    print("2. Delete a Category (and all its commands)")
    
    choice = input("Enter choice [1-2]: ").strip()
    if choice == "1":
        all_cmds = []
        counter = 1
        for cat in categories:
            for cmd in cat.get("commands", []):
                print(f"{counter}. [{cat['name']}] {cmd['name']}")
                all_cmds.append((cat, cmd))
                counter += 1
        if not all_cmds:
            print("No commands available.")
            return
        try:
            selection = int(input("Enter command number to delete: ")) - 1
            if 0 <= selection < len(all_cmds):
                cat, cmd = all_cmds[selection]
                cat["commands"].remove(cmd)
                if save_config(config_data):
                    print(f"Deleted command '{cmd['name']}'.")
            else:
                print("Invalid selection.")
        except ValueError:
            print("Invalid input.")
            
    elif choice == "2":
        for idx, cat in enumerate(categories, 1):
            print(f"{idx}. {cat['name']}")
        try:
            selection = int(input("Enter category number to delete: ")) - 1
            if 0 <= selection < len(categories):
                deleted_cat = categories.pop(selection)
                if save_config(config_data):
                    print(f"Deleted category '{deleted_cat['name']}' and all its commands.")
            else:
                print("Invalid selection.")
        except ValueError:
            print("Invalid input.")


def test_run_command_flow(config_data):
    categories = config_data.get("categories", [])
    all_cmds = []
    
    print("\nSelect Command to Test-Run:")
    counter = 1
    for cat in categories:
        for cmd in cat.get("commands", []):
            print(f"{counter}. [{cat['name']}] {cmd['name']}  (Template: {cmd['template']})")
            all_cmds.append(cmd)
            counter += 1
            
    if not all_cmds:
        print("No commands available to test.")
        return
        
    try:
        selection = int(input("Enter command number: ")) - 1
        if selection < 0 or selection >= len(all_cmds):
            print("Invalid selection.")
            return
    except ValueError:
        print("Invalid selection.")
        return
        
    cmd = all_cmds[selection]
    template = cmd['template']
    placeholders = find_placeholders(template)
    
    params_data = {}
    print(f"\n--- Testing Command: {cmd['name']} ---")
    print(f"Template: {template}")
    
    for ph in placeholders:
        param_cfg = cmd.get("parameters", {}).get(ph, {})
        regex_pattern = param_cfg.get("regex")
        placeholder_text = param_cfg.get("placeholder", f"Enter value for {ph}")
        
        while True:
            val = input(f"{ph} ({placeholder_text}): ")
            if validate_input(val, regex_pattern):
                params_data[ph] = val
                break
            else:
                p = regex_pattern if regex_pattern else r"^[a-zA-Z0-9_\-]+$"
                print(f"Error: Input '{val}' violates validation regex '{p}'. Execution blocked.")
                retry = input("Do you want to retry? [Y/n]: ").strip().lower()
                if retry == "n":
                    print("Test execution cancelled.")
                    return

    # Substitute and quote
    final_command = substitute_and_quote_command(template, params_data)
    print(f"\nFinal Constructed Shell Command:")
    print(f"  {final_command}")
    
    run_now = input("\nDo you want to execute this command now? [Y/n]: ").strip().lower()
    if run_now != "n":
        print("\nExecuting in shell...")
        code, stdout, stderr = run_command_in_shell(final_command)
        print(f"Exit Code: {code}")
        if stdout:
            print(f"--- Standard Output ---\n{stdout}")
        if stderr:
            print(f"--- Standard Error ---\n{stderr}")


# =====================================================================
# GUI / LIBADWAITA COMPANION APP MODE
# =====================================================================

if GUI_AVAILABLE:
    class TestCommandDialog(Gtk.Window):
        def __init__(self, parent, command, callback):
            super().__init__(transient_for=parent, modal=True, title=f"Test Run: {command['name']}")
            self.command = command
            self.callback = callback
            self.placeholders = find_placeholders(command['template'])
            self.entries = {}
            self.warning_labels = {}
            self.proc = None
            self.cancellable = None
            
            self.set_default_size(450, 300)
            
            # Layout
            main_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=15)
            set_uniform_margin(main_box, 15)
            self.set_child(main_box)
            
            # Title
            title_lbl = Gtk.Label(label=f"Template: {command['template']}")
            title_lbl.add_css_class("title-4")
            main_box.append(title_lbl)
            
            # Inputs box
            inputs_grid = Gtk.Grid(column_spacing=10, row_spacing=10)
            main_box.append(inputs_grid)
            
            for i, ph in enumerate(self.placeholders):
                param_cfg = command.get("parameters", {}).get(ph, {})
                placeholder_text = param_cfg.get("placeholder", f"Enter {ph}")
                
                lbl = Gtk.Label(label=f"{ph}:", xalign=0)
                inputs_grid.attach(lbl, 0, i, 1, 1)
                
                entry = Gtk.Entry(placeholder_text=placeholder_text)
                inputs_grid.attach(entry, 1, i, 1, 1)
                self.entries[ph] = entry
                
                warn_lbl = Gtk.Label(label="", xalign=0)
                warn_lbl.add_css_class("error")
                # Inline css styles via Gtk context are a bit complex, we can use css provider or class names
                # For safety, we can just use class name and manage text
                inputs_grid.attach(warn_lbl, 1, i + len(self.placeholders), 1, 1)
                self.warning_labels[ph] = warn_lbl
                
                entry.connect("changed", self.validate_all)
                
            # Action Buttons
            btn_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
            btn_box.set_halign(Gtk.Align.END)
            main_box.append(btn_box)
            
            self.run_btn = Gtk.Button(label="Execute Test")
            self.run_btn.add_css_class("suggested-action")
            self.run_btn.connect("clicked", self.on_run_clicked)
            btn_box.append(self.run_btn)
            
            self.cancel_test_btn = Gtk.Button(label="Cancel")
            self.cancel_test_btn.add_css_class("destructive-action")
            self.cancel_test_btn.connect("clicked", self.on_cancel_test_clicked)
            self.cancel_test_btn.set_visible(False)
            btn_box.append(self.cancel_test_btn)
            
            close_btn = Gtk.Button(label="Close")
            close_btn.connect("clicked", lambda b: self.destroy())
            btn_box.append(close_btn)
            
            # Terminal output log
            self.output_view = Gtk.TextView(editable=False, cursor_visible=False)
            self.output_view.set_size_request(-1, 150)
            scroll = Gtk.ScrolledWindow()
            scroll.set_child(self.output_view)
            main_box.append(scroll)
            
            self.connect("destroy", self.on_destroy)
            self.validate_all()
            
        def validate_all(self, *args):
            all_valid = True
            for ph in self.placeholders:
                entry = self.entries[ph]
                val = entry.get_text()
                param_cfg = self.command.get("parameters", {}).get(ph, {})
                pattern = param_cfg.get("regex")
                
                is_valid = validate_input(val, pattern)
                warn_lbl = self.warning_labels[ph]
                
                if not is_valid:
                    all_valid = False
                    p = pattern if pattern else r"^[a-zA-Z0-9_\-]+$"
                    warn_lbl.set_text(f"Invalid! Must match: {p}")
                else:
                    warn_lbl.set_text("")
                    
            self.run_btn.set_sensitive(all_valid and self.proc is None)
            return all_valid
            
        def on_run_clicked(self, btn):
            if not self.validate_all():
                return
            
            params_data = {ph: self.entries[ph].get_text() for ph in self.placeholders}
            final_cmd = substitute_and_quote_command(self.command.get('template', ''), params_data)

            if is_ai_command(final_cmd) or is_ai_command(self.command.get('template', '')):
                try:
                    cfg_data = self.parent.config_data if hasattr(self, "parent") and hasattr(self.parent, "config_data") else None
                    translated_cmd = translate_natural_language_to_command(final_cmd, cfg_data)
                    buffer = self.output_view.get_buffer()
                    buffer.set_text(f"AI Translated Prompt: {final_cmd}\nGenerated Command: {translated_cmd}\n")
                    final_cmd = translated_cmd
                except Exception as e:
                    buffer = self.output_view.get_buffer()
                    buffer.set_text(f"AI Translation Error: {str(e)}\n")
                    return

            if self.command.get('verified') is False:
                if GUI_AVAILABLE:
                    dlg = Adw.MessageDialog(
                        heading=f"Confirm Execution: {self.command.get('name', 'Command')}",
                        body=f"This command is unverified:\n\n{final_cmd}\n\nDo you want to execute it?"
                    )
                    dlg.add_response("cancel", "Cancel")
                    dlg.add_response("execute", "Execute")
                    
                    def on_response(dialog, response_id):
                        if response_id == "execute":
                            self._start_execution(final_cmd)
                        else:
                            buffer = self.output_view.get_buffer()
                            buffer.set_text("Execution cancelled by user confirmation dialog.\n")
                    
                    dlg.connect("response", on_response)
                    dlg.present()
                    return

            self._start_execution(final_cmd)

        def _start_execution(self, final_cmd):
            # Print construction & execution log
            buffer = self.output_view.get_buffer()
            buffer.set_text(f"Constructed Command:\n{final_cmd}\n\nRunning in shell...\n")
            
            try:
                self.cancellable = Gio.Cancellable()
                try:
                    self.proc = Gio.Subprocess.new(
                        ['setsid', 'sh', '-c', final_cmd],
                        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                    )
                except Exception:
                    self.proc = Gio.Subprocess.new(
                        ['sh', '-c', final_cmd],
                        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                    )
                
                self.run_btn.set_visible(False)
                self.cancel_test_btn.set_visible(True)
                self.cancel_test_btn.set_sensitive(True)
                
                self.proc.communicate_utf8_async(None, self.cancellable, self.on_communicate_complete)
            except Exception as e:
                buffer.insert(buffer.get_end_iter(), f"\nFailed to start execution: {str(e)}\n")
                self.proc = None
                self.cancellable = None
                self.run_btn.set_visible(True)
                self.cancel_test_btn.set_visible(False)
                self.validate_all()
                
        def on_cancel_test_clicked(self, btn):
            self.stop_running_process()
            
        def on_communicate_complete(self, proc, result):
            try:
                success, stdout, stderr = proc.communicate_utf8_finish(result)
                code = proc.get_exit_status()
                log_text = f"Exit Code: {code}\n"
                if stdout:
                    log_text += f"\n--- Output ---\n{stdout}"
                if stderr:
                    log_text += f"\n--- Error Output ---\n{stderr}"
            except GLib.GError as e:
                if e.matches(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED):
                    log_text = "\nExecution Cancelled.\n"
                else:
                    log_text = f"\nError: {e.message}\n"
            except Exception as e:
                log_text = f"\nException occurred during execution: {str(e)}\n"
                
            try:
                buffer = self.output_view.get_buffer()
                buffer.insert(buffer.get_end_iter(), log_text)
                
                # Reset UI state
                self.proc = None
                self.cancellable = None
                self.cancel_test_btn.set_visible(False)
                self.run_btn.set_visible(True)
                self.validate_all()
            except Exception:
                pass
                
        def stop_running_process(self):
            if self.cancellable and not self.cancellable.is_cancelled():
                try:
                    self.cancellable.cancel()
                except Exception:
                    pass
            if self.proc:
                try:
                    pid = int(self.proc.get_identifier())
                    import os, signal
                    os.killpg(pid, signal.SIGTERM)
                except Exception:
                    pass
                try:
                    self.proc.force_exit()
                except Exception:
                    pass
            self.proc = None
            self.cancellable = None
            
        def on_destroy(self, *args):
            self.stop_running_process()


    class CmdBarAppWindow(Adw.ApplicationWindow):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.set_title("CmdBar Management Utility")
            self.set_default_size(800, 600)
            
            # Main Layout
            main_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
            self.set_content(main_box)
            
            # Header Bar
            header = Adw.HeaderBar()
            main_box.append(header)
            
            # Add New Command Button on Header
            add_btn = Gtk.Button(label="Add Command")
            add_btn.connect("clicked", self.on_add_command_clicked)
            header.pack_start(add_btn)
            
            # Content Pane
            paned = Gtk.Paned(orientation=Gtk.Orientation.HORIZONTAL)
            paned.set_position(300)
            main_box.append(paned)
            
            # Left Pane: Command List
            left_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=5)
            set_uniform_margin(left_box, 10)
            paned.set_start_child(left_box)
            
            scroll = Gtk.ScrolledWindow()
            left_box.append(scroll)
            
            self.command_list = Gtk.ListBox()
            self.command_list.connect("row-selected", self.on_row_selected)
            scroll.set_child(self.command_list)
            
            # Right Pane: Command Editor Form
            self.right_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=15)
            set_uniform_margin(self.right_box, 15)
            self.right_box.set_sensitive(False)
            paned.set_end_child(self.right_box)
            
            # Form Fields
            self.name_entry = Gtk.Entry(placeholder_text="e.g. Git Checkout")
            self.right_box.append(Gtk.Label(label="Command Name:", xalign=0))
            self.right_box.append(self.name_entry)
            
            self.template_entry = Gtk.Entry(placeholder_text="e.g. git checkout {branch}")
            self.right_box.append(Gtk.Label(label="Command Template:", xalign=0))
            self.right_box.append(self.template_entry)
            
            # Parameters Configuration Help
            self.params_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=5)
            self.right_box.append(Gtk.Label(label="Parameters Details:", xalign=0))
            self.right_box.append(self.params_box)
            
            # Form Buttons
            btn_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
            self.right_box.append(btn_box)
            
            save_btn = Gtk.Button(label="Save Command")
            save_btn.add_css_class("suggested-action")
            save_btn.connect("clicked", self.on_save_clicked)
            btn_box.append(save_btn)
            
            self.test_btn = Gtk.Button(label="Test Command...")
            self.test_btn.connect("clicked", self.on_test_clicked)
            btn_box.append(self.test_btn)
            
            delete_btn = Gtk.Button(label="Delete Command")
            delete_btn.add_css_class("destructive-action")
            delete_btn.connect("clicked", self.on_delete_clicked)
            btn_box.append(delete_btn)
            
            # Load Data
            self.config_data = load_config()
            self.selected_cmd = None
            self.selected_category = None
            self.refresh_list()
            
        def refresh_list(self):
            # Clear list box
            while True:
                row = self.command_list.get_row_at_index(0)
                if not row:
                    break
                self.command_list.remove(row)
                
            categories = self.config_data.get("categories", [])
            for cat in categories:
                for cmd in cat.get("commands", []):
                    row = Gtk.ListBoxRow()
                    box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
                    set_uniform_margin(box, 5)
                    row.set_child(box)
                    
                    lbl = Gtk.Label(label=f"[{cat['name']}] {cmd['name']}", xalign=0)
                    box.append(lbl)
                    
                    # Store objects on the row for reference
                    row._cmd = cmd
                    row._category = cat
                    self.command_list.append(row)
                    
        def on_row_selected(self, listbox, row):
            if not row:
                self.right_box.set_sensitive(False)
                self.selected_cmd = None
                self.selected_category = None
                return
                
            self.selected_cmd = row._cmd
            self.selected_category = row._category
            self.right_box.set_sensitive(True)
            
            self.name_entry.set_text(self.selected_cmd.get("name", ""))
            self.template_entry.set_text(self.selected_cmd.get("template", ""))
            
            # Clear params box
            while True:
                child = self.params_box.get_first_child()
                if not child:
                    break
                self.params_box.remove(child)
                
            # Build params configuration helper display
            placeholders = find_placeholders(self.selected_cmd.get("template", ""))
            params = self.selected_cmd.setdefault("parameters", {})
            for ph in placeholders:
                p_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=5)
                lbl = Gtk.Label(label=f"{{{ph}}} Regex:")
                p_box.append(lbl)
                
                regex_val = params.get(ph, {}).get("regex", "")
                reg_entry = Gtk.Entry(text=regex_val, placeholder_text="default Alphanumeric")
                reg_entry._ph = ph
                reg_entry.connect("changed", self.on_param_regex_changed)
                p_box.append(reg_entry)
                
                self.params_box.append(p_box)
                
        def on_param_regex_changed(self, entry):
            ph = entry._ph
            val = entry.get_text().strip()
            params = self.selected_cmd.setdefault("parameters", {})
            if ph not in params:
                params[ph] = {}
            if val:
                params[ph]["regex"] = val
            else:
                params[ph].pop("regex", None)
                
        def on_save_clicked(self, btn):
            if not self.selected_cmd:
                return
                
            self.selected_cmd["name"] = self.name_entry.get_text()
            self.selected_cmd["template"] = self.template_entry.get_text()
            
            save_config(self.config_data)
            self.refresh_list()
            
        def on_test_clicked(self, btn):
            if not self.selected_cmd:
                return
            dialog = TestCommandDialog(self, self.selected_cmd, None)
            dialog.present()
            
        def on_delete_clicked(self, btn):
            if not self.selected_cmd or not self.selected_category:
                return
            self.selected_category["commands"].remove(self.selected_cmd)
            save_config(self.config_data)
            self.right_box.set_sensitive(False)
            self.refresh_list()
            
        def on_add_command_clicked(self, btn):
            categories = self.config_data.get("categories", [])
            if not categories:
                # Create a default category
                self.config_data["categories"] = [{"name": "Default", "commands": []}]
                categories = self.config_data["categories"]
                
            new_cmd = {
                "name": "New Shortcut",
                "template": "echo {param}",
                "parameters": {
                    "param": {
                        "placeholder": "Enter value"
                    }
                }
            }
            categories[0]["commands"].append(new_cmd)
            save_config(self.config_data)
            self.refresh_list()


    class CmdBarApp(Adw.Application):
        def __init__(self, **kwargs):
            super().__init__(application_id='com.yourdomain.CmdBar',
                             flags=Gio.ApplicationFlags.FLAGS_NONE,
                             **kwargs)
                             
        def do_activate(self):
            win = CmdBarAppWindow(application=self)
            win.present()


# =====================================================================
# MAIN ENTRY POINT
# =====================================================================

def main():
    parser = argparse.ArgumentParser(description="CmdBar Companion App")
    parser.add_argument("--cli", action="store_true", help="Force running in Command Line Interface mode")
    args = parser.parse_args()
    
    # Initialize config directory/file
    init_config()
    
    if args.cli or not GUI_AVAILABLE:
        if not GUI_AVAILABLE and not args.cli:
            print("GUI libraries (GTK4 / Libadwaita) are not available. Falling back to CLI mode.\n")
        run_cli_mode()
    else:
        app = CmdBarApp()
        sys.exit(app.run(None))


if __name__ == '__main__':
    main()
