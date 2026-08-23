"""
Unit & Integration tests for CmdBar Web Dashboard Python HTTP Server & REST API.
:visibility: public
"""

import os
import json
import time
import pytest
import threading
import urllib.request
import urllib.error
from companion.dashboard_server import (
    run_dashboard_server,
    merge_configs_structural,
    DEFAULT_PORT
)
from app.config_schema import load_config, save_config

TEST_PORT = 8089

@pytest.fixture(scope="module", autouse=True)
def start_test_server():
    """
    Spawns a background thread running the Web Dashboard HTTP server.
    :visibility: public
    """
    server_thread = threading.Thread(
        target=run_dashboard_server,
        kwargs={"port": TEST_PORT},
        daemon=True
    )
    server_thread.start()
    # Give server time to bind and listen
    time.sleep(0.3)
    yield
    # Thread cleans up on process exit

def test_dashboard_status_endpoint():
    """
    Verifies /api/status endpoint returns server health and status.
    :visibility: public
    """
    url = f"http://localhost:{TEST_PORT}/api/status"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as resp:
        assert resp.status == 200
        data = json.loads(resp.read().decode("utf-8"))
        assert data["status"] == "online"
        assert data["offline_capable"] is True

def test_dashboard_get_and_post_config():
    """
    Tests loading configuration and updating configuration via REST API.
    :visibility: public
    """
    get_url = f"http://localhost:{TEST_PORT}/api/config"
    with urllib.request.urlopen(get_url) as resp:
        assert resp.status == 200
        initial_cfg = json.loads(resp.read().decode("utf-8"))
        assert "categories" in initial_cfg

    post_url = f"http://localhost:{TEST_PORT}/api/config"
    new_cfg = {
        "categories": [
            {
                "name": "Test Server Category",
                "commands": [
                    {"name": "API Test Command", "command": "echo API OK"}
                ]
            }
        ]
    }
    body = json.dumps(new_cfg).encode("utf-8")
    req = urllib.request.Request(
        post_url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest"
        },
        method="POST"
    )

    with urllib.request.urlopen(req) as resp:
        assert resp.status == 200
        res_data = json.loads(resp.read().decode("utf-8"))
        assert res_data["status"] == "success"

    # Verify saved state
    with urllib.request.urlopen(get_url) as resp:
        updated_cfg = json.loads(resp.read().decode("utf-8"))
        cat_names = [c["name"] for c in updated_cfg["categories"]]
        assert "Test Server Category" in cat_names

def test_dashboard_preview_endpoint():
    """
    Tests command preview dry-run parameter substitution.
    :visibility: public
    """
    url = f"http://localhost:{TEST_PORT}/api/preview"
    payload = {
        "command": "ping -c 3 <host>",
        "mode": "shell-quoted",
        "parameters": {"host": "example.com"},
        "parameters_schema": {
            "host": {
                "regex": "^[a-zA-Z0-9.-]+$",
                "error_message": "Invalid host"
            }
        }
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest"},
        method="POST"
    )

    with urllib.request.urlopen(req) as resp:
        assert resp.status == 200
        res_data = json.loads(resp.read().decode("utf-8"))
        assert res_data["is_valid"] is True
        assert "example.com" in res_data["resolved_command"]

def test_dashboard_structural_merge_logic():
    """
    Tests 2-way structural merge of local and remote configurations.
    :visibility: public
    """
    local = {
        "categories": [
            {"name": "Core", "commands": [{"name": "C1", "command": "e1"}]}
        ]
    }
    remote = {
        "categories": [
            {"name": "Core", "commands": [{"name": "C1", "command": "e1"}, {"name": "C2", "command": "e2"}]},
            {"name": "NewCat", "commands": [{"name": "N1", "command": "en1"}]}
        ]
    }

    merged = merge_configs_structural(local, remote)
    assert len(merged["categories"]) == 2
    core_cat = next(c for c in merged["categories"] if c["name"] == "Core")
    assert len(core_cat["commands"]) == 2
    new_cat = next(c for c in merged["categories"] if c["name"] == "NewCat")
    assert len(new_cat["commands"]) == 1

def test_dashboard_security_path_traversal_protection():
    """
    Verifies that directory traversal attempts are rejected.
    :visibility: public
    """
    url = f"http://localhost:{TEST_PORT}/../../etc/passwd"
    try:
        urllib.request.urlopen(url)
        pytest.fail("Path traversal request should have been rejected")
    except urllib.error.HTTPError as e:
        assert e.code in (400, 403, 404)
