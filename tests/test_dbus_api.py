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
    assert "GetNotes" in method_names
    assert "GetNote" in method_names
    assert "AddNote" in method_names
    assert "DeleteNote" in method_names
    assert "GetScratchpad" in method_names
    assert "UpdateScratchpad" in method_names
    assert "SearchNotes" in method_names
    assert "ShareNoteLink" in method_names

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


def test_dbus_service_notes(temp_config):
    service = CmdBarDBusService()

    # Add Note
    created_json = service.add_note("D-Bus Note", "Content via DBus", json.dumps(["dbus", "test"]))
    assert created_json != ""
    created = json.loads(created_json)
    assert created["title"] == "D-Bus Note"

    # Get Notes
    notes_json = service.get_notes_json()
    notes = json.loads(notes_json)
    assert len(notes) == 1

    # Get Single Note
    single_json = service.get_note_json(created["id"])
    single = json.loads(single_json)
    assert single["id"] == created["id"]

    # Search Notes
    search_json = service.search_notes_json("DBus")
    search_results = json.loads(search_json)
    assert len(search_results) == 1

    # Share Note Link
    link = service.share_note_link(created["id"])
    assert "cmdbar://note/share?data=" in link

    # Scratchpad
    sp_json = service.get_scratchpad_json()
    sp = json.loads(sp_json)
    assert sp["isScratchpad"] is True

    updated_sp_json = service.update_scratchpad_json("Quick update")
    updated_sp = json.loads(updated_sp_json)
    assert updated_sp["content"] == "Quick update"

    # Delete Note
    deleted = service.delete_note(created["id"])
    assert deleted is True
    assert service.get_note_json(created["id"]) == ""

