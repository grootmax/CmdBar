import os
import json
import getpass
from datetime import datetime, timezone

DEFAULT_SENSITIVE_KEYWORDS = [
    "password",
    "passwd",
    "secret",
    "token",
    "api_key",
    "apikey",
    "key",
    "credentials",
    "cred",
    "sudo",
    "auth",
    "bearer",
    "private_key",
]

def get_audit_log_path():
    if os.environ.get("CMDBAR_AUDIT_LOG_PATH"):
        return os.environ["CMDBAR_AUDIT_LOG_PATH"]
    
    data_home = os.environ.get("XDG_DATA_HOME")
    if data_home:
        return os.path.join(data_home, "cmdbar", "audit.log")
    return os.path.expanduser("~/.local/share/cmdbar/audit.log")

def get_current_user():
    return os.environ.get("USER") or os.environ.get("LOGNAME") or getpass.getuser()

def is_sensitive_command(command_str, cmd_obj=None, placeholder_map=None, config=None):
    if cmd_obj and (cmd_obj.get("secure") or cmd_obj.get("privacy") or cmd_obj.get("sensitive")):
        return True

    if cmd_obj and cmd_obj.get("parameters"):
        params = cmd_obj["parameters"]
        items = params if isinstance(params, list) else params.values()
        for item in items:
            if isinstance(item, dict) and item.get("secure"):
                return True

    keywords = DEFAULT_SENSITIVE_KEYWORDS
    if config and isinstance(config, dict):
        audit_cfg = config.get("audit", {})
        if isinstance(audit_cfg, dict) and isinstance(audit_cfg.get("sensitive_keywords"), list):
            keywords = audit_cfg["sensitive_keywords"]

    cmd_lower = (command_str or "").lower()
    for kw in keywords:
        if kw.lower() in cmd_lower:
            return True

    if placeholder_map and isinstance(placeholder_map, dict):
        for k, v in placeholder_map.items():
            k_lower = str(k).lower()
            for kw in keywords:
                if kw.lower() in k_lower:
                    return True

    return False

def rotate_log_if_needed(log_path=None):
    target_path = log_path or get_audit_log_path()
    if not os.path.exists(target_path):
        return

    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        mtime = os.path.getmtime(target_path)
        file_date_str = datetime.fromtimestamp(mtime, timezone.utc).strftime("%Y-%m-%d")
        if file_date_str != today_str:
            rotated_path = f"{target_path}.{file_date_str}"
            os.rename(target_path, rotated_path)
    except Exception as e:
        print(f"CmdBar AuditLogger: Python log rotation failed: {e}")

def log_command(command, exit_code=0, duration_ms=0, user=None, cmd_obj=None, placeholder_map=None, config=None):
    audit_cfg = (config.get("audit") if isinstance(config, dict) else None) or {}
    if audit_cfg.get("enabled") is False:
        return False

    privacy_mode = audit_cfg.get("privacy_mode") is True
    sensitive = is_sensitive_command(command, cmd_obj, placeholder_map, config)

    if privacy_mode and sensitive:
        return False

    log_path = get_audit_log_path()
    rotate_log_if_needed(log_path)

    os.makedirs(os.path.dirname(log_path), exist_ok=True)

    dur_val = int(round(float(duration_ms or 0)))
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "user": user or get_current_user(),
        "command": command or "",
        "exit_code": exit_code if isinstance(exit_code, int) else str(exit_code),
        "duration_ms": dur_val,
        "duration": f"{dur_val}ms"
    }

    line = json.dumps(entry) + "\n"
    try:
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(line)
        return True
    except Exception as e:
        print(f"CmdBar AuditLogger: Python write log failed: {e}")
        return False

def read_audit_logs(custom_path=None):
    log_path = custom_path or get_audit_log_path()
    if not os.path.exists(log_path):
        return []

    entries = []
    try:
        with open(log_path, "r", encoding="utf-8") as f:
            for line in f:
                line_str = line.strip()
                if not line_str:
                    continue
                try:
                    entries.append(json.loads(line_str))
                except Exception:
                    entries.append({"raw": line_str})
    except Exception as e:
        print(f"CmdBar AuditLogger: Python read log failed: {e}")

    return entries

def clear_audit_log(custom_path=None):
    log_path = custom_path or get_audit_log_path()
    if os.path.exists(log_path):
        try:
            os.remove(log_path)
            return True
        except Exception:
            return False
    return True
