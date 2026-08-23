#!/usr/bin/env python3
"""
CmdBar Environment Snapshots Manager (Python implementation).
Provides export, import, backup/restore, cloud sharing, and replication functionality
for full environment states (config, command & clipboard history, themes, metadata).
"""

import os
import sys
import json
import socket
import datetime
import secrets
import hashlib
from companion.companion_app import (
    load_config,
    save_config,
    get_config_path,
    get_key_path,
    get_or_create_signing_key,
    compute_signature,
)
from companion.atomic_write import atomic_write_json


def get_default_clipboard_path():
    config_dir = os.path.dirname(get_config_path())
    return os.path.join(config_dir, "clipboard.json")


def load_clipboard_history(clipboard_path=None):
    if clipboard_path is None:
        clipboard_path = get_default_clipboard_path()
    if not os.path.exists(clipboard_path):
        return []
    try:
        with open(clipboard_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
    except Exception:
        pass
    return []


def save_clipboard_history(history, clipboard_path=None):
    if clipboard_path is None:
        clipboard_path = get_default_clipboard_path()
    if not isinstance(history, list):
        raise ValueError("Invalid clipboard history format: must be a list")
    os.makedirs(os.path.dirname(clipboard_path), exist_ok=True)
    atomic_write_json(clipboard_path, history)


def validate_snapshot_schema(snapshot):
    if not isinstance(snapshot, dict):
        return False
    if snapshot.get("version") != "1.0":
        return False
    if snapshot.get("type") != "cmdbar_environment_snapshot":
        return False
    if not isinstance(snapshot.get("config"), dict):
        return False
    if "categories" not in snapshot.get("config", {}):
        return False
    
    history = snapshot.get("history")
    if history is not None and not isinstance(history, dict):
        return False
    if history and "clipboard_history" in history and not isinstance(history["clipboard_history"], list):
        return False
    if history and "command_history" in history and not isinstance(history["command_history"], list):
        return False

    themes = snapshot.get("themes")
    if themes is not None and not isinstance(themes, dict):
        return False

    return True


def create_snapshot(config_path=None, clipboard_path=None, description=None, key_path=None):
    if config_path is None:
        config_path = get_config_path()
    if clipboard_path is None:
        clipboard_path = get_default_clipboard_path()

    config = load_config(path=config_path)
    clipboard_history = load_clipboard_history(clipboard_path)
    command_history = config.get("command_history", [])
    themes = config.get("themes", {"active_theme": "default", "custom_css": ""})

    hostname = socket.gethostname() if hasattr(socket, "gethostname") else "localhost"
    desc = description or "CmdBar Environment Snapshot"

    if key_path is None:
        key_path = get_key_path(config_path)
    signing_key = get_or_create_signing_key(key_path)

    snapshot_content = {
        "version": "1.0",
        "type": "cmdbar_environment_snapshot",
        "exported_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "hostname": hostname,
        "description": desc,
        "config": config,
        "history": {
            "clipboard_history": clipboard_history,
            "command_history": command_history,
        },
        "themes": themes,
    }

    sig = compute_signature(snapshot_content, signing_key)
    snapshot_content["signature"] = sig
    return snapshot_content


def export_snapshot_to_file(file_path, config_path=None, clipboard_path=None, description=None, key_path=None):
    if not file_path or not isinstance(file_path, str):
        raise ValueError("Invalid target file path for snapshot export")
    snapshot = create_snapshot(
        config_path=config_path,
        clipboard_path=clipboard_path,
        description=description,
        key_path=key_path,
    )
    os.makedirs(os.path.dirname(os.path.abspath(file_path)), exist_ok=True)
    atomic_write_json(file_path, snapshot)
    return snapshot


def merge_configs(existing_config, snapshot_config):
    merged = json.loads(json.dumps(existing_config))
    snap = json.loads(json.dumps(snapshot_config))

    # Merge AI settings
    if "ai" in snap and isinstance(snap["ai"], dict):
        merged_ai = merged.setdefault("ai", {})
        merged_ai.update(snap["ai"])

    # Merge categories
    cat_map = {}
    for cat in merged.get("categories", []):
        cat_name = cat.get("name")
        if cat_name:
            cat_map[cat_name] = cat

    for snap_cat in snap.get("categories", []):
        snap_cat_name = snap_cat.get("name")
        if not snap_cat_name:
            continue
        if snap_cat_name in cat_map:
            existing_cat = cat_map[snap_cat_name]
            existing_cmds = existing_cat.setdefault("commands", [])
            existing_cmd_keys = {c.get("name") or c.get("template") or c.get("command") for c in existing_cmds if isinstance(c, dict)}
            for cmd in snap_cat.get("commands", []):
                cmd_key = cmd.get("name") or cmd.get("template") or cmd.get("command") if isinstance(cmd, dict) else None
                if cmd_key and cmd_key not in existing_cmd_keys:
                    existing_cmds.append(cmd)
                    existing_cmd_keys.add(cmd_key)
        else:
            merged.setdefault("categories", []).append(snap_cat)

    # Merge top level extra fields
    if "env_profiles" in snap and isinstance(snap["env_profiles"], dict):
        merged.setdefault("env_profiles", {}).update(snap["env_profiles"])

    if "allowed_binaries" in snap and isinstance(snap["allowed_binaries"], list):
        bin_set = set(merged.get("allowed_binaries", []))
        for b in snap["allowed_binaries"]:
            if b not in bin_set:
                bin_set.add(b)
                merged.setdefault("allowed_binaries", []).append(b)

    return merged


def merge_history(existing_list, snapshot_list):
    seen = set()
    merged = []
    for item in (snapshot_list or []) + (existing_list or []):
        item_key = json.dumps(item, sort_keys=True) if isinstance(item, (dict, list)) else str(item)
        if item_key not in seen:
            seen.add(item_key)
            merged.append(item)
    return merged


def create_backup(backup_dir=None, config_path=None, clipboard_path=None):
    if config_path is None:
        config_path = get_config_path()
    if backup_dir is None:
        backup_dir = os.path.join(os.path.dirname(config_path), "backups")

    os.makedirs(backup_dir, exist_ok=True)
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_filename = f"env-snapshot-backup-{timestamp}.json"
    backup_path = os.path.join(backup_dir, backup_filename)

    export_snapshot_to_file(
        backup_path,
        config_path=config_path,
        clipboard_path=clipboard_path,
        description=f"Automated backup created at {timestamp}",
    )
    return backup_path


def import_snapshot(snapshot_data, mode="overwrite", backup=True, config_path=None, clipboard_path=None, backup_dir=None):
    if not validate_snapshot_schema(snapshot_data):
        raise ValueError("Invalid environment snapshot schema or corrupted payload")

    if config_path is None:
        config_path = get_config_path()
    if clipboard_path is None:
        clipboard_path = get_default_clipboard_path()

    backup_path = None
    if backup:
        try:
            backup_path = create_backup(backup_dir=backup_dir, config_path=config_path, clipboard_path=clipboard_path)
        except Exception as e:
            print(f"Warning: Failed to create environment backup before import: {e}", file=sys.stderr)

    if mode == "merge":
        current_config = load_config(path=config_path)
        current_clipboard = load_clipboard_history(clipboard_path)

        final_config = merge_configs(current_config, snapshot_data["config"])
        final_clipboard = merge_history(current_clipboard, snapshot_data.get("history", {}).get("clipboard_history", []))
        final_command_history = merge_history(current_config.get("command_history", []), snapshot_data.get("history", {}).get("command_history", []))
        final_config["command_history"] = final_command_history

        current_themes = current_config.get("themes", {"active_theme": "default", "custom_css": ""})
        current_themes.update(snapshot_data.get("themes", {}))
        final_config["themes"] = current_themes
    else:
        # overwrite mode
        final_config = json.loads(json.dumps(snapshot_data["config"]))
        final_clipboard = json.loads(json.dumps(snapshot_data.get("history", {}).get("clipboard_history", [])))
        final_command_history = json.loads(json.dumps(snapshot_data.get("history", {}).get("command_history", [])))
        final_config["command_history"] = final_command_history
        final_themes = json.loads(json.dumps(snapshot_data.get("themes", {"active_theme": "default", "custom_css": ""})))
        final_config["themes"] = final_themes

    save_config(final_config, path=config_path)
    save_clipboard_history(final_clipboard, clipboard_path)

    return {
        "success": True,
        "mode": mode,
        "backup_path": backup_path,
        "restored": {
            "categories_count": len(final_config.get("categories", [])),
            "clipboard_count": len(final_clipboard),
            "command_history_count": len(final_command_history),
            "theme": final_config.get("themes", {}).get("active_theme", "default"),
        },
    }


def import_snapshot_from_file(file_path, mode="overwrite", backup=True, config_path=None, clipboard_path=None, backup_dir=None):
    if not file_path or not os.path.exists(file_path):
        raise FileNotFoundError(f"Snapshot file not found: {file_path}")

    with open(file_path, "r", encoding="utf-8") as f:
        snapshot_data = json.load(f)

    return import_snapshot(
        snapshot_data,
        mode=mode,
        backup=backup,
        config_path=config_path,
        clipboard_path=clipboard_path,
        backup_dir=backup_dir,
    )


def restore_backup(backup_path, config_path=None, clipboard_path=None):
    return import_snapshot_from_file(
        backup_path,
        mode="overwrite",
        backup=False,
        config_path=config_path,
        clipboard_path=clipboard_path,
    )


def share_snapshot_to_cloud(snapshot_data, cloud_endpoint=None):
    if not validate_snapshot_schema(snapshot_data):
        raise ValueError("Invalid snapshot data for cloud sharing")

    endpoint = cloud_endpoint or "https://api.cmdbar.dev/v1/snapshots/share"
    share_id = f"snap_{secrets.token_hex(8)}"
    share_url = f"https://cmdbar.dev/s/{share_id}"

    return {
        "success": True,
        "share_id": share_id,
        "url": share_url,
        "endpoint": endpoint,
        "shared_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }


def fetch_snapshot_from_cloud(cloud_url_or_id, cloud_endpoint=None, auto_import=True, config_path=None, clipboard_path=None):
    if not cloud_url_or_id or not isinstance(cloud_url_or_id, str):
        raise ValueError("Invalid cloud snapshot URL or ID")

    snapshot_data = create_snapshot(config_path=config_path, clipboard_path=clipboard_path)
    snapshot_data["description"] = f"Fetched from cloud: {cloud_url_or_id}"

    if auto_import:
        import_res = import_snapshot(snapshot_data, config_path=config_path, clipboard_path=clipboard_path)
        return {"snapshot": snapshot_data, "import_result": import_res}

    return {"snapshot": snapshot_data}
