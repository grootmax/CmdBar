#!/usr/bin/env python3
"""
Unit and Integration Tests for CmdBar Environment Snapshots (Python).
"""

import os
import json
import tempfile
import time
import pytest
from companion.environment_snapshot import (
    validate_snapshot_schema,
    create_snapshot,
    export_snapshot_to_file,
    import_snapshot,
    import_snapshot_from_file,
    create_backup,
    restore_backup,
    share_snapshot_to_cloud,
    fetch_snapshot_from_cloud,
    save_clipboard_history,
)
from companion.companion_app import load_config, save_config
from app.config_schema import DEFAULT_CONFIG


@pytest.fixture
def temp_env(tmp_path, monkeypatch):
    config_dir = tmp_path / "cmdbar"
    config_dir.mkdir()
    config_path = str(config_dir / "config.json")
    clipboard_path = str(config_dir / "clipboard.json")

    monkeypatch.setenv("CMDBAR_CONFIG_PATH", config_path)

    # Initialize config
    save_config(DEFAULT_CONFIG, config_path)
    save_clipboard_history([{"text": "initial_clip_1", "timestamp": 12345}], clipboard_path)

    return {
        "dir": str(tmp_path),
        "config_path": config_path,
        "clipboard_path": clipboard_path,
    }


def test_validate_snapshot_schema():
    assert validate_snapshot_schema(None) is False
    assert validate_snapshot_schema({}) is False

    valid_snap = {
        "version": "1.0",
        "type": "cmdbar_environment_snapshot",
        "config": DEFAULT_CONFIG,
        "history": {"clipboard_history": [], "command_history": []},
        "themes": {"active_theme": "default"},
    }
    assert validate_snapshot_schema(valid_snap) is True

    invalid_type = dict(valid_snap)
    invalid_type["type"] = "wrong_type"
    assert validate_snapshot_schema(invalid_type) is False


def test_create_and_export_snapshot(temp_env):
    snap = create_snapshot(
        config_path=temp_env["config_path"],
        clipboard_path=temp_env["clipboard_path"],
        description="PyTest Snapshot",
    )

    assert snap["version"] == "1.0"
    assert snap["type"] == "cmdbar_environment_snapshot"
    assert snap["description"] == "PyTest Snapshot"
    assert "signature" in snap
    assert len(snap["history"]["clipboard_history"]) == 1

    file_path = os.path.join(temp_env["dir"], "snapshot.json")
    exported = export_snapshot_to_file(
        file_path,
        config_path=temp_env["config_path"],
        clipboard_path=temp_env["clipboard_path"],
    )

    assert os.path.exists(file_path)
    assert exported["version"] == "1.0"


def test_import_snapshot_overwrite_and_merge(temp_env):
    snap_file = os.path.join(temp_env["dir"], "snapshot.json")
    export_snapshot_to_file(
        snap_file,
        config_path=temp_env["config_path"],
        clipboard_path=temp_env["clipboard_path"],
    )

    # Overwrite mode test
    res = import_snapshot_from_file(
        snap_file,
        mode="overwrite",
        backup=True,
        config_path=temp_env["config_path"],
        clipboard_path=temp_env["clipboard_path"],
        backup_dir=temp_env["dir"],
    )

    assert res["success"] is True
    assert res["mode"] == "overwrite"
    assert res["backup_path"] is not None
    assert os.path.exists(res["backup_path"])

    # Merge mode test
    with open(snap_file, "r") as f:
        snap_data = json.load(f)

    snap_data["config"]["categories"].append({
        "name": "Cloud Infra",
        "commands": [{"name": "Terraform Apply", "command": "terraform apply"}],
    })
    snap_data["history"]["clipboard_history"].append({"text": "new_clip_item"})

    merge_res = import_snapshot(
        snap_data,
        mode="merge",
        backup=False,
        config_path=temp_env["config_path"],
        clipboard_path=temp_env["clipboard_path"],
    )

    assert merge_res["success"] is True
    assert merge_res["mode"] == "merge"

    merged_cfg = load_config()
    cat_names = [c["name"] for c in merged_cfg["categories"]]
    assert "Cloud Infra" in cat_names


def test_create_and_restore_backup(temp_env):
    backup_path = create_backup(
        backup_dir=temp_env["dir"],
        config_path=temp_env["config_path"],
        clipboard_path=temp_env["clipboard_path"],
    )

    assert os.path.exists(backup_path)

    restored = restore_backup(
        backup_path,
        config_path=temp_env["config_path"],
        clipboard_path=temp_env["clipboard_path"],
    )

    assert restored["success"] is True


def test_cloud_share_and_fetch(temp_env):
    snap = create_snapshot(
        config_path=temp_env["config_path"],
        clipboard_path=temp_env["clipboard_path"],
    )

    share_res = share_snapshot_to_cloud(snap)
    assert share_res["success"] is True
    assert share_res["share_id"].startswith("snap_")

    fetch_res = fetch_snapshot_from_cloud(
        share_res["share_id"],
        auto_import=True,
        config_path=temp_env["config_path"],
        clipboard_path=temp_env["clipboard_path"],
    )

    assert fetch_res["snapshot"] is True or "snapshot" in fetch_res
    assert fetch_res["import_result"]["success"] is True


def test_performance_benchmark(temp_env):
    t0 = time.time()
    snap = create_snapshot(
        config_path=temp_env["config_path"],
        clipboard_path=temp_env["clipboard_path"],
    )
    t_export = (time.time() - t0) * 1000.0

    t1 = time.time()
    import_snapshot(
        snap,
        mode="overwrite",
        backup=False,
        config_path=temp_env["config_path"],
        clipboard_path=temp_env["clipboard_path"],
    )
    t_import = (time.time() - t1) * 1000.0

    assert t_export < 100.0
    assert t_import < 100.0
