import os
import tempfile
import json
import pytest
from companion.workspace_config import (
    find_git_root,
    find_workspace_config,
    create_workspace_config,
    merge_configs,
    get_effective_config,
    switch_workspace,
    PROJECT_TEMPLATES,
)
from companion.companion_app import save_config
from companion.dbus_service import CmdBarDBusService


def test_find_git_root():
    with tempfile.TemporaryDirectory() as temp_dir:
        project_dir = os.path.join(temp_dir, "my-repo")
        sub_dir = os.path.join(project_dir, "src", "components")
        os.makedirs(os.path.join(project_dir, ".git"), exist_ok=True)
        os.makedirs(sub_dir, exist_ok=True)

        detected = find_git_root(sub_dir)
        assert detected == os.path.abspath(project_dir)

        plain_dir = os.path.join(temp_dir, "plain-folder")
        os.makedirs(plain_dir, exist_ok=True)
        assert find_git_root(plain_dir) is None


def test_find_workspace_config():
    with tempfile.TemporaryDirectory() as temp_dir:
        project_dir = os.path.join(temp_dir, "python-project")
        os.makedirs(project_dir, exist_ok=True)

        res = create_workspace_config(target_dir=project_dir, template_name="python")
        assert os.path.exists(res["config_path"])

        found = find_workspace_config(project_dir)
        assert found is not None
        assert found["workspace_dir"] == os.path.abspath(project_dir)
        assert found["config_path"] == res["config_path"]

        nested_dir = os.path.join(project_dir, "tests", "unit")
        os.makedirs(nested_dir, exist_ok=True)
        found_nested = find_workspace_config(nested_dir)
        assert found_nested is not None
        assert found_nested["workspace_dir"] == os.path.abspath(project_dir)


def test_create_workspace_config_templates():
    with tempfile.TemporaryDirectory() as temp_dir:
        for tmpl in ["node", "python", "rust", "go", "docker", "generic"]:
            target_dir = os.path.join(temp_dir, f"project-{tmpl}")
            os.makedirs(target_dir, exist_ok=True)

            res = create_workspace_config(target_dir=target_dir, template_name=tmpl)
            assert os.path.exists(res["config_path"])

            with open(res["config_path"], "r") as f:
                content = json.load(f)
            assert content["workspace_name"] == f"project-{tmpl}"
            assert len(content["categories"]) > 0


def test_merge_configs():
    global_cfg = {
        "categories": [
            {"name": "System", "commands": [{"name": "HTOP", "command": "htop"}]}
        ]
    }
    ws_cfg = {
        "workspace_name": "Go Backend",
        "categories": [
            {"name": "Go", "commands": [{"name": "Go Test", "command": "go test ./..."}]}
        ]
    }

    merged = merge_configs(global_cfg, ws_cfg)
    assert merged["_workspace"]["active"] is True
    assert merged["_workspace"]["name"] == "Go Backend"
    assert len(merged["categories"]) == 2
    assert merged["categories"][0]["name"] == "Go"
    assert merged["categories"][0]["workspace"] is True


def test_get_effective_config_and_switch():
    with tempfile.TemporaryDirectory() as temp_dir:
        global_path = os.path.join(temp_dir, "global_config.json")
        save_config({"categories": [{"name": "Global", "commands": []}]}, global_path)

        ws_dir = os.path.join(temp_dir, "active-app")
        os.makedirs(ws_dir, exist_ok=True)
        create_workspace_config(target_dir=ws_dir, template_name="rust")

        effective = get_effective_config(cwd=ws_dir, global_config_path=global_path)
        assert effective["_workspace"]["dir"] == os.path.abspath(ws_dir)
        assert any(c["name"] == "Rust" for c in effective["categories"])
        assert any(c["name"] == "Global" for c in effective["categories"])

        switched = switch_workspace(new_cwd=ws_dir, global_config_path=global_path)
        assert switched["_workspace"]["name"] == "active-app"


def test_dbus_workspace_integration():
    with tempfile.TemporaryDirectory() as temp_dir:
        global_path = os.path.join(temp_dir, "global_config.json")
        save_config({"categories": [{"name": "DBusCat", "commands": []}]}, global_path)

        ws_dir = os.path.join(temp_dir, "dbus-project")
        os.makedirs(ws_dir, exist_ok=True)

        service = CmdBarDBusService(config_path=global_path)

        created_path = service.init_workspace(dir_path=ws_dir, template_name="node")
        assert os.path.exists(created_path)

        effective_json = service.get_effective_config_json(cwd=ws_dir)
        parsed = json.loads(effective_json)
        assert parsed["_workspace"]["active"] is True
        assert any(c["name"] == "Node.js" for c in parsed["categories"])
