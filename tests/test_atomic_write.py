import os
import stat
import json
import tempfile
import pytest
from unittest.mock import patch
from app.atomic_write import atomic_write, atomic_write_json
from app.config_schema import save_config, load_config


def test_python_atomic_write_success():
    with tempfile.TemporaryDirectory() as tmpdir:
        target_path = os.path.join(tmpdir, "config.json")
        data = {"categories": [{"name": "Test", "commands": []}]}

        atomic_write_json(target_path, data)

        assert os.path.exists(target_path)
        assert not os.path.exists(target_path + ".tmp")
        with open(target_path, "r") as f:
            assert json.load(f) == data


def test_python_atomic_write_failure_cleans_tmp_and_preserves_original():
    with tempfile.TemporaryDirectory() as tmpdir:
        target_path = os.path.join(tmpdir, "config.json")
        original_data = {"key": "original_valid"}
        atomic_write_json(target_path, original_data)

        # Simulate an error during open/write to temporary file
        with patch("os.replace", side_effect=OSError("Simulated replace error")):
            with pytest.raises(OSError, match="Simulated replace error"):
                atomic_write_json(target_path, {"key": "corrupted"})

        # Temp file must be unlinked immediately
        assert not os.path.exists(target_path + ".tmp")

        # Original configuration file must remain untouched and valid
        with open(target_path, "r") as f:
            assert json.load(f) == original_data


def test_python_atomic_write_preserves_file_permissions():
    with tempfile.TemporaryDirectory() as tmpdir:
        target_path = os.path.join(tmpdir, "config.json")
        atomic_write_json(target_path, {"version": 1})

        # Set restrictive permissions (0o600: read/write user only)
        os.chmod(target_path, 0o600)
        initial_mode = stat.S_IMODE(os.stat(target_path).st_mode)

        # Update config atomically
        atomic_write_json(target_path, {"version": 2})

        new_mode = stat.S_IMODE(os.stat(target_path).st_mode)
        assert new_mode == initial_mode == 0o600


def test_schema_save_config_uses_atomic_replacement():
    with tempfile.TemporaryDirectory() as tmpdir:
        target_path = os.path.join(tmpdir, "config.json")
        data = {"categories": [{"name": "Schema Test", "commands": []}]}

        save_config(data, target_path)

        assert os.path.exists(target_path)
        assert not os.path.exists(target_path + ".tmp")
        assert load_config(target_path)["categories"][0]["name"] == "Schema Test"
