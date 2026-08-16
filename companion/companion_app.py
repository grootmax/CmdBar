#!/usr/bin/env python3
import sys
import os
import json
import re
import shlex
import subprocess
import argparse

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
        with open(config_path, "w") as f:
            json.dump(default_config, f, indent=4)
    return config_path


def load_config():
    """
    Loads and parses the configuration file.
    """
    config_path = init_config()
    try:
        with open(config_path, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"Error loading configuration: {e}", file=sys.stderr)
        return {"categories": []}


def save_config(config_data):
    """
    Saves the configuration to the file safely.
    """
    config_path = get_config_path()
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
    Extracts all placeholders from command template. E.g. {branch} -> ['branch']
    """
    return re.findall(r"\{([^}]+)\}", template)


def substitute_and_quote_command(template, params_data):
    """
    Replaces placeholders in template with shell-quoted parameter values.
    """
    final_cmd = template
    placeholders = find_placeholders(template)
    for ph in placeholders:
        if ph in params_data:
            val = params_data[ph]
            quoted_val = shlex.quote(val)
            final_cmd = final_cmd.replace(f"{{{ph}}}", quoted_val)
    return final_cmd


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
        print("7. Exit")
        
        choice = input("\nEnter choice [1-7]: ").strip()
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
            print("Goodbye!")
            break
        else:
            print("Invalid choice, please try again.")


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
            main_box.set_margin_top(15)
            main_box.set_margin_bottom(15)
            main_box.set_margin_start(15)
            main_box.set_margin_end(15)
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
            final_cmd = substitute_and_quote_command(self.command['template'], params_data)
            
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
            left_box.set_margin_all(10)
            paned.set_start_child(left_box)
            
            scroll = Gtk.ScrolledWindow()
            left_box.append(scroll)
            
            self.command_list = Gtk.ListBox()
            self.command_list.connect("row-selected", self.on_row_selected)
            scroll.set_child(self.command_list)
            
            # Right Pane: Command Editor Form
            self.right_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=15)
            self.right_box.set_margin_all(15)
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
                    box.set_margin_all(5)
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
