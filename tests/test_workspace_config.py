import os
import time
import shutil
import tempfile
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

def test_merge_configs():
    global_cfg = {
        "categories": [
            {"name": "Global", "commands": [{"name": "Echo", "command": "echo global"}]}
        ]
    }
    ws_cfg = {
        "categories": [
            {"name": "Project", "commands": [{"name": "Test", "command": "pytest"}]}
        ]
    }

    merged = merge_configs(global_cfg, ws_cfg)
    assert len(merged["categories"]) == 2
    assert merged["categories"][0]["name"] == "Project"
    assert merged["categories"][1]["name"] == "Global"

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
