import pytest
import os
import tempfile
import json
from app.config_schema import load_config, save_config
from app.main import CmdBarApp

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
                    "shortcuts": [
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
        assert loaded["categories"][0]["shortcuts"][0]["name"] == "Test CMD"
