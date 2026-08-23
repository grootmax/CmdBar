import os
import time
import shutil
import tempfile
import json
import pytest
from app.workspace_config import (
    PROJECT_TEMPLATES,
    find_git_repository_root,
    find_workspace_config_path,
    detect_project_type,
    init_workspace_config,
    load_workspace_config,
    merge_configs,
    WorkspaceManager
)
from companion.workspace_config import (
    find_git_root,
    find_workspace_config,
    create_workspace_config,
    get_effective_config,
    switch_workspace,
)
from companion.companion_app import save_config
from companion.dbus_service import CmdBarDBusService

@pytest.fixture
def temp_dir():
    d = tempfile.mkdtemp(prefix="cmdbar-py-ws-test-")
    yield d
    if os.path.exists(d):
        shutil.rmtree(d, ignore_errors=True)

def test_find_git_repository_root(temp_dir):
    git_dir = os.path.join(temp_dir, "my-repo")
    sub_dir = os.path.join(git_dir, "src", "module")
    os.makedirs(os.path.join(git_dir, ".git"), exist_ok=True)
    os.makedirs(sub_dir, exist_ok=True)

    assert find_git_repository_root(sub_dir) == git_dir
    assert find_git_repository_root(temp_dir) is None

def test_find_workspace_config_path(temp_dir):
    ws_dir = os.path.join(temp_dir, "project-1")
    os.makedirs(ws_dir, exist_ok=True)
    config_file = os.path.join(ws_dir, ".cmdbar.json")
    with open(config_file, "w") as f:
        f.write('{"categories": []}')

    assert find_workspace_config_path(ws_dir) == config_file

def test_detect_project_type(temp_dir):
    node_dir = os.path.join(temp_dir, "node")
    os.makedirs(node_dir, exist_ok=True)
    open(os.path.join(node_dir, "package.json"), "w").close()
    assert detect_project_type(node_dir) == "node"

    py_dir = os.path.join(temp_dir, "py")
    os.makedirs(py_dir, exist_ok=True)
    open(os.path.join(py_dir, "requirements.txt"), "w").close()
    assert detect_project_type(py_dir) == "python"

    rust_dir = os.path.join(temp_dir, "rust")
    os.makedirs(rust_dir, exist_ok=True)
    open(os.path.join(rust_dir, "Cargo.toml"), "w").close()
    assert detect_project_type(rust_dir) == "rust"

    go_dir = os.path.join(temp_dir, "go")
    os.makedirs(go_dir, exist_ok=True)
    open(os.path.join(go_dir, "go.mod"), "w").close()
    assert detect_project_type(go_dir) == "go"

def test_init_and_load_workspace_config(temp_dir):
    ws_dir = os.path.join(temp_dir, "my-app")
    config, path = init_workspace_config(ws_dir, "python")

    assert os.path.exists(path)
    assert config["workspace"]["template"] == "python"

    loaded = load_workspace_config(ws_dir)
    assert loaded is not None
    assert loaded["categories"][0]["name"] == "Python Commands"

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
            {"name": "Global", "commands": [{"name": "Echo", "command": "echo global"}]}
        ]
    }
    ws_cfg = {
        "workspace_name": "Go Backend",
        "categories": [
            {"name": "Go", "commands": [{"name": "Go Test", "command": "go test ./..."}]}
        ]
    }

    merged = merge_configs(global_cfg, ws_cfg)
    assert len(merged["categories"]) == 2
    assert merged["categories"][0]["name"] == "Go"

def test_workspace_manager_switching(temp_dir):
    manager = WorkspaceManager(global_config={"categories": [{"name": "Global", "commands": []}]})

    py_dir = os.path.join(temp_dir, "app-py")
    rust_dir = os.path.join(temp_dir, "app-rust")

    init_workspace_config(py_dir, "python")
    init_workspace_config(rust_dir, "rust")

    manager.set_current_cwd(py_dir)
    assert manager.get_active_config()["categories"][0]["name"] == "Python Commands"

    manager.switch_workspace(rust_dir)
    assert manager.get_active_config()["categories"][0]["name"] == "Cargo Commands"

def test_performance_benchmark(temp_dir):
    ws_dir = os.path.join(temp_dir, "perf-app")
    sub_dir = os.path.join(ws_dir, "sub", "deep")
    os.makedirs(sub_dir, exist_ok=True)
    init_workspace_config(ws_dir, "node")

    manager = WorkspaceManager()

    start = time.perf_counter()
    for _ in range(100):
        manager.set_current_cwd(sub_dir)
        manager.get_active_config()
    elapsed = time.perf_counter() - start
    avg_ms = (elapsed / 100) * 1000

    assert avg_ms < 5.0

def test_get_effective_config_and_switch():
    with tempfile.TemporaryDirectory() as temp_dir:
        global_path = os.path.join(temp_dir, "global_config.json")
        save_config({"categories": [{"name": "Global", "commands": []}]}, global_path)

        ws_dir = os.path.join(temp_dir, "active-app")
        os.makedirs(ws_dir, exist_ok=True)
        create_workspace_config(target_dir=ws_dir, template_name="rust")

        effective = get_effective_config(cwd=ws_dir, global_config_path=global_path)
        assert effective["_workspace"]["dir"] == os.path.abspath(ws_dir)
        assert any(c["name"] == "Rust Project" or c["name"] == "Cargo Commands" or c["name"] == "Rust" for c in effective["categories"])
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
        assert any(c["name"] == "Node.js Project" or c["name"] == "Node.js Scripts" or c["name"] == "Node.js" for c in parsed["categories"])
