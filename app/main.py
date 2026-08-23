import sys
import os
import re
import shlex
import json

import gi
gi.require_version('Gtk', '4.0')
gi.require_version('Adw', '1')
from gi.repository import Gtk, Adw, Gio, GLib


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

if not hasattr(Gtk.Widget, "set_margin_all"):
    Gtk.Widget.set_margin_all = set_uniform_margin

from app.config_schema import (
    load_config,
    save_config,
    resolve_command_preview,
    validate_parameter_value,
    get_config_path
)

class CmdBarApp(Adw.Application):
    def __init__(self):
        super().__init__(
            application_id="com.yourdomain.cmdbar",
            flags=Gio.ApplicationFlags.FLAGS_NONE
        )
        self.config = load_config()
        self.selected_category_idx = None
        self.selected_shortcut_idx = None
        self.sample_inputs = {}

    def do_activate(self):
        self.win = CmdBarWindow(self)
        self.win.present()


class CmdBarWindow(Adw.ApplicationWindow):
    def __init__(self, app):
        super().__init__(application=app)
        self.app = app
        self.set_title("CmdBar Companion")
        self.set_default_size(960, 640)

        # Main layouts
        self.toast_overlay = Adw.ToastOverlay()
        self.set_content(self.toast_overlay)

        # Split view
        self.split_view = Adw.NavigationSplitView()
        self.toast_overlay.set_child(self.split_view)

        # Sidebar navigation page
        self.sidebar_page = Adw.NavigationPage.new(self._create_sidebar(), "Categories")
        self.split_view.set_sidebar(self.sidebar_page)

        # Content area navigation page
        self.content_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self.content_page = Adw.NavigationPage.new(self.content_box, "Editor")
        self.split_view.set_content(self.content_page)

        # Load empty state initially
        self._show_empty_state()

    def _create_sidebar(self):
        sidebar_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        sidebar_box.set_size_request(260, -1)

        # Sidebar Header / Toolbar
        header_bar = Gtk.HeaderBar()
        header_bar.set_show_title_buttons(False)
        
        title_label = Gtk.Label(label="CmdBar Menu")
        title_label.add_css_class("title")
        title_label.add_css_class("bold")
        header_bar.set_title_widget(title_label)

        # Add Category Button
        add_cat_btn = Gtk.Button(icon_name="list-add-symbolic")
        add_cat_btn.set_tooltip_text("Add Category")
        add_cat_btn.connect("clicked", self._on_add_category_clicked)
        header_bar.pack_start(add_cat_btn)

        # Add Shortcut Button
        add_sc_btn = Gtk.Button(icon_name="document-new-symbolic")
        add_sc_btn.set_tooltip_text("Add Shortcut to Category")
        add_sc_btn.connect("clicked", self._on_add_shortcut_clicked)
        header_bar.pack_start(add_sc_btn)

        # Cron Scheduler Button
        cron_btn = Gtk.Button(icon_name="alarm-symbolic")
        cron_btn.set_tooltip_text("Cron Scheduler Visual Editor")
        cron_btn.connect("clicked", self._on_cron_scheduler_clicked)
        header_bar.pack_start(cron_btn)

        # Save Button
        save_btn = Gtk.Button(label="Save")
        save_btn.add_css_class("suggested-action")
        save_btn.connect("clicked", self._on_save_clicked)
        header_bar.pack_end(save_btn)

        sidebar_box.append(header_bar)

        # Sidebar List Box
        self.sidebar_list = Gtk.ListBox()
        self.sidebar_list.set_selection_mode(Gtk.SelectionMode.SINGLE)
        self.sidebar_list.connect("row-selected", self._on_sidebar_row_selected)

        scrolled = Gtk.ScrolledWindow()
        scrolled.set_vexpand(True)
        scrolled.set_child(self.sidebar_list)
        sidebar_box.append(scrolled)

        self._refresh_sidebar()

        return sidebar_box

    def _refresh_sidebar(self):
        # Clear sidebar list
        child = self.sidebar_list.get_first_child()
        while child is not None:
            next_child = child.get_next_sibling()
            self.sidebar_list.remove(child)
            child = next_child

        categories = self.app.config.get("categories", [])
        for c_idx, cat in enumerate(categories):
            # Category Header Row (non-clickable / info)
            cat_row = Gtk.ListBoxRow()
            cat_row.set_selectable(False)
            cat_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
            cat_box.set_margin_top(10)
            cat_box.set_margin_bottom(4)
            cat_box.set_margin_start(8)

            cat_label = Gtk.Label()
            cat_label.set_markup(f"<b>{GLib.markup_escape_text(cat['name'])}</b>")
            cat_label.set_hexpand(True)
            cat_label.set_xalign(0)
            cat_box.append(cat_label)

            # Edit Category Name Button
            edit_cat_btn = Gtk.Button(icon_name="document-properties-symbolic")
            edit_cat_btn.set_has_frame(False)
            edit_cat_btn.connect("clicked", self._on_edit_category_name, c_idx)
            cat_box.append(edit_cat_btn)

            # Delete Category Button
            del_cat_btn = Gtk.Button(icon_name="edit-delete-symbolic")
            del_cat_btn.set_has_frame(False)
            del_cat_btn.connect("clicked", self._on_delete_category, c_idx)
            cat_box.append(del_cat_btn)

            cat_row.set_child(cat_box)
            self.sidebar_list.append(cat_row)

            shortcuts = cat.get("commands", [])
            for s_idx, sc in enumerate(shortcuts):
                sc_row = Gtk.ListBoxRow()
                sc_row.c_idx = c_idx
                sc_row.s_idx = s_idx

                sc_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
                sc_box.set_margin_start(20)
                sc_box.set_margin_top(6)
                sc_box.set_margin_bottom(6)

                sc_icon = Gtk.Image.new_from_icon_name("utilities-terminal-symbolic")
                sc_box.append(sc_icon)

                sc_label = Gtk.Label(label=sc["name"])
                sc_label.set_xalign(0)
                sc_box.append(sc_label)

                sc_row.set_child(sc_box)
                self.sidebar_list.append(sc_row)

                # Keep selection if it was selected
                if self.app.selected_category_idx == c_idx and self.app.selected_shortcut_idx == s_idx:
                    self.sidebar_list.select_row(sc_row)

    def _show_empty_state(self):
        # Clear content page
        child = self.content_box.get_first_child()
        while child is not None:
            next_child = child.get_next_sibling()
            self.content_box.remove(child)
            child = next_child

        status_page = Adw.StatusPage()
        status_page.set_title("Welcome to CmdBar")
        status_page.set_description("Select a shortcut from the sidebar to edit or click '+' to create a new one.")
        status_page.set_icon_name("utilities-terminal-symbolic")
        status_page.set_vexpand(True)
        self.content_box.append(status_page)

    def _on_sidebar_row_selected(self, listbox, row):
        if row is None or not hasattr(row, "c_idx"):
            return
        
        self.app.selected_category_idx = row.c_idx
        self.app.selected_shortcut_idx = row.s_idx
        self._load_shortcut_editor()

    def _load_shortcut_editor(self):
        # Clear content page
        child = self.content_box.get_first_child()
        while child is not None:
            next_child = child.get_next_sibling()
            self.content_box.remove(child)
            child = next_child

        c_idx = self.app.selected_category_idx
        s_idx = self.app.selected_shortcut_idx
        shortcut = self.app.config["categories"][c_idx]["commands"][s_idx]

        # Top Header Bar for content area
        content_header = Gtk.HeaderBar()
        content_header.set_show_title_buttons(False)
        
        shortcut_title = Gtk.Label(label=f"Edit Shortcut: {shortcut['name']}")
        shortcut_title.add_css_class("title")
        shortcut_title.add_css_class("bold")
        content_header.set_title_widget(shortcut_title)

        # Delete Shortcut Button
        del_sc_btn = Gtk.Button(label="Delete Shortcut")
        del_sc_btn.add_css_class("destructive-action")
        del_sc_btn.connect("clicked", self._on_delete_shortcut_clicked)
        content_header.pack_end(del_sc_btn)

        self.content_box.append(content_header)

        # Scrolled window for content fields
        scrolled = Gtk.ScrolledWindow()
        scrolled.set_vexpand(True)
        self.content_box.append(scrolled)

        fields_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16)
        set_uniform_margin(fields_box, 24)
        scrolled.set_child(fields_box)

        # --- Name, Command, Mode ---
        pref_group = Adw.PreferencesGroup()
        pref_group.set_title("Shortcut Properties")
        fields_box.append(pref_group)

        # Name field
        name_row = Adw.EntryRow()
        name_row.set_title("Shortcut Name")
        name_row.set_text(shortcut["name"])
        name_row.connect("changed", self._on_name_changed)
        pref_group.add(name_row)

        # Command field
        cmd_row = Adw.EntryRow()
        cmd_row.set_title("Command Template")
        cmd_row.set_text(shortcut["command"])
        cmd_row.connect("changed", self._on_command_changed)
        pref_group.add(cmd_row)

        # Verified Switch
        verified_row = Adw.SwitchRow()
        verified_row.set_title("Verified Command")
        verified_row.set_subtitle("Bypass modal confirmation dialog when executing this command")
        verified_row.set_active(shortcut.get("verified", False))
        verified_row.connect("notify::active", self._on_verified_toggled)
        pref_group.add(verified_row)

        # Mode Selector
        mode_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        mode_box.set_margin_top(8)
        mode_box.set_margin_bottom(8)
        mode_box.set_margin_start(12)
        mode_box.set_margin_end(12)

        mode_label = Gtk.Label(label="Execution Mode")
        mode_label.set_hexpand(True)
        mode_label.set_xalign(0)
        mode_box.append(mode_label)

        string_list = Gtk.StringList.new(["Shell-Quoted Mode", "Direct-Array Mode"])
        self.mode_dropdown = Gtk.DropDown(model=string_list)
        if shortcut.get("mode", "shell-quoted") == "direct-array":
            self.mode_dropdown.set_selected(1)
        else:
            self.mode_dropdown.set_selected(0)
        self.mode_dropdown.connect("notify::selected", self._on_mode_changed)
        mode_box.append(self.mode_dropdown)

        # Wrap in a custom row style
        pref_row = Adw.PreferencesRow()
        pref_row.set_child(mode_box)
        pref_group.add(pref_row)

        # --- Parameters Section ---
        self.params_group = Adw.PreferencesGroup()
        self.params_group.set_title("Parameters Defined")
        fields_box.append(self.params_group)

        self._render_parameters_list()

        # Add Parameter Button
        add_param_btn = Gtk.Button(label="Add Parameter")
        add_param_btn.add_css_class("pill")
        add_param_btn.connect("clicked", self._on_add_parameter_clicked)
        fields_box.append(add_param_btn)

        # --- Test Inputs & Visual Dry-Run Preview ---
        self.preview_group = Adw.PreferencesGroup()
        self.preview_group.set_title("Interactive Argument Validation & Visual Dry-Run Preview")
        fields_box.append(self.preview_group)

        self._render_test_preview_section()

    def _render_parameters_list(self):
        # Clear existing parameter rows
        child = self.params_group.get_first_child()
        while child is not None:
            next_child = child.get_next_sibling()
            self.params_group.remove(child)
            child = next_child

        c_idx = self.app.selected_category_idx
        s_idx = self.app.selected_shortcut_idx
        shortcut = self.app.config["categories"][c_idx]["commands"][s_idx]
        parameters = shortcut.get("parameters", {})

        param_items = []
        if isinstance(parameters, dict):
            for p_name, p_cfg in parameters.items():
                item = dict(p_cfg) if isinstance(p_cfg, dict) else {}
                item["name"] = p_name
                param_items.append((p_name, item))
        elif isinstance(parameters, list):
            for idx, p in enumerate(parameters):
                if isinstance(p, dict):
                    p_name = p.get("name", f"param{idx}")
                    param_items.append((p_name, p))

        if len(param_items) == 0:
            empty_row = Adw.ActionRow()
            empty_row.set_title("No parameters defined.")
            empty_row.set_subtitle("Use placeholders like <host> in command template to parameterize.")
            self.params_group.add(empty_row)
            return

        for p_key, param in param_items:
            param_row = Adw.PreferencesRow()
            row_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
            row_box.set_margin_start(12)
            row_box.set_margin_end(12)
            row_box.set_margin_top(8)
            row_box.set_margin_bottom(8)
            param_row.set_child(row_box)

            # Name Input
            name_entry = Gtk.Entry()
            name_entry.set_placeholder_text("Param Name")
            name_entry.set_text(param.get("name", p_key))
            name_entry.connect("changed", self._on_param_name_changed, p_key)
            row_box.append(name_entry)

            # Regex Input
            regex_entry = Gtk.Entry()
            regex_entry.set_placeholder_text("Validation Regex (optional)")
            regex_entry.set_text(param.get("regex", ""))
            regex_entry.connect("changed", self._on_param_regex_changed, p_key)
            row_box.append(regex_entry)

            # Error Message Input
            err_entry = Gtk.Entry()
            err_entry.set_placeholder_text("Custom Error Message")
            err_entry.set_text(param.get("error_message", ""))
            err_entry.connect("changed", self._on_param_err_msg_changed, p_key)
            row_box.append(err_entry)

            # Secure Checkbox
            secure_check = Gtk.CheckButton(label="Secure")
            secure_check.set_active(param.get("secure", False))
            secure_check.connect("toggled", self._on_param_secure_toggled, p_key)
            row_box.append(secure_check)

            # Delete Button
            del_btn = Gtk.Button(icon_name="edit-delete-symbolic")
            del_btn.add_css_class("destructive-action")
            del_btn.connect("clicked", self._on_delete_parameter_clicked, p_key)
            row_box.append(del_btn)

            self.params_group.add(param_row)

    def _render_test_preview_section(self):
        # Clear existing preview rows
        child = self.preview_group.get_first_child()
        while child is not None:
            next_child = child.get_next_sibling()
            self.preview_group.remove(child)
            child = next_child

        c_idx = self.app.selected_category_idx
        s_idx = self.app.selected_shortcut_idx
        shortcut = self.app.config["categories"][c_idx]["commands"][s_idx]
        parameters = shortcut.get("parameters", {})

        # Inputs list
        self.app.sample_inputs = {}
        param_items = []
        if isinstance(parameters, dict):
            for p_name, p_cfg in parameters.items():
                item = dict(p_cfg) if isinstance(p_cfg, dict) else {}
                item["name"] = p_name
                param_items.append(item)
        elif isinstance(parameters, list):
            param_items = parameters

        for param in param_items:
            p_name = param.get("name")
            if not p_name:
                continue
            
            input_row = Adw.EntryRow()
            input_row.set_title(f"Sample '{p_name}' value")
            if param.get("secure", False):
                input_row.set_visibility(False)
            input_row.connect("changed", self._on_sample_input_changed, p_name)
            self.preview_group.add(input_row)
            self.app.sample_inputs[p_name] = input_row

        # Visual Preview Box
        preview_row = Adw.PreferencesRow()
        self.preview_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        self.preview_box.set_margin_start(16)
        self.preview_box.set_margin_end(16)
        self.preview_box.set_margin_top(12)
        self.preview_box.set_margin_bottom(12)
        preview_row.set_child(self.preview_box)

        preview_header = Gtk.Label()
        preview_header.set_markup("<b>Visual Dry-Run Preview</b> (Never executed on host):")
        preview_header.set_xalign(0)
        self.preview_box.append(preview_header)

        self.preview_label = Gtk.Label()
        self.preview_label.set_xalign(0)
        self.preview_label.set_selectable(True)
        # Styled with a dark background and monospace green text
        self.preview_label.add_css_class("card")
        self.preview_label.set_margin_top(4)
        self.preview_box.append(self.preview_label)

        self.preview_group.add(preview_row)
        self._update_live_preview()

    def _update_live_preview(self):
        c_idx = self.app.selected_category_idx
        s_idx = self.app.selected_shortcut_idx
        shortcut = self.app.config["categories"][c_idx]["commands"][s_idx]

        # Collect sample inputs
        vals = {}
        for k, entry_row in self.app.sample_inputs.items():
            vals[k] = entry_row.get_text().strip()

        # Resolve command
        command_template = shortcut["command"]
        mode = shortcut.get("mode", "shell-quoted")
        parameters_schema = shortcut.get("parameters", [])

        resolved, errors = resolve_command_preview(
            command_template,
            mode,
            vals,
            parameters_schema
        )

        # Highlight input error borders if any
        param_items = []
        if isinstance(parameters_schema, dict):
            for p_name, p_cfg in parameters_schema.items():
                item = dict(p_cfg) if isinstance(p_cfg, dict) else {}
                item["name"] = p_name
                param_items.append(item)
        elif isinstance(parameters_schema, list):
            param_items = parameters_schema

        for param in param_items:
            p_name = param.get("name")
            if p_name and p_name in self.app.sample_inputs:
                row = self.app.sample_inputs[p_name]
                if p_name in errors:
                    row.add_css_class("error")
                    row.set_subtitle(errors[p_name])
                else:
                    row.remove_css_class("error")
                    row.set_subtitle("")

        # Render preview label with Pango Markup
        if errors:
            err_details = "\n".join(f"- {k}: {v}" for k, v in errors.items())
            preview_markup = f"<span face='monospace' foreground='#ff5b5b'><b>[Validation Error] Blocked Execution!</b>\n{GLib.markup_escape_text(err_details)}</span>"
        else:
            preview_markup = f"<span face='monospace' foreground='#8ff0a4'><b>{GLib.markup_escape_text(resolved)}</b></span>"

        self.preview_label.set_markup(preview_markup)

    # --- Change Handlers ---
    def _on_name_changed(self, row):
        c_idx = self.app.selected_category_idx
        s_idx = self.app.selected_shortcut_idx
        self.app.config["categories"][c_idx]["commands"][s_idx]["name"] = row.get_text().strip()
        self._refresh_sidebar()

    def _on_command_changed(self, row):
        c_idx = self.app.selected_category_idx
        s_idx = self.app.selected_shortcut_idx
        self.app.config["categories"][c_idx]["commands"][s_idx]["command"] = row.get_text().strip()
        self._update_live_preview()

    def _on_mode_changed(self, dropdown, pspec):
        c_idx = self.app.selected_category_idx
        s_idx = self.app.selected_shortcut_idx
        selected = dropdown.get_selected()
        mode_str = "shell-quoted" if selected == 0 else "direct-array"
        self.app.config["categories"][c_idx]["commands"][s_idx]["mode"] = mode_str
        self._update_live_preview()

    def _on_sample_input_changed(self, row, param_name):
        self._update_live_preview()

    def _on_param_name_changed(self, entry, p_key):
        c_idx = self.app.selected_category_idx
        s_idx = self.app.selected_shortcut_idx
        params = self.app.config["categories"][c_idx]["commands"][s_idx].get("parameters")
        new_name = entry.get_text().strip()
        if isinstance(params, dict):
            if p_key in params and new_name and p_key != new_name:
                p_cfg = params.pop(p_key)
                params[new_name] = p_cfg
        elif isinstance(params, list) and isinstance(p_key, int) and 0 <= p_key < len(params):
            params[p_key]["name"] = new_name
        self._render_test_preview_section()

    def _on_param_regex_changed(self, entry, p_key):
        c_idx = self.app.selected_category_idx
        s_idx = self.app.selected_shortcut_idx
        params = self.app.config["categories"][c_idx]["commands"][s_idx].get("parameters")
        val = entry.get_text().strip()
        if isinstance(params, dict) and p_key in params:
            params[p_key]["regex"] = val
        elif isinstance(params, list) and isinstance(p_key, int) and 0 <= p_key < len(params):
            params[p_key]["regex"] = val
        self._update_live_preview()

    def _on_param_err_msg_changed(self, entry, p_key):
        c_idx = self.app.selected_category_idx
        s_idx = self.app.selected_shortcut_idx
        params = self.app.config["categories"][c_idx]["commands"][s_idx].get("parameters")
        val = entry.get_text().strip()
        if isinstance(params, dict) and p_key in params:
            params[p_key]["error_message"] = val
        elif isinstance(params, list) and isinstance(p_key, int) and 0 <= p_key < len(params):
            params[p_key]["error_message"] = val
        self._update_live_preview()

    def _on_verified_toggled(self, row, pspec):
        c_idx = self.app.selected_category_idx
        s_idx = self.app.selected_shortcut_idx
        self.app.config["categories"][c_idx]["commands"][s_idx]["verified"] = row.get_active()

    def _on_param_secure_toggled(self, check, p_key):
        c_idx = self.app.selected_category_idx
        s_idx = self.app.selected_shortcut_idx
        params = self.app.config["categories"][c_idx]["commands"][s_idx].get("parameters")
        is_active = check.get_active()
        if isinstance(params, dict) and p_key in params:
            params[p_key]["secure"] = is_active
        elif isinstance(params, list) and isinstance(p_key, int) and 0 <= p_key < len(params):
            params[p_key]["secure"] = is_active
        self._render_test_preview_section()

    # --- Button & Menu Click Handlers ---
    def _on_add_category_clicked(self, btn):
        # Create small dialog to input category name or use default name
        self._prompt_category_name()

    def _prompt_category_name(self):
        # Simply append a default and let user rename
        new_cat = {
            "name": f"New Category {len(self.app.config.get('categories', [])) + 1}",
            "commands": []
        }
        self.app.config.get("categories", []).append(new_cat)
        self._refresh_sidebar()
        self._show_toast("Added New Category!")

    def _on_edit_category_name(self, btn, c_idx):
        # Simple popup or entry edit
        cat = self.app.config["categories"][c_idx]
        
        dialog = Adw.MessageDialog(transient_for=self, heading="Rename Category")
        
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        entry = Gtk.Entry()
        entry.set_text(cat["name"])
        box.append(entry)
        dialog.set_extra_child(box)

        dialog.add_response("cancel", "Cancel")
        dialog.add_response("save", "Save")
        dialog.set_response_appearance("save", Adw.ResponseAppearance.SUGGESTED)

        def on_response(dlg, response_id):
            if response_id == "save":
                new_name = entry.get_text().strip()
                if new_name:
                    self.app.config["categories"][c_idx]["name"] = new_name
                    self._refresh_sidebar()
            dlg.destroy()

        dialog.connect("response", on_response)
        dialog.present()

    def _on_delete_category(self, btn, c_idx):
        cat = self.app.config["categories"][c_idx]
        dialog = Adw.MessageDialog(
            transient_for=self,
            heading="Delete Category?",
            body=f"Are you sure you want to delete category '{cat['name']}' and all its commands?"
        )
        dialog.add_response("cancel", "Cancel")
        dialog.add_response("delete", "Delete")
        dialog.set_response_appearance("delete", Adw.ResponseAppearance.DESTRUCTIVE)

        def on_response(dlg, response_id):
            if response_id == "delete":
                self.app.config["categories"].pop(c_idx)
                self.app.selected_category_idx = None
                self.app.selected_shortcut_idx = None
                self._refresh_sidebar()
                self._show_empty_state()
                self._show_toast("Category deleted.")
            dlg.destroy()

        dialog.connect("response", on_response)
        dialog.present()

    def _on_add_shortcut_clicked(self, btn):
        categories = self.app.config.get("categories", [])
        if len(categories) == 0:
            self._show_toast("Please add a Category first!")
            return

        c_idx = self.app.selected_category_idx if self.app.selected_category_idx is not None else 0
        cat = categories[c_idx]

        new_sc = {
            "name": f"New Shortcut {len(cat.get('commands', [])) + 1}",
            "command": "echo \"Hello\" <arg>",
            "mode": "shell-quoted",
            "parameters": {
                "arg": {
                    "regex": "^[a-zA-Z0-9_]+$",
                    "error_message": "Alphanumeric only!"
                }
            }
        }
        cat.get("commands", []).append(new_sc)
        self.app.selected_category_idx = c_idx
        self.app.selected_shortcut_idx = len(cat["commands"]) - 1
        self._refresh_sidebar()
        self._load_shortcut_editor()
        self._show_toast("Added New Shortcut!")

    def _on_delete_shortcut_clicked(self, btn):
        c_idx = self.app.selected_category_idx
        s_idx = self.app.selected_shortcut_idx
        if c_idx is None or s_idx is None:
            return

        self.app.config["categories"][c_idx]["commands"].pop(s_idx)
        self.app.selected_category_idx = None
        self.app.selected_shortcut_idx = None
        self._refresh_sidebar()
        self._show_empty_state()
        self._show_toast("Shortcut deleted.")

    def _on_add_parameter_clicked(self, btn):
        c_idx = self.app.selected_category_idx
        s_idx = self.app.selected_shortcut_idx
        if c_idx is None or s_idx is None:
            return

        cmd = self.app.config['categories'][c_idx]['commands'][s_idx]
        params = cmd.get("parameters")
        if not isinstance(params, dict):
            params = {}
            cmd["parameters"] = params
        new_param_name = f"param{len(params) + 1}"
        params[new_param_name] = {
            "regex": "",
            "error_message": ""
        }
        self._render_parameters_list()
        self._render_test_preview_section()

    def _on_delete_parameter_clicked(self, btn, p_key):
        c_idx = self.app.selected_category_idx
        s_idx = self.app.selected_shortcut_idx
        if c_idx is None or s_idx is None:
            return

        params = self.app.config["categories"][c_idx]["commands"][s_idx].get("parameters")
        if isinstance(params, dict):
            params.pop(p_key, None)
        elif isinstance(params, list) and isinstance(p_key, int) and 0 <= p_key < len(params):
            params.pop(p_key)
        self._render_parameters_list()
        self._render_test_preview_section()

    def _on_save_clicked(self, btn):
        try:
            save_config(self.app.config)
            self._show_toast("Configuration Saved! GNOME Status Menu reloaded automatically.")
        except Exception as e:
            self._show_toast(f"Error saving: {e}")

    def _on_cron_scheduler_clicked(self, btn):
        self._load_cron_scheduler_view()

    def _load_cron_scheduler_view(self):
        from app.cron_scheduler import CronScheduler, get_timezone_object

        # Clear content page
        child = self.content_box.get_first_child()
        while child is not None:
            next_child = child.get_next_sibling()
            self.content_box.remove(child)
            child = next_child

        # Content header
        header = Gtk.HeaderBar()
        header.set_show_title_buttons(False)

        title = Gtk.Label(label="Cron Schedule Editor")
        title.add_css_class("title")
        title.add_css_class("bold")
        header.set_title_widget(title)

        add_btn = Gtk.Button(label="Add Scheduled Job")
        add_btn.add_css_class("suggested-action")
        add_btn.connect("clicked", lambda b: self._open_cron_job_dialog())
        header.pack_start(add_btn)

        run_due_btn = Gtk.Button(label="Run Due Jobs Now")
        run_due_btn.connect("clicked", self._on_run_due_jobs_clicked)
        header.pack_end(run_due_btn)

        self.content_box.append(header)

        scrolled = Gtk.ScrolledWindow()
        scrolled.set_vexpand(True)
        self.content_box.append(scrolled)

        fields_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16)
        set_uniform_margin(fields_box, 24)
        scrolled.set_child(fields_box)

        pref_group = Adw.PreferencesGroup()
        pref_group.set_title("Configured Cron Jobs")
        pref_group.set_description("Schedule commands like cron with overlap prevention, error handling, email reports, and timezone support.")
        fields_box.append(pref_group)

        cron_jobs = self.app.config.get("cron_jobs", [])
        if not cron_jobs:
            empty_lbl = Gtk.Label(label="No scheduled jobs configured. Click 'Add Scheduled Job' to create one.")
            empty_lbl.set_margin_top(20)
            empty_lbl.set_margin_bottom(20)
            empty_lbl.add_css_class("dim-label")
            pref_group.add(empty_lbl)
            return

        for idx, job_data in enumerate(cron_jobs):
            row = Adw.ActionRow()
            row.set_title(job_data.get("name", "Unnamed Job"))

            cmd_str = job_data.get("command", "")
            cron_expr = job_data.get("cron_expression") or job_data.get("schedule", "* * * * *")
            tz_str = job_data.get("timezone", "UTC")
            overlap_prev = "Overlap Prev: ON" if job_data.get("overlap_prevention", True) else "Overlap Prev: OFF"
            email_cfg = job_data.get("email_reports") or {}
            email_str = f"Email: {email_cfg.get('recipient')}" if email_cfg.get("enabled") else "Email: Off"
            last_status = job_data.get("last_status", "never").upper()
            last_run = job_data.get("last_run", "Never")

            row.set_subtitle(f"Command: {cmd_str}\nSchedule: {cron_expr} ({tz_str}) | {overlap_prev} | {email_str}\nLast Run: {last_run} | Status: {last_status}")

            # Enabled Switch
            sw = Gtk.Switch()
            sw.set_valign(Gtk.Align.CENTER)
            sw.set_active(job_data.get("enabled", True))
            sw.connect("notify::active", self._on_cron_job_enabled_toggled, idx)
            row.add_suffix(sw)

            # Run Now Button
            run_btn = Gtk.Button(icon_name="media-playback-start-symbolic")
            run_btn.set_valign(Gtk.Align.CENTER)
            run_btn.set_tooltip_text("Run Job Now")
            run_btn.connect("clicked", self._on_run_cron_job_now, idx)
            row.add_suffix(run_btn)

            # Edit Button
            edit_btn = Gtk.Button(icon_name="document-edit-symbolic")
            edit_btn.set_valign(Gtk.Align.CENTER)
            edit_btn.set_tooltip_text("Edit Job")
            edit_btn.connect("clicked", lambda b, j_idx=idx: self._open_cron_job_dialog(self.app.config["cron_jobs"][j_idx], j_idx))
            row.add_suffix(edit_btn)

            # Delete Button
            del_btn = Gtk.Button(icon_name="user-trash-symbolic")
            del_btn.set_valign(Gtk.Align.CENTER)
            del_btn.add_css_class("destructive-action")
            del_btn.set_tooltip_text("Delete Job")
            del_btn.connect("clicked", self._on_delete_cron_job_clicked, idx)
            row.add_suffix(del_btn)

            pref_group.add(row)

    def _on_cron_job_enabled_toggled(self, sw, pspec, job_idx):
        if 0 <= job_idx < len(self.app.config.get("cron_jobs", [])):
            self.app.config["cron_jobs"][job_idx]["enabled"] = sw.get_active()

    def _on_run_cron_job_now(self, btn, job_idx):
        from app.cron_scheduler import CronScheduler, CronJob
        if 0 <= job_idx < len(self.app.config.get("cron_jobs", [])):
            job_data = self.app.config["cron_jobs"][job_idx]
            job = CronJob.from_dict(job_data)
            scheduler = CronScheduler()
            res = scheduler.run_job(job, force=True)
            self.app.config["cron_jobs"][job_idx] = job.to_dict()
            save_config(self.app.config)
            self._load_cron_scheduler_view()
            self._show_toast(f"Executed '{job.name}': Status={res['status']}, ExitCode={res['exit_code']}")

    def _on_run_due_jobs_clicked(self, btn):
        from app.cron_scheduler import CronScheduler
        scheduler = CronScheduler()
        scheduler.load_from_config(self.app.config)
        results = scheduler.check_and_run_due_jobs()
        self.app.config = scheduler.save_to_config(self.app.config)
        save_config(self.app.config)
        self._load_cron_scheduler_view()
        self._show_toast(f"Evaluated cron jobs: {len(results)} job(s) executed.")

    def _on_delete_cron_job_clicked(self, btn, job_idx):
        if 0 <= job_idx < len(self.app.config.get("cron_jobs", [])):
            removed = self.app.config["cron_jobs"].pop(job_idx)
            save_config(self.app.config)
            self._load_cron_scheduler_view()
            self._show_toast(f"Deleted cron job '{removed.get('name', '')}'")

    def _open_cron_job_dialog(self, job=None, job_idx=None):
        from app.cron_scheduler import parse_cron_expression, get_next_runs, CronJob
        import time

        dialog = Adw.MessageDialog(
            transient_for=self,
            heading="Edit Cron Job" if job else "Add Scheduled Cron Job"
        )

        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        set_uniform_margin(box, 12)

        # Name Entry
        name_lbl = Gtk.Label(label="Job Name:", xalign=0)
        box.append(name_lbl)
        name_entry = Gtk.Entry(placeholder_text="e.g., Nightly Database Backup")
        name_entry.set_text(job.get("name", "") if job else "")
        box.append(name_entry)

        # Command Entry
        cmd_lbl = Gtk.Label(label="Command to Execute:", xalign=0)
        box.append(cmd_lbl)
        cmd_entry = Gtk.Entry(placeholder_text="e.g., pg_dump mydb > /backup.sql")
        cmd_entry.set_text(job.get("command", "") if job else "")
        box.append(cmd_entry)

        # Presets Dropdown
        preset_lbl = Gtk.Label(label="Schedule Presets:", xalign=0)
        box.append(preset_lbl)
        preset_list = Gtk.StringList.new([
            "Custom Cron Expression",
            "Every Minute (* * * * *)",
            "Every 5 Minutes (*/5 * * * *)",
            "Every 15 Minutes (*/15 * * * *)",
            "Every Hour (@hourly)",
            "Daily at Midnight (@daily)",
            "Weekly on Sunday (@weekly)"
        ])
        preset_dropdown = Gtk.DropDown(model=preset_list)
        box.append(preset_dropdown)

        # Cron Expression Entry
        cron_lbl = Gtk.Label(label="Cron Expression (5 fields):", xalign=0)
        box.append(cron_lbl)
        cron_entry = Gtk.Entry(placeholder_text="e.g. */5 * * * * or @daily")
        cron_entry.set_text(job.get("cron_expression", "*/5 * * * *") if job else "*/5 * * * *")
        box.append(cron_entry)

        # Preview / Next Runs Label
        preview_lbl = Gtk.Label(xalign=0)
        preview_lbl.set_markup("<span size='small' foreground='#888'>Schedule preview...</span>")
        box.append(preview_lbl)

        # Timezone Entry
        tz_lbl = Gtk.Label(label="Timezone (e.g., UTC, Local, America/New_York):", xalign=0)
        box.append(tz_lbl)
        tz_entry = Gtk.Entry(placeholder_text="UTC")
        tz_entry.set_text(job.get("timezone", "UTC") if job else "UTC")
        box.append(tz_entry)

        # Overlap Prevention Checkbox
        overlap_check = Gtk.CheckButton(label="Enable Overlap Prevention (prevent concurrent execution)")
        overlap_check.set_active(job.get("overlap_prevention", True) if job else True)
        box.append(overlap_check)

        # Email Reports Expander / Section
        email_cfg = (job.get("email_reports") if job else {}) or {}
        email_check = Gtk.CheckButton(label="Enable Email Execution Reports")
        email_check.set_active(email_cfg.get("enabled", False))
        box.append(email_check)

        recipient_entry = Gtk.Entry(placeholder_text="Recipient Email (e.g. devops@example.com)")
        recipient_entry.set_text(email_cfg.get("recipient", ""))
        box.append(recipient_entry)

        on_fail_check = Gtk.CheckButton(label="Send report on failure")
        on_fail_check.set_active(email_cfg.get("on_failure", True))
        box.append(on_fail_check)

        on_succ_check = Gtk.CheckButton(label="Send report on success")
        on_succ_check.set_active(email_cfg.get("on_success", False))
        box.append(on_succ_check)

        def update_cron_preview(*args):
            expr = cron_entry.get_text().strip()
            tz_str = tz_entry.get_text().strip() or "UTC"
            try:
                parse_cron_expression(expr)
                next_runs = get_next_runs(expr, tz_str=tz_str, count=3)
                runs_str = ", ".join(r.strftime("%Y-%m-%d %H:%M %Z") for r in next_runs) if next_runs else "None"
                preview_lbl.set_markup(f"<span size='small' foreground='#8ff0a4'><b>Valid Cron Schedule!</b> Next runs: {GLib.markup_escape_text(runs_str)}</span>")
            except Exception as e:
                preview_lbl.set_markup(f"<span size='small' foreground='#ff5b5b'><b>Invalid Expression:</b> {GLib.markup_escape_text(str(e))}</span>")

        cron_entry.connect("changed", update_cron_preview)
        tz_entry.connect("changed", update_cron_preview)

        def on_preset_changed(dropdown, pspec):
            sel = dropdown.get_selected()
            presets = ["", "* * * * *", "*/5 * * * *", "*/15 * * * *", "@hourly", "@daily", "@weekly"]
            if 0 < sel < len(presets):
                cron_entry.set_text(presets[sel])

        preset_dropdown.connect("notify::selected", on_preset_changed)
        update_cron_preview()

        dialog.set_extra_child(box)
        dialog.add_response("cancel", "Cancel")
        dialog.add_response("save", "Save Job")
        dialog.set_response_appearance("save", Adw.ResponseAppearance.SUGGESTED)

        def on_response(dlg, response_id):
            if response_id == "save":
                new_job_data = {
                    "id": job.get("id") if job else f"job-{int(time.time()*1000)}",
                    "name": name_entry.get_text().strip() or "Unnamed Job",
                    "command": cmd_entry.get_text().strip(),
                    "cron_expression": cron_entry.get_text().strip() or "* * * * *",
                    "timezone": tz_entry.get_text().strip() or "UTC",
                    "overlap_prevention": overlap_check.get_active(),
                    "email_reports": {
                        "enabled": email_check.get_active(),
                        "recipient": recipient_entry.get_text().strip(),
                        "on_failure": on_fail_check.get_active(),
                        "on_success": on_succ_check.get_active()
                    },
                    "enabled": job.get("enabled", True) if job else True,
                    "last_run": job.get("last_run") if job else None,
                    "last_status": job.get("last_status", "never") if job else "never",
                    "last_output": job.get("last_output") if job else None,
                    "history": job.get("history", []) if job else []
                }

                cron_jobs_list = self.app.config.setdefault("cron_jobs", [])
                if job_idx is not None and 0 <= job_idx < len(cron_jobs_list):
                    cron_jobs_list[job_idx] = new_job_data
                else:
                    cron_jobs_list.append(new_job_data)

                save_config(self.app.config)
                self._load_cron_scheduler_view()
                self._show_toast("Cron job saved successfully!")

            dlg.destroy()

        dialog.connect("response", on_response)
        dialog.present()

    def _show_toast(self, text):
        toast = Adw.Toast.new(text)
        self.toast_overlay.add_toast(toast)


if __name__ == "__main__":
    # Handle headless environments with a beautiful CLI summary
    if not os.environ.get("DISPLAY") and not os.environ.get("WAYLAND_DISPLAY"):
        print("="*60)
        print("CmdBar Companion Application (Headless Mode)")
        print("="*60)
        print("Note: The Gtk/Libadwaita GUI is disabled because no display server (X11/Wayland) was found.")
        print(f"Config Path: {get_config_path()}")
        print("\nCurrent system shortcuts configuration:")
        
        config = load_config()
        for cat in config.get("categories", []):
            print(f"\n[Category: {cat['name']}]")
            for sc in cat.get("commands", []):
                print(f"  - Shortcut: {sc['name']}")
                print(f"    Command : {sc['command']}")
                print(f"    Mode    : {sc['mode']}")
                if sc.get("parameters"):
                    print("    Params  :")
                    params = sc["parameters"]
                    if isinstance(params, dict):
                        for p_name, p_cfg in params.items():
                            print(f"      * {p_name} (regex: '{p_cfg.get('regex', '')}')")
                    elif isinstance(params, list):
                        for p in params:
                            print(f"      * {p.get('name')} (regex: '{p.get('regex', '')}')")
        print("="*60)
        sys.exit(0)

    app = CmdBarApp()
    sys.exit(app.run(sys.argv))
