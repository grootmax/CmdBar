import pytest
from app.config_schema import validate_parameter_value, resolve_command_preview

def test_validate_parameter_value_success():
    schema = {
        "name": "host",
        "regex": "^[a-zA-Z0-9.-]+$",
        "error_message": "Invalid host format!"
    }
    
    is_valid, err_msg = validate_parameter_value("google.com", schema)
    assert is_valid
    assert err_msg is None

def test_validate_parameter_value_forbidden_chars():
    schema = {
        "name": "host",
        "regex": "^[a-zA-Z0-9.-]+$"
    }
    
    # Semicolon is forbidden
    is_valid, err_msg = validate_parameter_value("google.com; rm -rf /", schema)
    assert not is_valid
    assert "forbidden" in err_msg.lower()

    # Double ampersand is forbidden
    is_valid, err_msg = validate_parameter_value("google.com && whoami", schema)
    assert not is_valid
    assert "forbidden" in err_msg.lower()

def test_validate_parameter_value_regex_failure():
    schema = {
        "name": "host",
        "regex": "^[a-zA-Z0-9.-]+$",
        "error_message": "Invalid host format!"
    }
    
    is_valid, err_msg = validate_parameter_value("google.com/path", schema)
    assert not is_valid
    assert err_msg == "Invalid host format!"

def test_resolve_command_preview_shell_quoted():
    template = "ping -c 3 <host>"
    schema = [
        {"name": "host", "regex": "^[a-zA-Z0-9.-]+$"}
    ]
    
    resolved, errors = resolve_command_preview(template, "shell-quoted", {"host": "google.com"}, schema)
    assert resolved == "ping -c 3 google.com"
    assert not errors

    # Single brace {host}
    single_template = "git checkout {branch}"
    single_schema = [{"name": "branch"}]
    resolved, errors = resolve_command_preview(single_template, "shell-quoted", {"branch": "main"}, single_schema)
    assert resolved == "git checkout main"
    assert not errors

    # Double brace {{host}} and mixed syntaxes
    mixed_template = "aws ecs --service {{service}} --id {task} --host <host>"
    mixed_schema = [{"name": "service"}, {"name": "task"}, {"name": "host"}]
    resolved, errors = resolve_command_preview(mixed_template, "shell-quoted", {"service": "auth-api", "task": "123", "host": "prod.com"}, mixed_schema)
    assert resolved == "aws ecs --service auth-api --id 123 --host prod.com"
    assert not errors

    # Quote characters inside param
    resolved, errors = resolve_command_preview(template, "shell-quoted", {"host": "google's.com"}, schema)
    # shlex.quote("google's.com") -> '"google'\''s.com"' or similar
    assert "google" in resolved
    assert "'" in resolved

def test_resolve_command_preview_direct_array():
    template = "/usr/bin/echo \"Hello\" <arg>"
    schema = [
        {"name": "arg", "regex": "^[a-zA-Z0-9_]+$"}
    ]
    
    resolved, errors = resolve_command_preview(template, "direct-array", {"arg": "world"}, schema)
    assert "world" in resolved
    assert "Args List:" in resolved
    assert '["/usr/bin/echo", "Hello", "world"]' in resolved

def test_validate_parameter_value_secure_redaction():
    schema = {
        "name": "password",
        "regex": "^[a-zA-Z0-9]+$",
        "secure": True,
        "error_message": "Invalid password!"
    }
    # Test forbidden character check redaction
    is_valid, err_msg = validate_parameter_value("my;password", schema)
    assert not is_valid
    assert "my;password" not in err_msg
    
    # Test regex mismatch error redaction
    is_valid, err_msg = validate_parameter_value("my_password", schema)
    assert not is_valid
    assert "my_password" not in err_msg

def test_resolve_command_preview_secure_masking():
    template = "login -p <password>"
    schema = [
        {"name": "password", "regex": "^[a-zA-Z0-9]+$", "secure": True}
    ]
    resolved, errors = resolve_command_preview(template, "shell-quoted", {"password": "secretPassword"}, schema)
    assert resolved == "login -p '**************'"
    assert "secretPassword" not in resolved
    assert not errors

def test_validate_parameter_value_strips_whitespace():
    schema = {
        "name": "host",
        "regex": "^[a-zA-Z0-9.-]+$",
        "error_message": "Invalid host format!"
    }
    # validate_parameter_value should strip the string before validating against the regex
    is_valid, err_msg = validate_parameter_value("  google.com  ", schema)
    assert is_valid
    assert err_msg is None

    # resolve_command_preview should use stripped value
    template = "ping -c 3 <host>"
    resolved, errors = resolve_command_preview(template, "shell-quoted", {"host": "  google.com  "}, [schema])
    assert resolved == "ping -c 3 google.com"
    assert not errors


def test_schema_save_config_atomic_and_locking(tmp_path, monkeypatch):
    import os
    import json
    import time
    from app.config_schema import save_config, load_config

    config_file = str(tmp_path / "config.json")
    renamed_pairs = []
    real_replace = os.replace

    def spy_replace(src, dst):
        renamed_pairs.append((src, dst))
        return real_replace(src, dst)

    monkeypatch.setattr(os, "replace", spy_replace)

    data = {"categories": [{"name": "Schema Test", "commands": []}]}
    save_config(data, config_file)

    assert len(renamed_pairs) == 1
    src, dst = renamed_pairs[0]
    assert dst == config_file
    assert src.endswith(".tmp")
    assert os.path.dirname(src) == os.path.dirname(config_file)

    loaded = load_config(config_file)
    assert loaded["categories"][0]["name"] == "Schema Test"

    # Ensure lock file is cleaned up
    assert not os.path.exists(config_file + ".lock")


def test_schema_load_config_preserves_corrupted_file(tmp_path):
    from app.config_schema import load_config, DEFAULT_CONFIG

    config_file = str(tmp_path / "config.json")
    corrupt_str = "BAD_JSON { {"
    with open(config_file, "w") as f:
        f.write(corrupt_str)

    loaded = load_config(config_file)
    assert loaded == DEFAULT_CONFIG

    # File on disk must remain uncorrupted/unmodified exactly as written
    with open(config_file, "r") as f:
        content = f.read()
    assert content == corrupt_str


