import os
import tempfile
import time
import json
import pytest
from datetime import datetime, timedelta, timezone

from companion.audit_logger import (
    get_audit_log_path,
    get_current_user,
    is_sensitive_command,
    rotate_log_if_needed,
    log_command,
    read_audit_logs,
    clear_audit_log,
)

@pytest.fixture
def temp_audit_env():
    with tempfile.TemporaryDirectory() as tmpdir:
        custom_log = os.path.join(tmpdir, "audit.log")
        os.environ["CMDBAR_AUDIT_LOG_PATH"] = custom_log
        yield custom_log
        if "CMDBAR_AUDIT_LOG_PATH" in os.environ:
            del os.environ["CMDBAR_AUDIT_LOG_PATH"]

def test_get_audit_log_path_override(temp_audit_env):
    assert get_audit_log_path() == temp_audit_env

def test_get_current_user():
    user = get_current_user()
    assert isinstance(user, str)
    assert len(user) > 0

def test_is_sensitive_command():
    assert is_sensitive_command("echo mypassword") is True
    assert is_sensitive_command("curl -H 'Authorization: Bearer token123'") is True
    assert is_sensitive_command("sudo systemctl restart nginx") is True
    assert is_sensitive_command("ls -la") is False

    cmd_obj = {"secure": True}
    assert is_sensitive_command("run-script", cmd_obj=cmd_obj) is True

def test_log_command_success(temp_audit_env):
    config = {"audit": {"enabled": True, "privacy_mode": False}}
    success = log_command(
        command="make test",
        exit_code=0,
        duration_ms=120,
        user="testuser",
        config=config,
    )
    assert success is True
    assert os.path.exists(temp_audit_env)

    entries = read_audit_logs(temp_audit_env)
    assert len(entries) == 1
    entry = entries[0]
    assert entry["command"] == "make test"
    assert entry["exit_code"] == 0
    assert entry["duration_ms"] == 120
    assert entry["user"] == "testuser"
    assert "T" in entry["timestamp"]

def test_privacy_mode_excludes_sensitive(temp_audit_env):
    config = {"audit": {"enabled": True, "privacy_mode": True}}
    result = log_command(
        command="export API_KEY=secret_key_value",
        exit_code=0,
        duration_ms=10,
        config=config,
    )
    assert result is False
    assert not os.path.exists(temp_audit_env)

    result_safe = log_command(
        command="git diff",
        exit_code=0,
        duration_ms=15,
        config=config,
    )
    assert result_safe is True
    entries = read_audit_logs(temp_audit_env)
    assert len(entries) == 1
    assert entries[0]["command"] == "git diff"

def test_disabled_audit_logging(temp_audit_env):
    config = {"audit": {"enabled": False}}
    result = log_command("ls -la", 0, 5, config=config)
    assert result is False
    assert not os.path.exists(temp_audit_env)

def test_rotate_log_if_needed(temp_audit_env):
    # Write old log entry
    os.makedirs(os.path.dirname(temp_audit_env), exist_ok=True)
    with open(temp_audit_env, "w", encoding="utf-8") as f:
        f.write(json.dumps({"timestamp": "2026-08-01T10:00:00.000Z", "command": "old"}) + "\n")

    # Set mtime to yesterday
    yesterday = datetime.now(timezone.utc) - timedelta(days=1)
    yesterday_ts = yesterday.timestamp()
    os.utime(temp_audit_env, (yesterday_ts, yesterday_ts))

    yesterday_str = yesterday.strftime("%Y-%m-%d")

    rotate_log_if_needed(temp_audit_env)

    rotated_path = f"{temp_audit_env}.{yesterday_str}"
    assert os.path.exists(rotated_path)
    assert not os.path.exists(temp_audit_env)

def test_clear_audit_log(temp_audit_env):
    log_command("echo hello", 0, 5)
    assert os.path.exists(temp_audit_env)

    clear_audit_log(temp_audit_env)
    assert not os.path.exists(temp_audit_env)
