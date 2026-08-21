import os
import tempfile
import json
import re
import shlex
import subprocess
import time
import pytest

from companion.companion_app import (
    get_config_path,
    init_config,
    load_config,
    save_config,
    validate_input,
    find_placeholders,
    substitute_and_quote_command,
    run_command_in_shell
)

# Test configuration path override using environment variables
@pytest.fixture
def temp_config_file():
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        tmp_path = tmp.name
    # Override environment variable
    os.environ['CMDBAR_CONFIG_PATH'] = tmp_path
    yield tmp_path
    # Clean up
    if os.path.exists(tmp_path):
        os.remove(tmp_path)
    if os.path.exists(tmp_path + ".tmp"):
        os.remove(tmp_path + ".tmp")
    os.environ.pop('CMDBAR_CONFIG_PATH', None)


def test_init_and_load_config(temp_config_file):
    # Ensure config path is overridden
    assert get_config_path() == temp_config_file
    
    # Check that file doesn't exist yet
    if os.path.exists(temp_config_file):
        os.remove(temp_config_file)
        
    # Init config and check default file structure
    path = init_config()
    assert path == temp_config_file
    assert os.path.exists(temp_config_file)
    
    config_data = load_config()
    assert "categories" in config_data
    assert len(config_data["categories"]) > 0
    assert config_data["categories"][0]["name"] == "Projects"


def test_save_and_load_config(temp_config_file):
    init_config()
    custom_config = {
        "categories": [
            {
                "name": "Custom Category",
                "commands": [
                    {
                        "name": "Custom Echo",
                        "template": "echo {msg}",
                        "parameters": {
                            "msg": {
                                "placeholder": "Enter message"
                            }
                        }
                    }
                ]
            }
        ]
    }
    
    success = save_config(custom_config)
    assert success is True
    
    loaded = load_config()
    assert loaded["categories"][0]["name"] == "Custom Category"
    assert loaded["categories"][0]["commands"][0]["name"] == "Custom Echo"


def test_validate_input_default_pattern():
    # When no pattern is provided, it must default to ^[a-zA-Z0-9_\-]+$
    
    # Valid values (alphanumeric, underscore, hyphen)
    assert validate_input("validInput123") is True
    assert validate_input("valid_input_123") is True
    assert validate_input("valid-input-123") is True
    assert validate_input("a") is True
    assert validate_input("1") is True
    assert validate_input("_") is True
    assert validate_input("-") is True
    
    # Invalid values (spaces, special symbols, empty string if pattern requires at least 1 char)
    assert validate_input("invalid input") is False  # contains space
    assert validate_input("invalid;input") is False  # contains semicolon
    assert validate_input("invalid&input") is False  # contains ampersand
    assert validate_input("invalid|input") is False  # contains pipe
    assert validate_input("") is False              # empty string
    assert validate_input("hello$world") is False    # contains dollar sign


def test_validate_input_custom_pattern():
    # Alphanumeric plus period and slash (e.g. for branches/urls)
    custom_pattern = r"^[a-zA-Z0-9_\-/\\.]+$"
    
    assert validate_input("feature/safe-quoting", custom_pattern) is True
    assert validate_input("v1.0.3-release", custom_pattern) is True
    assert validate_input("some\\path", custom_pattern) is True
    
    # Invalid
    assert validate_input("feature/safe quoting", custom_pattern) is False  # space
    assert validate_input("feature; rm -rf", custom_pattern) is False       # semicolon


def test_find_placeholders():
    assert find_placeholders("git checkout {branch}") == ["branch"]
    assert find_placeholders("docker run -d {image} {tag}") == ["image", "tag"]
    assert find_placeholders("deploy {{service}}") == ["service"]
    assert find_placeholders("ping <host>") == ["host"]
    assert find_placeholders("aws ecs update --service {{service}} --id {task} --host <host>") == ["service", "task", "host"]
    assert find_placeholders("echo hello") == []
    assert find_placeholders("echo {name} is {adjective}") == ["name", "adjective"]


def test_substitute_and_quote_command():
    # Test multi-syntax placeholder substitution
    mixed_template = "aws ecs update --service {{service}} --id {task} --host <host>"
    mixed_params = {"service": "auth-api", "task": "123", "host": "prod host"}
    mixed_cmd = substitute_and_quote_command(mixed_template, mixed_params)
    assert "auth-api" in mixed_cmd
    assert "123" in mixed_cmd
    assert "'prod host'" in mixed_cmd

    # Verify that single-quoting works and is applied via shlex.quote
    template = "git checkout {branch}"
    params = {"branch": "feature/safe-quoting"}
    cmd = substitute_and_quote_command(template, params)
    # Since feature/safe-quoting has no shell special characters, shlex might not wrap it in single quotes
    # but it is safely escaped.
    assert "feature/safe-quoting" in cmd
    
    # An argument containing spaces MUST be enclosed in single quotes by shlex.quote
    params_with_spaces = {"branch": "feature/my new branch"}
    cmd_with_spaces = substitute_and_quote_command(template, params_with_spaces)
    # Verify it is single quoted
    assert "'feature/my new branch'" in cmd_with_spaces
    
    # Verify that malicious shell character sequences are fully quoted and neutralized
    malicious_params = {"branch": "feature; rm -rf /"}
    cmd_malicious = substitute_and_quote_command(template, malicious_params)
    assert "'feature; rm -rf /'" in cmd_malicious or '"feature; rm -rf /"' in cmd_malicious


def test_execution_security_and_correctness():
    # Verify that commands with spaces in parameter values execute correctly in a single argument
    # We use python's command line to echo back the argument length and content.
    # The template runs a python script that prints sys.argv to see how the arguments were parsed.
    template = "python3 -c 'import sys; print(len(sys.argv), sys.argv[1])' {arg}"
    
    # Normal input
    params_normal = {"arg": "hello"}
    cmd_normal = substitute_and_quote_command(template, params_normal)
    code, out, err = run_command_in_shell(cmd_normal)
    assert code == 0
    # sys.argv is [ "-c", "hello" ] -> len 2, argv[1] is hello
    assert "2 hello" in out.strip()
    
    # Input with spaces
    params_space = {"arg": "hello world from cmdbar"}
    cmd_space = substitute_and_quote_command(template, params_space)
    code, out, err = run_command_in_shell(cmd_space)
    assert code == 0
    # Should execute successfully as a single argument containing spaces, not split!
    assert "2 hello world from cmdbar" in out.strip()
    
    # Command injection attempt with semicolon
    # If injection succeeded, it would run `echo injected` as a separate command.
    # If quoting succeeded, it will print as a single literal argument.
    template_inject = "python3 -c 'import sys; print(sys.argv[1])' {arg}"
    params_inject = {"arg": "hello; echo INJECTED_OUTPUT"}
    cmd_inject = substitute_and_quote_command(template_inject, params_inject)
    code, out, err = run_command_in_shell(cmd_inject)
    assert code == 0
    assert out.strip() == "hello; echo INJECTED_OUTPUT"

    # Command injection attempt with pipe
    params_pipe = {"arg": "hello | echo INJECTED_PIPE"}
    cmd_pipe = substitute_and_quote_command(template_inject, params_pipe)
    code, out, err = run_command_in_shell(cmd_pipe)
    assert code == 0
    assert out.strip() == "hello | echo INJECTED_PIPE"


def test_test_command_dialog_async_and_cancellation():
    import signal
    from unittest.mock import MagicMock, patch
    from companion.companion_app import TestCommandDialog, Gio, Gtk

    command = {
        "name": "Test Echo",
        "template": "echo {msg}",
        "parameters": {
            "msg": {
                "placeholder": "Enter message"
            }
        }
    }

    mock_proc = MagicMock()
    mock_proc.get_identifier.return_value = "12345"

    mock_cancellable = MagicMock()
    mock_cancellable.is_cancelled.return_value = False

    # Mock Gio.Subprocess.new and Gio.Cancellable directly on the imported Gio mock
    old_subproc_new = Gio.Subprocess.new
    old_cancellable = Gio.Cancellable
    Gio.Subprocess.new = MagicMock(return_value=mock_proc)
    Gio.Cancellable = MagicMock(return_value=mock_cancellable)

    # Mock Gtk.Entry to avoid GError / validate_input exception on mock objects
    old_entry = Gtk.Entry
    mock_entry = MagicMock()
    mock_entry.get_text.return_value = "hello"
    Gtk.Entry = MagicMock(return_value=mock_entry)

    try:
        with patch("os.killpg") as mock_killpg:
            dialog = TestCommandDialog(None, command, None)
            
            # Trigger run
            dialog.on_run_clicked(None)

            # Verify process is created and asynchronous run is initiated
            assert dialog.proc == mock_proc
            assert dialog.cancellable == mock_cancellable
            Gio.Subprocess.new.assert_called_once()
            mock_proc.communicate_utf8_async.assert_called_once()

            # Test cancellation
            dialog.on_cancel_test_clicked(None)
            mock_cancellable.cancel.assert_called_once()
            mock_killpg.assert_called_once_with(12345, signal.SIGTERM)
            mock_proc.force_exit.assert_called_once()
    finally:
        # Restore mock state
        Gio.Subprocess.new = old_subproc_new
        Gio.Cancellable = old_cancellable
        Gtk.Entry = old_entry


def test_companion_validate_input_strips_whitespace():
    # Input with leading/trailing spaces should be stripped first
    assert validate_input("  validInput123  ") is True
    # If the stripped version is empty, it should be blocked
    assert validate_input("    ") is False

def test_companion_substitute_and_quote_command_strips_whitespace():
    template = "echo {msg}"
    params = {"msg": "  hello world  "}
    cmd = substitute_and_quote_command(template, params)
    # The leading/trailing spaces should be stripped, so it should be quoted as 'hello world'
    assert "'hello world'" in cmd or cmd.endswith("hello world")


def test_companion_atomic_save_uses_same_dir_tmp_file_and_lock(temp_config_file, monkeypatch):
    """
    Verifies that save_config writes to a temporary file in the same directory,
    atomically renames it, and respects cooperative file locking (.lock).
    """
    if os.path.exists(temp_config_file):
        os.remove(temp_config_file)
    init_config()
    written_files = []
    renamed_pairs = []

    real_open = open
    real_replace = os.replace

    def spy_replace(src, dst):
        renamed_pairs.append((src, dst))
        return real_replace(src, dst)

    monkeypatch.setattr(os, "replace", spy_replace)

    test_data = {"categories": [{"name": "Atomic Test", "commands": []}]}
    success = save_config(test_data)
    assert success is True

    # Check rename pair: src must be in same dir and end with .tmp
    assert len(renamed_pairs) >= 1
    src, dst = renamed_pairs[-1]
    assert dst == temp_config_file
    assert os.path.dirname(src) == os.path.dirname(temp_config_file)
    assert src.endswith(".tmp")

    # Lock file should be cleaned up after save completes
    lock_file = temp_config_file + ".lock"
    assert not os.path.exists(lock_file)


def test_companion_lock_file_blocks_concurrent_write(temp_config_file):
    """
    Verifies that a held cooperative lock file blocks concurrent save operations.
    """
    if os.path.exists(temp_config_file):
        os.remove(temp_config_file)
    init_config()
    lock_file = temp_config_file + ".lock"

    # Simulate another process holding the lock file
    with open(lock_file, "w") as f:
        json.dump({"pid": 99999, "timestamp": int(time.time() * 1000)}, f)

    test_data = {"categories": [{"name": "Blocked Save", "commands": []}]}
    # Attempting to save with a held non-stale lock should fail or time out
    success = save_config(test_data)
    assert success is False

    # Clean up lock file
    if os.path.exists(lock_file):
        os.remove(lock_file)


def test_companion_aborted_write_preserves_original_config(temp_config_file, monkeypatch):
    """
    Verifies that if a write operation is aborted midway, the original config file
    remains valid and unmodified on disk.
    """
    if os.path.exists(temp_config_file):
        os.remove(temp_config_file)
    init_config()
    original_data = load_config()
    assert original_data["categories"][0]["name"] == "Projects"

    # Mock json.dump to raise an Exception midway through writing
    def failing_json_dump(*args, **kwargs):
        raise IOError("Simulated power loss or write abort midway")

    monkeypatch.setattr(json, "dump", failing_json_dump)

    new_data = {"categories": [{"name": "Corrupted Data", "commands": []}]}
    success = save_config(new_data)
    assert success is False

    # Verify original configuration file is unmodified and valid on disk
    loaded_after_abort = load_config()
    assert loaded_after_abort["categories"][0]["name"] == "Projects"


def test_companion_load_corrupted_config_preserves_file_on_disk(temp_config_file):
    """
    Verifies that loading a corrupted config file returns default config in memory
    and DOES NOT overwrite or modify the corrupted file on disk.
    """
    corrupted_content = "INVALID_JSON_CORRUPTED { { {"
    with open(temp_config_file, "w") as f:
        f.write(corrupted_content)

    config = load_config()
    assert config == {"categories": []}

    # Verify file on disk is strictly preserved exactly as-is
    with open(temp_config_file, "r") as f:
        on_disk = f.read()
    assert on_disk == corrupted_content




