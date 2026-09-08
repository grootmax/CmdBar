import pytest
import time
from companion.notes import (
    create_note,
    update_note,
    delete_note,
    get_note_by_id,
    search_notes,
    organize_by_tag,
    render_markdown,
    generate_share_link,
    parse_share_link,
    sync_notes,
)
from companion.dbus_service import CmdBarDBusService

def test_create_note():
    note = create_note(
        title="Python Test Note",
        content="# Header\n* Item 1\n* Item 2",
        tags=["python", "test", "python"],
        attached_command="echo 'Hello'",
        pinned=True,
    )
    assert note["id"].startswith("note_")
    assert note["title"] == "Python Test Note"
    assert note["tags"] == ["python", "test"]
    assert note["attachedCommand"] == "echo 'Hello'"
    assert note["pinned"] is True
    assert "createdAt" in note
    assert "updatedAt" in note

def test_update_and_delete_note():
    note = create_note(title="Initial Title")
    notes = [note]

    updated = update_note(notes, note["id"], {"title": "New Title", "tags": ["updated"]})
    assert len(updated) == 1
    assert updated[0]["title"] == "New Title"
    assert updated[0]["tags"] == ["updated"]

    remaining = delete_note(updated, note["id"])
    assert len(remaining) == 0

def test_search_and_tag_organization():
    n1 = create_note(title="Deploy AWS", content="Deploying ECS task", tags=["aws", "devops"])
    n2 = create_note(title="Grocery", content="Buy apples", tags=["personal"])
    notes = [n1, n2]

    found = search_notes(notes, "ECS")
    assert len(found) == 1
    assert found[0]["title"] == "Deploy AWS"

    found_tag = search_notes(notes, "tag:personal")
    assert len(found_tag) == 1
    assert found_tag[0]["title"] == "Grocery"

    org = organize_by_tag(notes)
    assert "aws" in org["tags"]
    assert "personal" in org["tags"]

def test_render_markdown_python():
    md = "# Header\n**Bold** and `code`"
    rendered = render_markdown(md)
    assert "<h1>Header</h1>" in rendered["html"]
    assert "<strong>Bold</strong>" in rendered["html"]
    assert "<code>code</code>" in rendered["html"]
    assert "<b><span size=\"large\">Header</span></b>" in rendered["pango"]

def test_share_link_python():
    note = create_note(title="Share Test", content="Share content", tags=["share"])
    link = generate_share_link(note)
    assert link.startswith("cmdbar://note/share?data=")

    parsed = parse_share_link(link)
    assert parsed is not None
    assert parsed["title"] == "Share Test"
    assert parsed["content"] == "Share content"
    assert parsed["tags"] == ["share"]

def test_sync_notes_python():
    n_id = "note_fixed_123"
    local_note = {"id": n_id, "title": "Old Title", "updatedAt": "2026-08-23T10:00:00Z"}
    remote_note = {"id": n_id, "title": "Newer Title", "updatedAt": "2026-08-23T12:00:00Z"}

    synced = sync_notes([local_note], [remote_note])
    assert len(synced) == 1
    assert synced[0]["title"] == "Newer Title"

def test_dbus_service_notes(tmp_path, monkeypatch):
    config_file = tmp_path / "config.json"
    monkeypatch.setenv("CMDBAR_CONFIG_PATH", str(config_file))

    service = CmdBarDBusService(config_path=str(config_file))
    
    # Add note
    added = service.add_note("DBus Note", "DBus Content", "dbus,test", "echo hi")
    assert added["title"] == "DBus Note"

    # Get notes
    notes = service.get_notes()
    assert len(notes) == 1

    # Search notes
    results = service.search_notes("DBus")
    assert len(results) == 1

    # Share link
    share_url = service.share_note_link(added["id"])
    assert "cmdbar://note/share" in share_url

    # Import link
    imported = service.import_note_link(share_url)
    assert imported["title"] == "DBus Note"
    assert len(service.get_notes()) == 2
