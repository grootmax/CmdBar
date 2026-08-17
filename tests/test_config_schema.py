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

