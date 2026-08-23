"""
Workspace-Specific Configuration Management module for CmdBar (Python).
Provides auto-detection from CWD, git repo integration, project templates,
smooth switching, and config merging.
"""

import os
import json

WORKSPACE_FILE_NAMES = [".cmdbar.json", os.path.join(".cmdbar", "config.json")]

PROJECT_TEMPLATES = {
    "node": {
        "name": "Node.js Project",
        "categories": [
            {
                "name": "Node.js",
                "commands": [
                    {"name": "NPM Install", "command": "npm install"},
                    {"name": "NPM Test", "command": "npm test"},
                    {"name": "NPM Start", "command": "npm start"},
                    {"name": "NPM Build", "command": "npm run build"},
                    {"name": "NPM Lint", "command": "npm run lint"},
                ],
            }
        ],
    },
    "python": {
        "name": "Python Project",
        "categories": [
            {
                "name": "Python",
                "commands": [
                    {"name": "Run Tests", "command": "pytest"},
                    {"name": "Run Main", "command": "python main.py"},
                    {"name": "Install Requirements", "command": "pip install -r requirements.txt"},
                    {"name": "Ruff Check", "command": "ruff check ."},
                ],
            }
        ],
    },
    "rust": {
        "name": "Rust Project",
        "categories": [
            {
                "name": "Rust",
                "commands": [
                    {"name": "Cargo Build", "command": "cargo build"},
                    {"name": "Cargo Test", "command": "cargo test"},
                    {"name": "Cargo Run", "command": "cargo run"},
                    {"name": "Cargo Check", "command": "cargo check"},
                ],
            }
        ],
    },
    "go": {
        "name": "Go Project",
        "categories": [
            {
                "name": "Go",
                "commands": [
                    {"name": "Go Build", "command": "go build ."},
                    {"name": "Go Test", "command": "go test ./..."},
                    {"name": "Go Run", "command": "go run ."},
                ],
            }
        ],
    },
    "docker": {
        "name": "Docker Container Workspace",
        "categories": [
            {
                "name": "Docker",
                "commands": [
                    {"name": "Compose Up", "command": "docker compose up -d"},
                    {"name": "Compose Down", "command": "docker compose down"},
                    {"name": "Compose Logs", "command": "docker compose logs -f"},
                    {"name": "Compose Build", "command": "docker compose build"},
                ],
            }
        ],
    },
    "generic": {
        "name": "Generic Workspace",
        "categories": [
            {
                "name": "Workspace Commands",
                "commands": [
                    {"name": "Build Project", "command": "make build"},
                    {"name": "Test Project", "command": "make test"},
                    {"name": "Git Status", "command": "git status"},
                ],
            }
        ],
    },
}


def find_git_root(start_dir=None):
    """
    Auto-detects Git repository root directory from start_dir upwards.
    Returns path to directory containing .git or None.
    """
    if not start_dir:
        start_dir = os.getcwd()
    current = os.path.abspath(start_dir)
    while current:
        git_path = os.path.join(current, ".git")
        if os.path.exists(git_path):
            return current
        parent = os.path.dirname(current)
        if not parent or parent == current:
            break
        current = parent
    return None


def find_workspace_config(start_dir=None):
    """
    Auto-detects workspace configuration file starting from start_dir upwards.
    Checks for .cmdbar.json or .cmdbar/config.json in parent directories.
    Returns dict with {config_path, workspace_dir, filename} or None.
    """
    if not start_dir:
        start_dir = os.getcwd()
    current = os.path.abspath(start_dir)

    while current:
        for name in [".cmdbar.json", os.path.join(".cmdbar", "config.json")]:
            candidate = os.path.join(current, name)
            if os.path.exists(candidate):
                return {
                    "config_path": candidate,
                    "workspace_dir": current,
                    "filename": name,
                }
        parent = os.path.dirname(current)
        if not parent or parent == current:
            break
        current = parent

    return None


def create_workspace_config(target_dir=None, template_name="generic", custom_config=None):
    """
    Creates/initializes a workspace configuration file in target_dir from a template or custom config.
    Returns dict with {config_path, workspace_dir, config}.
    """
    if not target_dir:
        target_dir = os.getcwd()
    target_dir = os.path.abspath(target_dir)
    config_path = os.path.join(target_dir, ".cmdbar.json")

    if custom_config:
        base_template = json.loads(json.dumps(custom_config))
    else:
        template_key = (template_name or "generic").lower()
        tmpl_obj = PROJECT_TEMPLATES.get(template_key, PROJECT_TEMPLATES["generic"])
        base_template = json.loads(json.dumps(tmpl_obj))

    dir_name = os.path.basename(target_dir)
    workspace_name = (
        (custom_config.get("workspace_name") or custom_config.get("name"))
        if custom_config
        else (dir_name or base_template.get("name") or "Workspace")
    )
    config_data = {
        "workspace_name": workspace_name,
        "ai": base_template.get("ai", {}),
        "categories": base_template.get("categories", []),
    }

    from companion.companion_app import save_config
    save_config(config_data, config_path)

    return {
        "config_path": config_path,
        "workspace_dir": target_dir,
        "config": config_data,
    }


def merge_configs(global_config, workspace_config, options=None):
    """
    Merges global_config and workspace_config smoothly.
    Workspace categories and commands take priority or extend global categories.
    Returns merged effective configuration dict.
    """
    merged = json.loads(json.dumps(global_config or {"categories": []}))
    if not workspace_config or not isinstance(workspace_config, dict):
        return merged

    ws_name = workspace_config.get("workspace_name", "Workspace")
    ws_categories = workspace_config.get("categories", [])

    merged["_workspace"] = {
        "active": True,
        "name": ws_name,
    }

    if "ai" in workspace_config and isinstance(workspace_config["ai"], dict):
        merged_ai = merged.get("ai", {})
        merged_ai.update(workspace_config["ai"])
        merged["ai"] = merged_ai

    merged_categories = []

    for cat in ws_categories:
        if not cat or not isinstance(cat, dict) or not cat.get("name"):
            continue
        cat_copy = json.loads(json.dumps(cat))
        cat_copy["workspace"] = True
        if "commands" in cat_copy and isinstance(cat_copy["commands"], list):
            for cmd in cat_copy["commands"]:
                cmd["workspace"] = True
        merged_categories.append(cat_copy)

    for cat in merged.get("categories", []):
        if not cat or not isinstance(cat, dict) or not cat.get("name"):
            continue
        existing_ws_cat = next((c for c in merged_categories if c.get("name") == cat.get("name")), None)
        if existing_ws_cat:
            if "commands" in cat and isinstance(cat["commands"], list):
                existing_cmds = existing_ws_cat.get("commands", [])
                ws_cmd_names = {c.get("name") for c in existing_cmds if isinstance(c, dict)}
                for cmd in cat["commands"]:
                    if isinstance(cmd, dict) and cmd.get("name") not in ws_cmd_names:
                        existing_cmds.append(json.loads(json.dumps(cmd)))
                existing_ws_cat["commands"] = existing_cmds
        else:
            merged_categories.append(json.loads(json.dumps(cat)))

    merged["categories"] = merged_categories
    return merged


def get_effective_config(cwd=None, global_config_path=None):
    """
    Loads effective config, auto-detecting workspace config from cwd and merging with global config.
    """
    from companion.companion_app import load_config

    if not cwd:
        cwd = os.getcwd()

    global_config = load_config(global_config_path) if global_config_path else load_config()
    ws_info = find_workspace_config(cwd)

    if not ws_info:
        return global_config

    try:
        ws_config = load_config(ws_info["config_path"])
        merged = merge_configs(global_config, ws_config)
        merged["_workspace"]["dir"] = ws_info["workspace_dir"]
        merged["_workspace"]["config_path"] = ws_info["config_path"]
        return merged
    except Exception:
        return global_config


def switch_workspace(new_cwd, global_config_path=None):
    """
    Smoothly switches workspace to new_cwd and returns updated effective config.
    """
    return get_effective_config(new_cwd, global_config_path)
