"""
Unit tests for CmdBar Python Companion Plugin Manager.
"""

import tempfile
import shutil
from pathlib import Path
import pytest

from companion.plugin_manager import (
    PythonPluginManager,
    get_plugins_dir,
    validate_manifest,
)


def test_validate_manifest():
    valid_manifest = {
        "id": "my-plugin",
        "name": "My Plugin",
        "version": "1.0.0",
        "permissions": ["commands", "clipboard"],
    }
    valid, errors, clean = validate_manifest(valid_manifest)
    assert valid is True
    assert len(errors) == 0
    assert clean["id"] == "my-plugin"

    invalid_manifest = {"id": "invalid name space"}
    valid, errors, clean = validate_manifest(invalid_manifest)
    assert valid is False
    assert len(errors) > 0


def test_python_plugin_manager_lifecycle():
    temp_dir = Path(tempfile.mkdtemp())
    try:
        manager = PythonPluginManager(plugins_dir=temp_dir)

        manifest = {
            "id": "py-plugin",
            "name": "Python Companion Plugin",
            "version": "1.0.0",
            "description": "Test plugin for Python manager",
            "permissions": ["commands"],
        }
        main_code = "console.log('hello');"

        installed = manager.install_plugin(manifest, main_code)
        assert installed["manifest"]["id"] == "py-plugin"

        discovered = manager.discover_plugins()
        assert len(discovered) == 1
        assert discovered[0]["manifest"]["id"] == "py-plugin"

        plugins_list = manager.list_plugins()
        assert len(plugins_list) == 1

        uninstalled = manager.uninstall_plugin("py-plugin")
        assert uninstalled is True
        assert len(manager.discover_plugins()) == 0

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
