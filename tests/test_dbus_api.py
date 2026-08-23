import os
import json
import pytest
import xml.etree.ElementTree as ET
from companion.dbus_service import CmdBarDBusService
from companion.dbus_client import CmdBarDBusClient
from companion.companion_app import load_config, save_config

@pytest.fixture
def temp_config(tmp_path, monkeypatch):
    config_file = tmp_path / "config.json"
    monkeypatch.setenv("CMDBAR_CONFIG_PATH", str(config_file))
    initial_config = {
        "categories": [
            {
                "name": "Projects",
                "commands": [
                    {"name": "Initial Test", "template": "echo 'hello'"}
                ]
            }
        ]
    }
    save_config(initial_config)
    return config_file

def test_dbus_xml_interface_file():
    xml_path = os.path.join(os.path.dirname(__file__), "..", "extension", "org.gnome.CmdBar.xml")
    assert os.path.exists(xml_path), "DBus interface XML file should exist"

    tree = ET.parse(xml_path)
    root = tree.getroot()

    iface = root.find("interface[@name='org.gnome.CmdBar']")
    assert iface is not None, "org.gnome.CmdBar interface must be defined in XML"

    method_names = [m.get("name") for m in iface.findall("method")]
    assert "AddCommand" in method_names
    assert "RemoveCommand" in method_names
    assert "ExecuteCommand" in method_names
    assert "GetCommands" in method_names

    signal_names = [s.get("name") for s in iface.findall("signal")]
    assert "CommandExecuted" in signal_names
    assert "CommandOutput" in signal_names

def test_dbus_service_add_command(temp_config):
    service = CmdBarDBusService()
    client = CmdBarDBusClient(service=service)

    success = client.add_command("Dynamic Build", "make build-dynamic", "Automation")
    assert success is True

    cmds = client.get_commands()
    assert any(c["name"] == "Dynamic Build" and c["category"] == "Automation" for c in cmds)

    config = load_config()
    auto_cat = next((c for c in config["categories"] if c["name"] == "Automation"), None)
    assert auto_cat is not None
    assert any(cmd["name"] == "Dynamic Build" for cmd in auto_cat["commands"])

def test_dbus_service_remove_command(temp_config):
    service = CmdBarDBusService()
    client = CmdBarDBusClient(service=service)

    client.add_command("Temp Cmd", "echo temp", "Tools")
    assert any(c["name"] == "Temp Cmd" for c in client.get_commands())

    removed = client.remove_command("Temp Cmd")
    assert removed is True
    assert not any(c["name"] == "Temp Cmd" for c in client.get_commands())

def test_dbus_service_execute_command(temp_config):
    service = CmdBarDBusService()
    client = CmdBarDBusClient(service=service)

    executed_events = []
    output_events = []

    client.on_command_executed(lambda name, code, success: executed_events.append((name, code, success)))
    client.on_command_output(lambda name, stdout, stderr: output_events.append((name, stdout, stderr)))

    client.add_command("Echo Hello", "echo 'hello world'", "Testing")
    res = client.execute_command("Echo Hello")
    assert res is True

    assert len(executed_events) == 1
    assert executed_events[0][0] == "Echo Hello"
    assert executed_events[0][1] == 0
    assert executed_events[0][2] is True

    assert len(output_events) == 1
    assert output_events[0][0] == "Echo Hello"
    assert "hello world" in output_events[0][1]

def test_dbus_service_get_commands(temp_config):
    service = CmdBarDBusService()
    client = CmdBarDBusClient(service=service)

    cmds = client.get_commands()
    assert isinstance(cmds, list)
    assert len(cmds) >= 1
    assert cmds[0]["name"] == "Initial Test"
