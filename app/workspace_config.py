import os
import json
import datetime
from datetime import timezone

PROJECT_TEMPLATES = {
    "node": {
        "name": "Node.js",
        "categories": [
            {
                "name": "Node.js Scripts",
                "commands": [
                    {"name": "Start Project", "command": "npm start"},
                    {"name": "Run Tests", "command": "npm test"},
                    {"name": "Build Project", "command": "npm run build"},
                    {"name": "Install Dependencies", "command": "npm install"}
                ]
            }
        ]
    },
    "python": {
        "name": "Python",
        "categories": [
            {
                "name": "Python Commands",
                "commands": [
                    {"name": "Run Tests", "command": "pytest"},
                    {"name": "Run Application", "command": "python main.py"},
                    {"name": "Install Requirements", "command": "pip install -r requirements.txt"},
                    {"name": "Activate Virtualenv", "command": "source venv/bin/activate"}
                ]
            }
        ]
    },
    "rust": {
        "name": "Rust",
        "categories": [
            {
                "name": "Cargo Commands",
                "commands": [
                    {"name": "Cargo Check", "command": "cargo check"},
                    {"name": "Cargo Test", "command": "cargo test"},
                    {"name": "Cargo Run", "command": "cargo run"},
                    {"name": "Cargo Build Release", "command": "cargo build --release"}
                ]
            }
        ]
    },
    "go": {
        "name": "Go",
        "categories": [
            {
                "name": "Go Commands",
                "commands": [
                    {"name": "Go Test", "command": "go test ./..."},
                    {"name": "Go Run", "command": "go run ."},
                    {"name": "Go Build", "command": "go build"},
                    {"name": "Go Vet", "command": "go vet ./..."}
                ]
            }
        ]
    },
    "generic": {
        "name": "Generic Project",
        "categories": [
            {
                "name": "Build Tasks",
                "commands": [
                    {"name": "Make Default", "command": "make"},
                    {"name": "Make Test", "command": "make test"},
                    {"name": "Make Build", "command": "make build"},
                    {"name": "Make Clean", "command": "make clean"}
                ]
            }
        ]
    }
}

def find_git_repository_root(start_dir):
    if not start_dir or not isinstance(start_dir, str):
        return None
    current = os.path.abspath(start_dir)
    root = os.path.abspath(os.sep)
    while current:
        git_path = os.path.join(current, ".git")
        if os.path.exists(git_path):
            return current
        if current == root:
            break
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return None

def find_workspace_config_path(start_dir):
    if not start_dir or not isinstance(start_dir, str):
        return None
    current = os.path.abspath(start_dir)
    git_root = find_git_repository_root(current)
    root = os.path.abspath(os.sep)
    while current:
        file_config = os.path.join(current, ".cmdbar.json")
        if os.path.exists(file_config):
            return file_config
        dir_config = os.path.join(current, ".cmdbar", "config.json")
        if os.path.exists(dir_config):
            return dir_config
        if git_root and current == git_root:
            break
        if current == root:
            break
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return None

def detect_project_type(dir_path):
    if not dir_path or not isinstance(dir_path, str):
        return "generic"
    target_dir = os.path.abspath(dir_path)
    if not os.path.exists(target_dir):
        return "generic"

    if os.path.exists(os.path.join(target_dir, "package.json")):
        return "node"
    if any(os.path.exists(os.path.join(target_dir, f)) for f in ["requirements.txt", "pyproject.toml", "setup.py", "Pipfile"]):
        return "python"
    if os.path.exists(os.path.join(target_dir, "Cargo.toml")):
        return "rust"
    if os.path.exists(os.path.join(target_dir, "go.mod")):
        return "go"
    if os.path.exists(os.path.join(target_dir, "Makefile")):
        return "generic"
    return "generic"

def init_workspace_config(dir_path, template_name=None):
    if not dir_path or not isinstance(dir_path, str):
        raise ValueError("Directory path is required")
    resolved_dir = os.path.abspath(dir_path)
    os.makedirs(resolved_dir, exist_ok=True)

    selected_template = template_name.lower() if template_name and template_name.lower() in PROJECT_TEMPLATES else detect_project_type(resolved_dir)
    tmpl = PROJECT_TEMPLATES.get(selected_template, PROJECT_TEMPLATES["generic"])

    config = {
        "workspace": {
            "name": os.path.basename(resolved_dir) or "Workspace",
            "root": resolved_dir,
            "template": selected_template,
            "created_at": datetime.datetime.now(timezone.utc).isoformat()
        },
        "categories": json.loads(json.dumps(tmpl["categories"]))
    }

    config_path = os.path.join(resolved_dir, ".cmdbar.json")
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)
    return config, config_path

def load_workspace_config(dir_path):
    if not dir_path or not isinstance(dir_path, str):
        return None
    config_path = dir_path
    if not dir_path.endswith(".json"):
        config_path = find_workspace_config_path(dir_path)

    if not config_path or not os.path.exists(config_path):
        return None

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            parsed = json.load(f)
        if isinstance(parsed, dict) and "categories" in parsed and isinstance(parsed["categories"], list):
            return parsed
    except Exception:
        pass
    return None

def merge_configs(global_config, workspace_config):
    if not global_config:
        return workspace_config or {"categories": []}
    if not workspace_config:
        return global_config

    merged = json.loads(json.dumps(global_config))
    ws_categories = json.loads(json.dumps(workspace_config.get("categories", [])))

    existing_cat_map = {cat["name"]: idx for idx, cat in enumerate(merged.get("categories", []))}
    prepended_categories = []

    for ws_cat in ws_categories:
        cat_name = ws_cat.get("name")
        if cat_name in existing_cat_map:
            global_cat_idx = existing_cat_map[cat_name]
            global_cmd_names = {c["name"] for c in merged["categories"][global_cat_idx].get("commands", [])}
            for cmd in ws_cat.get("commands", []):
                if cmd.get("name") not in global_cmd_names:
                    merged["categories"][global_cat_idx].setdefault("commands", []).insert(0, cmd)
                    global_cmd_names.add(cmd["name"])
        else:
            prepended_categories.append(ws_cat)

    merged["categories"] = prepended_categories + merged.get("categories", [])

    if "ai" in workspace_config:
        merged.setdefault("ai", {}).update(workspace_config["ai"])

    if "workspace" in workspace_config:
        merged["_activeWorkspace"] = workspace_config["workspace"]

    return merged

class WorkspaceManager:
    def __init__(self, global_config=None):
        self.global_config = global_config or {"categories": []}
        self.known_workspaces = {} # path -> info
        self.active_cwd = None
        self.active_workspace_config_path = None
        self.active_workspace_config = None
        self.cache = {} # cwd -> config_path

    def set_global_config(self, config):
        self.global_config = config

    def register_workspace(self, workspace_path, name=None):
        resolved = os.path.abspath(workspace_path)
        info = {
            "path": resolved,
            "name": name or os.path.basename(resolved),
            "registered_at": datetime.datetime.now(timezone.utc).isoformat()
        }
        self.known_workspaces[resolved] = info
        return info

    def unregister_workspace(self, workspace_path):
        resolved = os.path.abspath(workspace_path)
        return self.known_workspaces.pop(resolved, None) is not None

    def list_workspaces(self):
        return list(self.known_workspaces.values())

    def set_current_cwd(self, cwd):
        if not cwd:
            return None
        resolved_cwd = os.path.abspath(cwd)
        self.active_cwd = resolved_cwd

        if resolved_cwd in self.cache:
            config_path = self.cache[resolved_cwd]
        else:
            config_path = find_workspace_config_path(resolved_cwd)
            self.cache[resolved_cwd] = config_path

        if config_path:
            self.active_workspace_config_path = config_path
            self.active_workspace_config = load_workspace_config(config_path)
            ws_dir = os.path.dirname(config_path)
            self.register_workspace(ws_dir)
        else:
            self.active_workspace_config_path = None
            self.active_workspace_config = None

        return self.active_workspace_config

    def switch_workspace(self, workspace_path):
        resolved = os.path.abspath(workspace_path)
        config_path = find_workspace_config_path(resolved)
        if not config_path:
            raise ValueError(f"No workspace config found in {workspace_path}")
        self.active_cwd = resolved
        self.active_workspace_config_path = config_path
        self.active_workspace_config = load_workspace_config(config_path)
        self.register_workspace(resolved)
        return self.active_workspace_config

    def get_active_config(self):
        if self.active_workspace_config:
            return merge_configs(self.global_config, self.active_workspace_config)
        return self.global_config

    def clear_cache(self):
        self.cache.clear()
