#!/usr/bin/env python3
import os
import sys
import json
import time
import hmac
import hashlib
import secrets
import base64
import platform
import socket
import getpass
from pathlib import Path

from companion.companion_app import load_config, save_config, get_config_path

def get_backups_dir(custom_path=None):
    if custom_path:
        return custom_path
    config_home = os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config"))
    return os.path.join(config_home, "cmdbar", "backups")

def canonical_json(obj):
    if isinstance(obj, dict):
        clean = {k: v for k, v in obj.items() if k != "signature"}
        return json.dumps(clean, sort_keys=True, separators=(',', ':'))
    elif isinstance(obj, list):
        return '[' + ','.join(canonical_json(x) for x in obj) + ']'
    return json.dumps(obj, separators=(',', ':'))

def compute_snapshot_signature(snapshot_obj, secret_key):
    clean = dict(snapshot_obj)
    clean.pop("signature", None)
    canonical_str = canonical_json(clean)
    return hmac.new(secret_key.encode("utf-8"), canonical_str.encode("utf-8"), hashlib.sha256).hexdigest()

def derive_keys(passphrase, salt):
    dk = hashlib.pbkdf2_hmac('sha256', passphrase.encode('utf-8'), salt, 100000, dklen=64)
    return dk[:32], dk[32:64]

def generate_keystream(enc_key, length):
    blocks = []
    generated = 0
    counter = 0
    while generated < length:
        counter_bytes = counter.to_bytes(4, byteorder='big')
        block = hmac.new(enc_key, counter_bytes, hashlib.sha256).digest()
        blocks.append(block)
        generated += len(block)
        counter += 1
    return b''.join(blocks)[:length]

def encrypt_payload(data_str, passphrase):
    salt = secrets.token_bytes(16)
    enc_key, mac_key = derive_keys(passphrase, salt)
    data_bytes = data_str.encode('utf-8')
    keystream = generate_keystream(enc_key, len(data_bytes))
    cipher_bytes = bytes([b ^ k for b, k in zip(data_bytes, keystream)])
    tag = hmac.new(mac_key, cipher_bytes, hashlib.sha256).hexdigest()

    return {
        "encrypted": True,
        "salt": salt.hex(),
        "tag": tag,
        "data": cipher_bytes.hex()
    }

def decrypt_payload(encrypted_dict, passphrase):
    if not isinstance(encrypted_dict, dict) or not encrypted_dict.get("encrypted"):
        raise ValueError("Invalid encrypted payload structure")
    salt = bytes.fromhex(encrypted_dict["salt"])
    cipher_bytes = bytes.fromhex(encrypted_dict["data"])
    enc_key, mac_key = derive_keys(passphrase, salt)

    expected_tag = hmac.new(mac_key, cipher_bytes, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(encrypted_dict["tag"], expected_tag):
        raise ValueError("Incorrect passphrase or corrupted encrypted payload")

    keystream = generate_keystream(enc_key, len(cipher_bytes))
    plain_bytes = bytes([c ^ k for c, k in zip(cipher_bytes, keystream)])
    return plain_bytes.decode('utf-8')

def load_clipboard_history(clipboard_path=None):
    if not clipboard_path:
        config_dir = os.path.dirname(get_config_path())
        clipboard_path = os.path.join(config_dir, "clipboard_history.json")
    if os.path.exists(clipboard_path):
        try:
            with open(clipboard_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return []

def save_clipboard_history(history_data, clipboard_path=None):
    if not clipboard_path:
        config_dir = os.path.dirname(get_config_path())
        clipboard_path = os.path.join(config_dir, "clipboard_history.json")
    os.makedirs(os.path.dirname(clipboard_path), exist_ok=True)
    tmp_path = clipboard_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(history_data, f, indent=2)
    os.replace(tmp_path, clipboard_path)

def export_snapshot(
    config_path=None,
    clipboard_path=None,
    stylesheet_path=None,
    description="CmdBar Environment Snapshot",
    include_history=True,
    include_themes=True,
    include_config=True,
    passphrase=None,
    output_path=None
):
    cfg_path = config_path or get_config_path()
    clip_path = clipboard_path or os.path.join(os.path.dirname(cfg_path), "clipboard_history.json")
    style_path = stylesheet_path or os.path.join(os.path.dirname(cfg_path), "stylesheet.css")

    config_data = None
    if include_config:
        config_data = load_config()

    history_data = None
    if include_history:
        history_data = load_clipboard_history(clip_path)

    theme_data = None
    if include_themes:
        custom_css = ""
        if os.path.exists(style_path):
            try:
                with open(style_path, "r", encoding="utf-8") as f:
                    custom_css = f.read()
            except Exception:
                pass
        mode = "dark"
        if isinstance(config_data, dict) and "theme" in config_data:
            mode = config_data["theme"]
        theme_data = {
            "mode": mode,
            "custom_stylesheet": custom_css
        }

    timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    random_hex = secrets.token_hex(6)
    snapshot_id = f"snap_{int(time.time() * 1000)}_{random_hex}"

    snapshot = {
        "$schema": "cmdbar-environment-snapshot/v1",
        "version": 1,
        "snapshot_id": snapshot_id,
        "created_at": timestamp,
        "description": description,
        "metadata": {
            "app_name": "CmdBar",
            "app_version": "1.0.0",
            "hostname": socket.gethostname() or "localhost",
            "platform": sys.platform or "linux",
            "user": getpass.getuser() or "user"
        },
        "config": config_data,
        "history": {"clipboard": history_data} if history_data is not None else None,
        "themes": theme_data
    }

    secret_key = "cmdbar_snapshot_secret_key_v1"
    snapshot["signature"] = compute_snapshot_signature(snapshot, secret_key)

    if passphrase:
        raw_json = json.dumps(snapshot, indent=2)
        enc = encrypt_payload(raw_json, passphrase)
        final_output = {
            "$schema": "cmdbar-environment-snapshot/v1",
            "version": 1,
            "snapshot_id": snapshot_id,
            "created_at": timestamp,
            "encrypted_payload": enc
        }
    else:
        final_output = snapshot

    if output_path:
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        tmp_path = f"{output_path}.{int(time.time())}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(final_output, f, indent=2)
        os.replace(tmp_path, output_path)

    return final_output

def validate_snapshot(snapshot_input, passphrase=None):
    snap_obj = snapshot_input
    if isinstance(snapshot_input, str):
        if os.path.exists(snapshot_input) and os.path.isfile(snapshot_input):
            try:
                with open(snapshot_input, "r", encoding="utf-8") as f:
                    snap_obj = json.load(f)
            except Exception as e:
                return {"valid": False, "error": f"Invalid JSON file: {e}"}
        else:
            try:
                snap_obj = json.loads(snapshot_input)
            except Exception as e:
                return {"valid": False, "error": f"Invalid JSON string: {e}"}

    if not isinstance(snap_obj, dict):
        return {"valid": False, "error": "Snapshot must be a JSON object"}

    if "encrypted_payload" in snap_obj:
        if not passphrase:
            return {"valid": False, "error": "Passphrase required for encrypted snapshot"}
        try:
            decrypted_str = decrypt_payload(snap_obj["encrypted_payload"], passphrase)
            snap_obj = json.loads(decrypted_str)
        except Exception as e:
            return {"valid": False, "error": f"Decryption failed: {e}"}

    if snap_obj.get("$schema") != "cmdbar-environment-snapshot/v1":
        return {"valid": False, "error": f"Unsupported schema version: {snap_obj.get('$schema')}"}

    if not snap_obj.get("snapshot_id") or not snap_obj.get("created_at"):
        return {"valid": False, "error": "Missing required snapshot fields (snapshot_id, created_at)"}

    if "signature" in snap_obj:
        secret_key = "cmdbar_snapshot_secret_key_v1"
        expected_sig = compute_snapshot_signature(snap_obj, secret_key)
        if snap_obj["signature"] != expected_sig:
            return {"valid": False, "error": "Cryptographic signature mismatch or tampered snapshot"}

    return {"valid": True, "snapshot": snap_obj}

def merge_configs(target, source):
    merged = json.loads(json.dumps(target or {"categories": []}))
    if "categories" not in merged:
        merged["categories"] = []

    source_categories = (source or {}).get("categories", [])
    for src_cat in source_categories:
        cat_name = src_cat.get("name")
        if not cat_name:
            continue
        target_cat = next((c for c in merged["categories"] if c.get("name") == cat_name), None)
        if not target_cat:
            target_cat = {"name": cat_name, "commands": []}
            merged["categories"].append(target_cat)
        if "commands" not in target_cat:
            target_cat["commands"] = []

        for src_cmd in src_cat.get("commands", []):
            cmd_name = src_cmd.get("name")
            if not cmd_name:
                continue
            existing = next((c for c in target_cat["commands"] if c.get("name") == cmd_name), None)
            if existing:
                existing.update(src_cmd)
            else:
                target_cat["commands"].append(dict(src_cmd))

    if source and "ai" in source:
        merged.setdefault("ai", {}).update(source["ai"])

    if source and "profiles" in source and isinstance(source["profiles"], list):
        merged.setdefault("profiles", [])
        for p in source["profiles"]:
            if not any(existing.get("name") == p.get("name") for existing in merged["profiles"]):
                merged["profiles"].append(p)

    if source and "favorites" in source and isinstance(source["favorites"], list):
        merged.setdefault("favorites", [])
        for f in source["favorites"]:
            if f not in merged["favorites"]:
                merged["favorites"].append(f)

    return merged

def merge_histories(target, source):
    merged = list(target) if isinstance(target, list) else []
    if not isinstance(source, list):
        return merged

    for item in source:
        is_dup = False
        for existing in merged:
            if isinstance(existing, str) and isinstance(item, str) and existing == item:
                is_dup = True
                break
            if isinstance(existing, dict) and isinstance(item, dict):
                if existing.get("text") == item.get("text") or existing.get("command") == item.get("command"):
                    is_dup = True
                    break
        if not is_dup:
            merged.append(item)
    return merged

def create_backup(
    backups_dir=None,
    description="Automatic backup",
    config_path=None,
    clipboard_path=None,
    stylesheet_path=None
):
    target_dir = get_backups_dir(backups_dir)
    os.makedirs(target_dir, exist_ok=True)

    timestamp = int(time.time() * 1000)
    backup_file_name = f"backup_{timestamp}_{secrets.token_hex(4)}.json"
    backup_file_path = os.path.join(target_dir, backup_file_name)

    snapshot = export_snapshot(
        config_path=config_path,
        clipboard_path=clipboard_path,
        stylesheet_path=stylesheet_path,
        description=description,
        include_history=True,
        include_themes=True,
        include_config=True,
        output_path=backup_file_path
    )

    return {
        "success": True,
        "backup_path": backup_file_path,
        "file_name": backup_file_name,
        "snapshot_id": snapshot["snapshot_id"],
        "timestamp": snapshot["created_at"]
    }

def list_backups(backups_dir=None):
    target_dir = get_backups_dir(backups_dir)
    if not os.path.exists(target_dir):
        return []

    backups = []
    for file_name in os.listdir(target_dir):
        if not file_name.endswith(".json"):
            continue
        file_path = os.path.join(target_dir, file_name)
        try:
            stat = os.stat(file_path)
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and data.get("$schema") == "cmdbar-environment-snapshot/v1":
                backups.append({
                    "backup_id": file_name[:-5],
                    "file_name": file_name,
                    "file_path": file_path,
                    "snapshot_id": data.get("snapshot_id", "unknown"),
                    "timestamp": data.get("created_at", time.ctime(stat.st_mtime)),
                    "description": data.get("description", ""),
                    "size": stat.st_size
                })
        except Exception:
            pass

    backups.sort(key=lambda b: b.get("timestamp", ""), reverse=True)
    return backups

def import_snapshot(
    snapshot_data_or_path,
    mode="merge",
    config_path=None,
    clipboard_path=None,
    stylesheet_path=None,
    backups_dir=None,
    passphrase=None,
    create_backup_before_import=True,
    validate_only=False
):
    validation = validate_snapshot(snapshot_data_or_path, passphrase=passphrase)
    if not validation["valid"]:
        raise ValueError(f"Snapshot validation failed: {validation['error']}")

    snap = validation["snapshot"]
    if validate_only:
        return {"success": True, "validated": True, "snapshot": snap}

    cfg_path = config_path or get_config_path()
    clip_path = clipboard_path or os.path.join(os.path.dirname(cfg_path), "clipboard_history.json")
    style_path = stylesheet_path or os.path.join(os.path.dirname(cfg_path), "stylesheet.css")

    backup_info = None
    if create_backup_before_import:
        backup_info = create_backup(
            backups_dir=backups_dir,
            description=f"Pre-import backup before loading {snap['snapshot_id']}",
            config_path=cfg_path,
            clipboard_path=clip_path,
            stylesheet_path=style_path
        )

    if mode == "replace":
        if snap.get("config"):
            save_config(snap["config"])
        if snap.get("history") and isinstance(snap["history"].get("clipboard"), list):
            save_clipboard_history(snap["history"]["clipboard"], clip_path)
        if snap.get("themes") and snap["themes"].get("custom_stylesheet") is not None:
            os.makedirs(os.path.dirname(style_path), exist_ok=True)
            with open(style_path, "w", encoding="utf-8") as f:
                f.write(snap["themes"].get("custom_stylesheet", ""))
    elif mode == "merge":
        if snap.get("config"):
            current_config = load_config()
            merged_config = merge_configs(current_config, snap["config"])
            save_config(merged_config)
        if snap.get("history") and isinstance(snap["history"].get("clipboard"), list):
            current_history = load_clipboard_history(clip_path)
            merged_history = merge_histories(current_history, snap["history"]["clipboard"])
            save_clipboard_history(merged_history, clip_path)
        if snap.get("themes") and snap["themes"].get("custom_stylesheet"):
            os.makedirs(os.path.dirname(style_path), exist_ok=True)
            current_css = ""
            if os.path.exists(style_path):
                try:
                    with open(style_path, "r", encoding="utf-8") as f:
                        current_css = f.read()
                except Exception:
                    pass
            new_css = snap["themes"]["custom_stylesheet"]
            if new_css not in current_css:
                merged_css = f"{current_css}\n/* Imported Theme */\n{new_css}" if current_css else new_css
                with open(style_path, "w", encoding="utf-8") as f:
                    f.write(merged_css)
    else:
        raise ValueError(f"Invalid import mode: {mode}. Must be 'merge' or 'replace'.")

    return {
        "success": True,
        "snapshot_id": snap["snapshot_id"],
        "mode": mode,
        "backup_path": backup_info["backup_path"] if backup_info else None
    }

def restore_backup(
    backup_id_or_path,
    backups_dir=None,
    config_path=None,
    clipboard_path=None,
    stylesheet_path=None
):
    target_file = backup_id_or_path
    if not os.path.exists(target_file):
        target_dir = get_backups_dir(backups_dir)
        cand1 = os.path.join(target_dir, f"{backup_id_or_path}.json")
        cand2 = os.path.join(target_dir, backup_id_or_path)
        if os.path.exists(cand1):
            target_file = cand1
        elif os.path.exists(cand2):
            target_file = cand2
        else:
            raise FileNotFoundError(f"Backup file not found: {backup_id_or_path}")

    return import_snapshot(
        target_file,
        mode="replace",
        config_path=config_path,
        clipboard_path=clipboard_path,
        stylesheet_path=stylesheet_path,
        backups_dir=backups_dir,
        create_backup_before_import=True
    )

def delete_backup(backup_id_or_path, backups_dir=None):
    target_file = backup_id_or_path
    if not os.path.exists(target_file):
        target_dir = get_backups_dir(backups_dir)
        cand1 = os.path.join(target_dir, f"{backup_id_or_path}.json")
        cand2 = os.path.join(target_dir, backup_id_or_path)
        if os.path.exists(cand1):
            target_file = cand1
        elif os.path.exists(cand2):
            target_file = cand2
        else:
            return False

    try:
        os.remove(target_file)
        return True
    except Exception:
        return False

def encode_shareable_payload(snapshot):
    json_str = snapshot if isinstance(snapshot, str) else json.dumps(snapshot)
    base64_bytes = base64.urlsafe_b64encode(json_str.encode('utf-8'))
    return f"cmdbar-snap://{base64_bytes.decode('utf-8')}"

def decode_shareable_payload(encoded_str):
    if not encoded_str or not isinstance(encoded_str, str):
        raise ValueError("Invalid encoded shareable payload string")
    clean_str = encoded_str.strip()
    if clean_str.startswith("cmdbar-snap://"):
        clean_str = clean_str[len("cmdbar-snap://"):]
    json_bytes = base64.urlsafe_b64decode(clean_str.encode('utf-8'))
    return json.loads(json_bytes.decode('utf-8'))

def share_snapshot_to_cloud(snapshot, cloud_config=None):
    cloud_config = cloud_config or {}
    endpoint = cloud_config.get("endpoint", "https://api.cmdbar.dev/v1/snapshots/share")
    payload = json.loads(snapshot) if isinstance(snapshot, str) else snapshot

    if callable(endpoint):
        return endpoint(payload, cloud_config)

    encoded = encode_shareable_payload(payload)
    return {
        "success": True,
        "snapshot_id": payload.get("snapshot_id"),
        "share_url": f"{endpoint}/{payload.get('snapshot_id')}",
        "shareable_link": encoded
    }

def fetch_snapshot_from_cloud(cloud_config=None):
    cloud_config = cloud_config or {}
    endpoint = cloud_config.get("endpoint")
    share_link = cloud_config.get("share_link")

    if callable(endpoint):
        return endpoint(cloud_config)
    if share_link:
        return decode_shareable_payload(share_link)

    raise ValueError("Cloud fetch requires callable endpoint or share_link string.")
