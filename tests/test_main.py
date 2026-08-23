import pytest
import os
import tempfile
import json
from app.config_schema import load_config, save_config
from app.main import CmdBarApp, set_uniform_margin

def test_app_config_initialization():
    # Verify app loads default config
    app = CmdBarApp()
    assert app.config is not None
    assert "categories" in app.config
    assert len(app.config["categories"]) > 0

def test_app_config_saving():
    with tempfile.TemporaryDirectory() as tmpdir:
        config_file = os.path.join(tmpdir, "config.json")
        
        test_config = {
            "categories": [
                {
                    "name": "Custom Category",
                    "commands": [
                        {
                            "name": "Test CMD",
                            "command": "echo <msg>",
                            "mode": "shell-quoted",
                            "parameters": [
                                {
                                    "name": "msg",
                                    "regex": "^[a-z]+$"
                                }
                            ]
                        }
                    ]
                }
            ]
        }
        
        # Save config to custom location
        save_config(test_config, config_file)
        
        # Verify file exists and is populated
        assert os.path.exists(config_file)
        
        # Load from that location
        loaded = load_config(config_file)
        assert loaded["categories"][0]["name"] == "Custom Category"
        assert loaded["categories"][0]["commands"][0]["name"] == "Test CMD"

def test_legacy_commands_json_migration():
    with tempfile.TemporaryDirectory() as tmpdir:
        config_file = os.path.join(tmpdir, "config.json")
        legacy_file = os.path.join(tmpdir, "commands.json")
        
        legacy_config = {
            "categories": [
                {
                    "name": "Legacy Category",
                    "shortcuts": [
                        {
                            "name": "Legacy Echo",
                            "command": "echo hello"
                        }
                    ]
                }
            ]
        }
        
        with open(legacy_file, "w") as f:
            json.dump(legacy_config, f, indent=2)
            
        # Load from config_file path (which does not exist yet)
        # Should fallback, migrate, save to config.json, and delete commands.json
        loaded = load_config(config_file)
        
        assert loaded["categories"][0]["name"] == "Legacy Category"
        assert loaded["categories"][0]["commands"][0]["name"] == "Legacy Echo"
        assert os.path.exists(config_file)
        assert not os.path.exists(legacy_file)

def test_cli_companion_compatibility_translation():
    with tempfile.TemporaryDirectory() as tmpdir:
        config_file = os.path.join(tmpdir, "config.json")
        
        cli_config = {
            "categories": [
                {
                    "name": "CLI Category",
                    "commands": [
                        {
                            "name": "CLI Run",
                            "template": "run {param1}",
                            "parameters": {
                                "param1": {
                                    "regex": "^[a-z]+$",
                                    "placeholder": "Enter param"
                                }
                            }
                        }
                    ]
                }
            ]
        }
        
        save_config(cli_config, config_file)
            
        # Load and normalize
        loaded = load_config(config_file)
        
        cmd = loaded["categories"][0]["commands"][0]
        assert cmd["command"] == "run {param1}"
        assert isinstance(cmd["parameters"], dict)
        assert "param1" in cmd["parameters"]
        assert cmd["parameters"]["param1"]["regex"] == "^[a-z]+$"
        assert cmd["parameters"]["param1"]["placeholder"] == "Enter param"


def test_main_set_uniform_margin():
    from unittest.mock import MagicMock
    mock_box = MagicMock()
    set_uniform_margin(mock_box, 24)

    mock_box.set_margin_top.assert_called_once_with(24)
    mock_box.set_margin_bottom.assert_called_once_with(24)
    mock_box.set_margin_start.assert_called_once_with(24)
    mock_box.set_margin_end.assert_called_once_with(24)


