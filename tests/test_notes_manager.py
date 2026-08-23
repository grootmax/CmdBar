#!/usr/bin/env python3
"""
Unit tests for companion/notes_manager.py (Quick Notes and Scratchpad).
"""

import os
import json
import tempfile
import pytest
from companion.notes_manager import (
    generate_note_id,
    normalize_note,
    create_note,
    get_note,
    update_note,
    delete_note,
    get_scratchpad,
    update_scratchpad,
    render_markdown,
    strip_markdown,
    search_notes,
    add_tag,
    remove_tag,
    filter_by_tag,
    get_all_tags,
    attach_command,
    detach_command,
    execute_note_command,
    generate_share_link,
    parse_share_link,
    import_from_share_link,
    merge_notes,
    save_notes_atomically,
    load_notes_atomically,
)


def test_generate_note_id():
    id1 = generate_note_id()
    id2 = generate_note_id()
    assert id1.startswith("note_")
    assert id2.startswith("note_")
    assert id1 != id2


def test_normalize_note():
    raw = {
        "title": " My Note ",
        "content": "Body text",
        "tags": ["Work", "WORK", "todo"],
        "attachedCommands": [{"name": "Build", "command": "make build"}],
    }
    note = normalize_note(raw)
    assert note["id"].startswith("note_")
    assert note["title"] == "My Note"
    assert note["content"] == "Body text"
    assert note["tags"] == ["work", "todo"]
    assert len(note["attachedCommands"]) == 1
    assert note["attachedCommands"][0]["name"] == "Build"
    assert note["attachedCommands"][0]["command"] == "make build"
    assert note["isScratchpad"] is False
    assert note["pinned"] is False
    assert "createdAt" in note
    assert "updatedAt" in note


def test_normalize_note_invalid():
    with pytest.raises(ValueError, match="Invalid note dictionary provided"):
        normalize_note(None)

    with pytest.raises(ValueError, match="Invalid note dictionary provided"):
        normalize_note("invalid")


def test_crud_operations():
    notes = []
    n1 = create_note(notes, title="Note 1", content="Content 1", tags=["tag1"])
    assert len(notes) == 1
    assert n1["title"] == "Note 1"

    found = get_note(notes, n1["id"])
    assert found == n1
    assert get_note(notes, "non-existent") is None

    updated = update_note(notes, n1["id"], title="Updated Note 1", content="New Content")
    assert updated["title"] == "Updated Note 1"
    assert updated["content"] == "New Content"

    assert update_note(notes, "non-existent", title="Fail") is None

    assert delete_note(notes, n1["id"]) is True
    assert len(notes) == 0
    assert delete_note(notes, n1["id"]) is False


def test_crud_invalid_input():
    with pytest.raises(ValueError, match="notes_list must be a list"):
        create_note("not-a-list")

    assert get_note(None, "id") is None
    assert delete_note(None, "id") is False


def test_scratchpad():
    notes = []
    sp = get_scratchpad(notes)
    assert sp["isScratchpad"] is True
    assert sp["id"] == "scratchpad"
    assert len(notes) == 1

    sp2 = get_scratchpad(notes)
    assert sp2 == sp

    updated_sp = update_scratchpad(notes, "Drafting quick note")
    assert updated_sp["content"] == "Drafting quick note"
    assert get_scratchpad(notes)["content"] == "Drafting quick note"


def test_render_markdown():
    md = """# Title
## Subtitle
### Heading 3
- Bullet 1
- [ ] Todo
- [x] Done
**bold** and *italic* and `code`
[CmdBar](https://cmdbar.app)
```
print("hello")
```"""

    html = render_markdown(md)
    assert "<h1>Title</h1>" in html
    assert "<h2>Subtitle</h2>" in html
    assert "<h3>Heading 3</h3>" in html
    assert "<li>Bullet 1</li>" in html
    assert '<input type="checkbox" disabled />' in html
    assert '<input type="checkbox" checked disabled />' in html
    assert "<strong>bold</strong>" in html
    assert "<em>italic</em>" in html
    assert "<code>code</code>" in html
    assert '<a href="https://cmdbar.app">CmdBar</a>' in html
    assert "<pre><code>" in html
    assert "print(&quot;hello&quot;)" in html


def test_render_markdown_empty():
    assert render_markdown("") == ""
    assert render_markdown(None) == ""


def test_strip_markdown():
    md = """# Header
**Bold** and *Italic* and `Code`
- Bullet
- [ ] Task
[Link](https://example.com)
```
code block
```"""
    plain = strip_markdown(md)
    assert "# Header" not in plain
    assert "**Bold**" not in plain
    assert "Header" in plain
    assert "Bold and Italic and Code" in plain
    assert "Bullet" in plain
    assert "Task" in plain
    assert "Link" in plain


def test_search_notes_and_tags():
    notes = [
        normalize_note({"title": "Deployment", "content": "Run docker-compose", "tags": ["devops"]}),
        normalize_note({"title": "Meeting", "content": "Discuss roadmaps", "tags": ["meeting"]}),
        normalize_note({"title": "Personal", "content": "Shopping list", "tags": ["personal"]}),
    ]

    assert len(search_notes(notes, "docker")) == 1
    assert len(search_notes(notes, "meeting")) == 1
    assert len(search_notes(notes, "tag:devops")) == 1
    assert len(search_notes(notes, "", {"tag": "personal"})) == 1

    note = notes[0]
    assert add_tag(note, "newtag") is True
    assert "newtag" in note["tags"]
    assert add_tag(note, "newtag") is False  # Duplicate tag

    assert remove_tag(note, "newtag") is True
    assert "newtag" not in note["tags"]

    filtered = filter_by_tag(notes, "devops")
    assert len(filtered) == 1

    tags = get_all_tags(notes)
    tag_names = [t["tag"] for t in tags]
    assert "devops" in tag_names
    assert "meeting" in tag_names
    assert "personal" in tag_names


def test_attached_commands():
    note = normalize_note({"title": "Note with commands"})
    cmd = attach_command(note, name="Test Cmd", command="npm test")

    assert cmd is not None
    assert cmd["name"] == "Test Cmd"
    assert len(note["attachedCommands"]) == 1

    executed = []
    def dummy_executor(cmd_str, name_str):
        executed.append((cmd_str, name_str))
        return "success"

    res = execute_note_command(note, "Test Cmd", executor=dummy_executor)
    assert res == "success"
    assert executed == [("npm test", "Test Cmd")]

    assert detach_command(note, cmd["id"]) is True
    assert len(note["attachedCommands"]) == 0


def test_attached_commands_errors():
    note = normalize_note({"title": "Empty"})
    with pytest.raises(ValueError, match="Note has no attached commands"):
        execute_note_command(note, "Test")


def test_share_link():
    note = normalize_note({
        "title": "Secret Strategy",
        "content": "Top secret content",
        "tags": ["secret"],
        "attachedCommands": [{"name": "Deploy", "command": "make deploy"}],
    })

    link = generate_share_link(note)
    assert "cmdbar://note/share?data=" in link

    parsed = parse_share_link(link)
    assert parsed["title"] == "Secret Strategy"
    assert parsed["content"] == "Top secret content"
    assert parsed["tags"] == ["secret"]
    assert parsed["attachedCommands"][0]["name"] == "Deploy"

    notes = []
    imported = import_from_share_link(notes, link)
    assert len(notes) == 1
    assert imported["title"] == "Secret Strategy"


def test_sync_and_persistence():
    local_notes = [
        {"id": "n1", "title": "N1 Local", "content": "v1", "updatedAt": "2026-08-23T10:00:00Z"},
        {"id": "n2", "title": "N2 Local", "content": "v1", "updatedAt": "2026-08-23T12:00:00Z"},
    ]
    remote_notes = [
        {"id": "n1", "title": "N1 Remote", "content": "v2", "updatedAt": "2026-08-23T11:00:00Z"},
        {"id": "n3", "title": "N3 Remote", "content": "v1", "updatedAt": "2026-08-23T09:00:00Z"},
    ]

    merged = merge_notes(local_notes, remote_notes)
    assert len(merged) == 3
    n1 = next(n for n in merged if n["id"] == "n1")
    assert n1["title"] == "N1 Remote"

    with tempfile.TemporaryDirectory() as tmpdir:
        filePath = os.path.join(tmpdir, "notes.json")
        save_notes_atomically(merged, filePath)
        assert os.path.exists(filePath)

        loaded = load_notes_atomically(filePath)
        assert len(loaded) == 3
        assert loaded[0]["id"] == "n2"
