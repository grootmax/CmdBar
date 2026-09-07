"""
Template Library Manager for CmdBar.
Provides template discovery, validation, import, export, and community sharing functionality.
"""

import os
import json
import urllib.request
import urllib.error


def get_templates_dir():
    """
    Returns the absolute path to the pre-built templates directory.
    """
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    return os.path.join(base_dir, "templates")


def validate_template(item):
    """
    Validates and normalizes a template dictionary against schema:
    { name, description, command, category, icon }
    """
    if not isinstance(item, dict):
        raise ValueError("Template item must be a JSON object (dict)")

    name = item.get("name")
    if not name or not isinstance(name, str) or not name.strip():
        raise ValueError("Template item missing required field: name")

    command = item.get("command") or item.get("template")
    if not command or not isinstance(command, str) or not command.strip():
        raise ValueError(f"Template '{name}' missing required field: command")

    description = item.get("description", f"Command template for {name}")
    category = item.get("category", "General")
    icon = item.get("icon", "utilities-terminal-symbolic")
    parameters = item.get("parameters", {})
    mode = item.get("mode", "shell-quoted")

    normalized = {
        "name": name.strip(),
        "description": description.strip(),
        "command": command.strip(),
        "template": command.strip(),
        "category": category.strip(),
        "icon": icon.strip(),
        "mode": mode,
        "parameters": parameters,
    }

    if "author" in item:
        normalized["author"] = item["author"]
    if "tags" in item:
        normalized["tags"] = item["tags"]

    return normalized


def load_template_file(file_path):
    """
    Loads templates from a local JSON file path or remote URL.
    Returns a list of validated template dicts.
    """
    if file_path.startswith("http://") or file_path.startswith("https://"):
        req = urllib.request.Request(
            file_path, headers={"User-Agent": "CmdBar-TemplateManager/1.0"}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            content = resp.read().decode("utf-8")
        data = json.loads(content)
    else:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)

    raw_items = data if isinstance(data, list) else [data]
    validated = []
    for raw in raw_items:
        try:
            validated.append(validate_template(raw))
        except ValueError as e:
            continue
    return validated


def load_all_templates(templates_dir=None):
    """
    Scans the templates directory and loads all valid command templates.
    """
    if templates_dir is None:
        templates_dir = get_templates_dir()

    templates = []
    if not os.path.exists(templates_dir):
        return templates

    for filename in sorted(os.listdir(templates_dir)):
        if filename.endswith(".json") and filename != "schema.json":
            file_path = os.path.join(templates_dir, filename)
            try:
                items = load_template_file(file_path)
                templates.extend(items)
            except Exception:
                continue

    return templates


def import_templates_to_config(config, templates):
    """
    Imports a list of template dicts into a CmdBar configuration object.
    Appends commands to matching category or creates new category if needed.
    Returns (updated_config, count_added).
    """
    if not isinstance(config, dict):
        config = {"categories": []}

    categories = config.setdefault("categories", [])
    if not isinstance(templates, list):
        templates = [templates]

    count_added = 0
    for tmpl in templates:
        validated = validate_template(tmpl)
        cat_name = validated["category"]

        # Find existing category
        target_cat = None
        for cat in categories:
            if cat.get("name", "").lower() == cat_name.lower():
                target_cat = cat
                break

        if target_cat is None:
            target_cat = {"name": cat_name, "commands": []}
            categories.append(target_cat)

        cmds = target_cat.setdefault("commands", [])

        # Check for duplicate
        exists = any(
            c.get("name") == validated["name"]
            or (c.get("command") or c.get("template")) == validated["command"]
            for c in cmds
        )

        if not exists:
            cmd_entry = {
                "name": validated["name"],
                "command": validated["command"],
                "template": validated["template"],
                "description": validated["description"],
                "icon": validated["icon"],
                "mode": validated.get("mode", "shell-quoted"),
                "parameters": validated.get("parameters", {}),
            }
            cmds.append(cmd_entry)
            count_added += 1

    return config, count_added


def export_command_as_template(command_obj, category_name="Custom", description=None, author=None):
    """
    Exports a single command dict to a template schema dict.
    """
    cmd_text = command_obj.get("command") or command_obj.get("template", "")
    tmpl = {
        "name": command_obj.get("name", "Custom Command"),
        "description": description or command_obj.get("description", f"Template for {command_obj.get('name')}"),
        "command": cmd_text,
        "template": cmd_text,
        "category": category_name or command_obj.get("category", "Custom"),
        "icon": command_obj.get("icon", "utilities-terminal-symbolic"),
        "mode": command_obj.get("mode", "shell-quoted"),
        "parameters": command_obj.get("parameters", {}),
    }
    if author:
        tmpl["author"] = author
    return validate_template(tmpl)


def export_templates_to_file(templates, output_path, author=None):
    """
    Exports a template or list of templates to a JSON file.
    """
    if not isinstance(templates, list):
        templates = [templates]

    exported = []
    for tmpl in templates:
        valid = validate_template(tmpl)
        if author and "author" not in valid:
            valid["author"] = author
        exported.append(valid)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(exported, f, indent=2)

    return output_path
