import os
import json
import time
import pytest
import urllib.request
import urllib.error
import threading
from app.config_schema import load_config, save_config
from companion.web_dashboard import start_dashboard_server, TEAM_PRESETS


@pytest.fixture(scope="module")
def dashboard_server(tmp_path_factory):
    # Set temp config directory
    test_dir = tmp_path_factory.mktemp("cmdbar_dashboard_test")
    cfg_path = os.path.join(test_dir, "config.json")
    os.environ["CMDBAR_CONFIG_PATH"] = cfg_path

    # Start server on dynamic port
    port = 8888
    server = start_dashboard_server(host="127.0.0.1", port=port, open_browser=False)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.3)

    base_url = f"http://127.0.0.1:{port}"
    yield base_url

    server.shutdown()
    server.server_close()


def test_get_status(dashboard_server):
    url = f"{dashboard_server}/api/status"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as response:
        assert response.status == 200
        data = json.loads(response.read().decode("utf-8"))
        assert data["status"] == "online"
        assert data["offline_capable"] is True


def test_get_config(dashboard_server):
    url = f"{dashboard_server}/api/config"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as response:
        assert response.status == 200
        data = json.loads(response.read().decode("utf-8"))
        assert "categories" in data


def test_post_config(dashboard_server):
    url = f"{dashboard_server}/api/config"
    new_cfg = {
        "categories": [
            {
                "name": "Test Cat",
                "commands": [
                    {
                        "name": "Echo Test",
                        "command": "echo 'Hello'",
                        "mode": "shell-quoted",
                    }
                ],
            }
        ]
    }
    payload = json.dumps(new_cfg).encode("utf-8")
    req = urllib.request.Request(
        url, data=payload, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req) as response:
        assert response.status == 200
        res = json.loads(response.read().decode("utf-8"))
        assert res["success"] is True

    # Verify loaded
    loaded = load_config()
    assert loaded["categories"][0]["name"] == "Test Cat"


def test_preview_api(dashboard_server):
    url = f"{dashboard_server}/api/preview"
    payload = json.dumps(
        {
            "template": "ping -c 3 <host>",
            "mode": "shell-quoted",
            "parameter_values": {"host": "127.0.0.1"},
            "parameters_schema": {"host": {"regex": "^[a-zA-Z0-9.-]+$"}},
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        url, data=payload, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req) as response:
        assert response.status == 200
        res = json.loads(response.read().decode("utf-8"))
        assert "ping -c 3 127.0.0.1" in res["resolved"]
        assert len(res["errors"]) == 0


def test_team_presets_api(dashboard_server):
    url = f"{dashboard_server}/api/team/presets"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as response:
        assert response.status == 200
        presets = json.loads(response.read().decode("utf-8"))
        assert "DevOps" in presets
        assert "Frontend" in presets


def test_team_collaborate_apply_preset(dashboard_server):
    url = f"{dashboard_server}/api/team/collaborate"
    payload = json.dumps({"action": "apply_preset", "preset_name": "Frontend"}).encode(
        "utf-8"
    )

    req = urllib.request.Request(
        url, data=payload, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req) as response:
        assert response.status == 200
        res = json.loads(response.read().decode("utf-8"))
        assert res["success"] is True
        assert any(
            c["name"] == "Frontend Development" for c in res["config"]["categories"]
        )


def test_export_import_api(dashboard_server):
    # Test Export
    export_url = f"{dashboard_server}/api/export"
    with urllib.request.urlopen(export_url) as response:
        assert response.status == 200
        exported = json.loads(response.read().decode("utf-8"))
        assert "_export_timestamp" in exported

    # Test Import
    import_url = f"{dashboard_server}/api/import"
    imported_payload = json.dumps(
        {"categories": [{"name": "Imported Category", "commands": []}]}
    ).encode("utf-8")

    req = urllib.request.Request(
        import_url,
        data=imported_payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as response:
        assert response.status == 200
        res = json.loads(response.read().decode("utf-8"))
        assert res["success"] is True
