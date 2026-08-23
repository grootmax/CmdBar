import os
import tempfile
import json
import re
import shlex
import subprocess
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
        "verified": True,
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


def test_tokenize_and_substitute_direct_array():
    from companion.companion_app import tokenize_and_substitute
    template = "git checkout {branch}"
    params = {"branch": "feature/safe-quoting"}
    argv = tokenize_and_substitute(template, params)
    assert argv == ["git", "checkout", "feature/safe-quoting"]


def test_get_preview_tokens_redacts_sensitive_parameters():
    from companion.companion_app import tokenize_and_substitute, get_preview_tokens
    template = "login -u {user} -p {password}"
    params = {"user": "jules", "password": "superSecretPassword123"}
    schema = [{"name": "password", "secure": True}]
    
    tokens = tokenize_and_substitute(template)
    preview = get_preview_tokens(tokens, params, schema)
    
    assert "superSecretPassword123" not in preview
    assert preview == ["login", "-u", "jules", "-p", "[REDACTED]"]


def test_unverified_modal_cancellation_halts_execution():
    from unittest.mock import MagicMock, patch
    from companion.companion_app import TestCommandDialog, Gio, Gtk

    command = {
        "name": "Unverified Test Command",
        "template": "echo {msg}",
        "verified": False,
        "parameters": {
            "msg": {
                "placeholder": "Enter message"
            }
        }
    }

    mock_proc_new = MagicMock()
    old_subproc_new = Gio.Subprocess.new
    Gio.Subprocess.new = mock_proc_new

    old_entry = Gtk.Entry
    mock_entry = MagicMock()
    mock_entry.get_text.return_value = "hello"
    Gtk.Entry = MagicMock(return_value=mock_entry)

    try:
        dialog = TestCommandDialog(None, command, None)
        
        # Patch on_response to simulate user cancelling the dialog
        def mock_cancel_response(dlg, response_id):
            dlg.destroy()
            # User clicks Cancel
            buffer = dialog.output_view.get_buffer()
            buffer.set_text("Execution cancelled by user confirmation dialog.\n")

        with patch("companion.companion_app.Adw") as mock_adw:
            mock_msg_dlg = MagicMock()
            mock_adw.MessageDialog.return_value = mock_msg_dlg
            
            # Simulate cancel response callback
            def fake_connect(event, cb):
                if event == "response":
                    cb(mock_msg_dlg, "cancel")
            mock_msg_dlg.connect.side_effect = fake_connect

            dialog.on_run_clicked(None)

            # Gio.Subprocess.new should NOT be called because execution was cancelled!
            mock_proc_new.assert_not_called()
            # Stored verification status must remain unchanged
            assert command.get("verified") is False
    finally:
        Gio.Subprocess.new = old_subproc_new
        Gtk.Entry = old_entry


def test_unverified_modal_approval_proceeds_with_execution():
    from unittest.mock import MagicMock, patch
    from companion.companion_app import TestCommandDialog, Gio, Gtk

    command = {
        "name": "Unverified Test Command",
        "template": "echo {msg}",
        "verified": False,
        "parameters": {
            "msg": {
                "placeholder": "Enter message"
            }
        }
    }

    mock_proc = MagicMock()
    mock_subproc_new = MagicMock(return_value=mock_proc)
    old_subproc_new = Gio.Subprocess.new
    Gio.Subprocess.new = mock_subproc_new

    old_entry = Gtk.Entry
    mock_entry = MagicMock()
    mock_entry.get_text.return_value = "hello_world"
    Gtk.Entry = MagicMock(return_value=mock_entry)

    try:
        dialog = TestCommandDialog(None, command, None)

        with patch("companion.companion_app.GUI_AVAILABLE", True), patch("companion.companion_app.Adw") as mock_adw:
            mock_msg_dlg = MagicMock()
            mock_adw.MessageDialog.return_value = mock_msg_dlg
            mock_adw.MessageDialog.new.return_value = mock_msg_dlg

            # Capture body argument passed to MessageDialog
            def fake_connect(event, cb):
                if event == "response":
                    cb(mock_msg_dlg, "execute")
            mock_msg_dlg.connect.side_effect = fake_connect

            dialog.on_run_clicked(None)

            # MessageDialog must be constructed with exact substituted command string in body
            call = mock_adw.MessageDialog.new.call_args or mock_adw.MessageDialog.call_args
            body_str = str(call)
            assert "hello_world" in body_str

            # Gio.Subprocess.new MUST be called after approval
            mock_subproc_new.assert_called_once()
            # Verification status must remain unchanged
            assert command["verified"] is False
    finally:
        Gio.Subprocess.new = old_subproc_new
        Gtk.Entry = old_entry


def test_verified_command_bypasses_confirmation_dialog():
    from unittest.mock import MagicMock, patch
    from companion.companion_app import TestCommandDialog, Gio, Gtk

    command = {
        "name": "Verified Command",
        "template": "echo {msg}",
        "verified": True,
        "parameters": {
            "msg": {
                "placeholder": "Enter message"
            }
        }
    }

    mock_proc = MagicMock()
    mock_subproc_new = MagicMock(return_value=mock_proc)
    old_subproc_new = Gio.Subprocess.new
    Gio.Subprocess.new = mock_subproc_new

    old_entry = Gtk.Entry
    mock_entry = MagicMock()
    mock_entry.get_text.return_value = "hello_world"
    Gtk.Entry = MagicMock(return_value=mock_entry)

    try:
        dialog = TestCommandDialog(None, command, None)

        with patch("companion.companion_app.Adw") as mock_adw:
            dialog.on_run_clicked(None)

            # MessageDialog must NOT be instantiated for verified commands
            mock_adw.MessageDialog.assert_not_called()
            # Execution starts immediately
            mock_subproc_new.assert_called_once()
    finally:
        Gio.Subprocess.new = old_subproc_new
        Gtk.Entry = old_entry






