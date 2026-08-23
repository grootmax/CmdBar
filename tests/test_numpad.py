import json
import pytest
from app.config_schema import DEFAULT_CONFIG
from companion.dbus_service import CmdBarDBusService
from companion.dbus_client import CmdBarDBusClient

def test_default_config_contains_numpad():
    assert "numpad" in DEFAULT_CONFIG
    numpad = DEFAULT_CONFIG["numpad"]
    assert numpad["enabled"] is True
    assert numpad["active_layer"] == 0
    assert len(numpad["layers"]) >= 2
    assert "keys" in numpad["layers"][0]
    assert "0" in numpad["layers"][0]["keys"]

def test_dbus_service_numpad_methods(tmp_path):
    service = CmdBarDBusService()
    numpad = service.get_numpad_layers()
    assert isinstance(numpad, dict)
    assert numpad.get("enabled") is True

    json_str = service.get_numpad_layers_json()
    assert isinstance(json_str, str)
    assert "layers" in json_str

    res_layer = service.set_active_numpad_layer(1)
    assert res_layer is True

    res_exec = service.execute_numpad_key(0)
    assert isinstance(res_exec, bool)

    res_overlay = service.toggle_numpad_overlay()
    assert res_overlay is True

def test_dbus_client_numpad_methods():
    service = CmdBarDBusService()
    client = CmdBarDBusClient(service=service)

    numpad = client.get_numpad_layers()
    assert isinstance(numpad, dict)

    res_layer = client.set_active_numpad_layer(0)
    assert res_layer is True

    res_exec = client.execute_numpad_key(0)
    assert isinstance(res_exec, bool)

    res_overlay = client.toggle_numpad_overlay()
    assert res_overlay is True
