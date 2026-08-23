import os
import sys
import json
import tempfile
import time
import pytest

from companion.companion_app import load_config, save_config, get_config_path
from companion.environment_snapshot import (
    export_snapshot,
    validate_snapshot,
    import_snapshot,
    create_backup,
    list_backups,
    restore_backup,
    delete_backup,
    encode_shareable_payload,
    decode_shareable_payload,
    share_snapshot_to_cloud,
    fetch_snapshot_from_cloud,
    merge_configs,
    merge_histories,
    save_clipboard_history,
    load_clipboard_history,
    compute_snapshot_signature
)
from companion.dbus_service import CmdBarDBusService
from companion.dbus_client import CmdBarDBusClient


@pytest.fixture
def env_dir(tmp_path, monkeypatch):
    cfg_path = os.path.join(tmp_path, "config.json")
    clip_path = os.path.join(tmp_path, "clipboard_history.json")
    style_path = os.path.join(tmp_path, "stylesheet.css")
    backups_dir = os.path.join(tmp_path, "backups")

    monkeypatch.setenv("CMDBAR_CONFIG_PATH", cfg_path)

    sample_config = {
        "categories": [
            {
                "name": "Testing",
                "commands": [
                    {"name": "Run Pytest", "command": "pytest", "template": "pytest"}
                ]
            }
        ],
        "ai": {"provider": "ollama"}
    }
    save_config(sample_config)

    sample_clip = [{"text": "echo hello", "command": "echo hello", "timestamp": int(time.time())}]
    save_clipboard_history(sample_clip, clip_path)

    with open(style_path, "w", encoding="utf-8") as f:
        f.write("/* Custom Theme CSS */")

    return {
        "dir": str(tmp_path),
        "config_path": cfg_path,
        "clipboard_path": clip_path,
        "stylesheet_path": style_path,
        "backups_dir": backups_dir
    }


def test_export_and_validate_snapshot(env_dir):
    snap = export_snapshot(
        config_path=env_dir["config_path"],
        clipboard_path=env_dir["clipboard_path"],
        stylesheet_path=env_dir["stylesheet_path"],
        description="Python Test Export"
    )

    assert snap["$schema"] == "cmdbar-environment-snapshot/v1"
    assert snap["version"] == 1
    assert snap["description"] == "Python Test Export"
    assert "signature" in snap
    assert len(snap["config"]["categories"]) == 1

    validation = validate_snapshot(snap)
    assert validation["valid"] is True
    assert validation["snapshot"]["snapshot_id"] == snap["snapshot_id"]


def test_tampered_signature_detection(env_dir):
    snap = export_snapshot(
        config_path=env_dir["config_path"],
        clipboard_path=env_dir["clipboard_path"],
        stylesheet_path=env_dir["stylesheet_path"]
    )

    # Tamper with snapshot
    snap["config"]["categories"].append({"name": "Malicious", "commands": []})

    validation = validate_snapshot(snap)
    assert validation["valid"] is False
    assert "Cryptographic signature mismatch" in validation["error"]


def test_encrypted_snapshot_roundtrip(env_dir):
    passphrase = "SecretPassphrase456!"
    snap = export_snapshot(
        config_path=env_dir["config_path"],
        clipboard_path=env_dir["clipboard_path"],
        stylesheet_path=env_dir["stylesheet_path"],
        passphrase=passphrase
    )

    assert "encrypted_payload" in snap
    assert snap.get("config") is None

    # Fail without passphrase
    v_no_pass = validate_snapshot(snap)
    assert v_no_pass["valid"] is False

    # Fail with wrong passphrase
    v_wrong_pass = validate_snapshot(snap, passphrase="Wrong")
    assert v_wrong_pass["valid"] is False

    # Succeed with correct passphrase
    v_correct = validate_snapshot(snap, passphrase=passphrase)
    assert v_correct["valid"] is True
    assert len(v_correct["snapshot"]["config"]["categories"]) == 1


def test_import_snapshot_merge_and_replace(env_dir):
    snap = export_snapshot(
        config_path=env_dir["config_path"],
        clipboard_path=env_dir["clipboard_path"],
        stylesheet_path=env_dir["stylesheet_path"]
    )

    # Modify source snapshot and re-sign
    snap["config"]["categories"].append({
        "name": "New Cat",
        "commands": [{"name": "New Cmd", "template": "echo new"}]
    })
    secret_key = "cmdbar_snapshot_secret_key_v1"
    snap["signature"] = compute_snapshot_signature(snap, secret_key)

    # Test merge import
    res_merge = import_snapshot(
        snap,
        mode="merge",
        config_path=env_dir["config_path"],
        clipboard_path=env_dir["clipboard_path"],
        stylesheet_path=env_dir["stylesheet_path"],
        backups_dir=env_dir["backups_dir"],
        create_backup_before_import=True
    )
    assert res_merge["success"] is True

    loaded = load_config()
    assert len(loaded["categories"]) == 2

    # Test replace import
    replace_snap = export_snapshot(
        config_path=env_dir["config_path"],
        clipboard_path=env_dir["clipboard_path"],
        stylesheet_path=env_dir["stylesheet_path"]
    )
    replace_snap["config"]["categories"] = [{"name": "Replaced", "commands": []}]
    replace_snap["signature"] = compute_snapshot_signature(replace_snap, secret_key)

    res_replace = import_snapshot(
        replace_snap,
        mode="replace",
        config_path=env_dir["config_path"],
        clipboard_path=env_dir["clipboard_path"],
        stylesheet_path=env_dir["stylesheet_path"],
        backups_dir=env_dir["backups_dir"]
    )
    assert res_replace["success"] is True

    loaded_replaced = load_config()
    assert len(loaded_replaced["categories"]) == 1
    assert loaded_replaced["categories"][0]["name"] == "Replaced"


def test_backup_list_restore_delete(env_dir):
    b1 = create_backup(
        backups_dir=env_dir["backups_dir"],
        description="Backup Test 1",
        config_path=env_dir["config_path"],
        clipboard_path=env_dir["clipboard_path"],
        stylesheet_path=env_dir["stylesheet_path"]
    )
    assert b1["success"] is True

    backups = list_backups(env_dir["backups_dir"])
    assert len(backups) == 1
    assert backups[0]["description"] == "Backup Test 1"

    # Restore backup
    restore_res = restore_backup(
        b1["backup_path"],
        backups_dir=env_dir["backups_dir"],
        config_path=env_dir["config_path"],
        clipboard_path=env_dir["clipboard_path"],
        stylesheet_path=env_dir["stylesheet_path"]
    )
    assert restore_res["success"] is True

    # Delete all backups in dir
    for b in list_backups(env_dir["backups_dir"]):
        delete_backup(b["file_path"], backups_dir=env_dir["backups_dir"])

    assert len(list_backups(env_dir["backups_dir"])) == 0


def test_cloud_share_and_encode(env_dir):
    snap = export_snapshot(
        config_path=env_dir["config_path"],
        clipboard_path=env_dir["clipboard_path"],
        stylesheet_path=env_dir["stylesheet_path"]
    )

    payload_url = encode_shareable_payload(snap)
    assert payload_url.startswith("cmdbar-snap://")

    decoded = decode_shareable_payload(payload_url)
    assert decoded["snapshot_id"] == snap["snapshot_id"]

    cloud_res = share_snapshot_to_cloud(snap)
    assert cloud_res["success"] is True

    fetched = fetch_snapshot_from_cloud({"share_link": cloud_res["shareable_link"]})
    assert fetched["snapshot_id"] == snap["snapshot_id"]


def test_dbus_service_snapshot_methods(env_dir):
    service = CmdBarDBusService(config_path=env_dir["config_path"])
    client = CmdBarDBusClient(service=service)

    snap_dict = client.export_snapshot({"description": "DBus Export"})
    assert snap_dict["$schema"] == "cmdbar-environment-snapshot/v1"

    backup_path = client.create_backup("DBus Backup")
    assert backup_path != ""
    assert os.path.exists(backup_path)

    backups_list = client.list_backups()
    assert isinstance(backups_list, list)

    restore_success = client.restore_backup(backup_path)
    assert restore_success is True

    import_success = client.import_snapshot(snap_dict, {"mode": "merge"})
    assert import_success is True
