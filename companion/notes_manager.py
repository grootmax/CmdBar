#!/usr/bin/env python3
"""
Quick Notes and Scratchpad Manager for CmdBar Python Companion.

Provides plain-text and Markdown note management, tag organization,
command attachments, share link generation and parsing, device sync,
and atomic file persistence.
"""

import os
import json
import re
import time
import secrets
import base64
import urllib.parse
from datetime import datetime, timezone


def generate_note_id() -> str:
    """
    Generates a unique note identifier string.
    
    :returns: Unique note ID string.
    :visibility: public
    """
    timestamp = hex(int(time.time() * 1000))[2:]
    random_str = secrets.token_hex(3)
    return f"note_{timestamp}_{random_str}"


def normalize_note(note: dict) -> dict:
    """
    Validates and normalizes note dictionary structure.
    
    :param note: Raw note dictionary.
    :returns: Normalized note dictionary.
    :visibility: public
    """
    if not isinstance(note, dict):
        raise ValueError("Invalid note dictionary provided.")

    now = datetime.now(timezone.utc).isoformat()
    raw_tags = note.get("tags", [])
    if isinstance(raw_tags, list):
        clean_tags = list(dict.fromkeys(str(t).strip().lower() for t in raw_tags if str(t).strip()))
    else:
        clean_tags = []

    raw_cmds = note.get("attachedCommands", note.get("attached_commands", []))
    clean_cmds = []
    if isinstance(raw_cmds, list):
        for c in raw_cmds:
            if isinstance(c, dict) and (c.get("name") or c.get("command")):
                clean_cmds.append({
                    "id": c.get("id") or f"cmd_{secrets.token_hex(3)}",
                    "name": str(c.get("name") or c.get("command", "Attached Command")).strip(),
                    "command": str(c.get("command") or c.get("name", "")).strip(),
                })

    return {
        "id": note.get("id") or generate_note_id(),
        "title": str(note.get("title") or "Untitled Note").strip(),
        "content": str(note.get("content") or ""),
        "tags": clean_tags,
        "attachedCommands": clean_cmds,
        "isScratchpad": bool(note.get("isScratchpad", note.get("is_scratchpad", False))),
        "pinned": bool(note.get("pinned", False)),
        "createdAt": note.get("createdAt") or note.get("created_at") or now,
        "updatedAt": note.get("updatedAt") or note.get("updated_at") or now,
    }


def create_note(notes_list: list, title: str = "Untitled Note", content: str = "",
                tags: list = None, attached_commands: list = None,
                is_scratchpad: bool = False, pinned: bool = False) -> dict:
    """
    Creates a new note object and appends it to notes list.
    
    :param notes_list: Target notes list array.
    :param title: Note title string.
    :param content: Note plain-text/markdown content.
    :param tags: Optional tags list.
    :param attached_commands: Optional list of attached command dicts.
    :param is_scratchpad: Boolean flag indicating if scratchpad.
    :param pinned: Boolean flag indicating if pinned.
    :returns: Created and normalized note dictionary.
    :visibility: public
    """
    if not isinstance(notes_list, list):
        raise ValueError("notes_list must be a list.")

    new_note = normalize_note({
        "title": title,
        "content": content,
        "tags": tags or [],
        "attachedCommands": attached_commands or [],
        "isScratchpad": is_scratchpad,
        "pinned": pinned,
    })

    notes_list.append(new_note)
    return new_note


def get_note(notes_list: list, note_id: str) -> dict:
    """
    Retrieves a note by ID from notes list.
    
    :param notes_list: List of notes.
    :param note_id: Target note ID.
    :returns: Matching note dictionary or None.
    :visibility: public
    """
    if not isinstance(notes_list, list) or not note_id:
        return None
    for n in notes_list:
        if n.get("id") == note_id:
            return n
    return None


def update_note(notes_list: list, note_id: str, **updates) -> dict:
    """
    Updates an existing note in notes list.
    
    :param notes_list: List of notes.
    :param note_id: Target note ID.
    :param updates: Keyword arguments for fields to update.
    :returns: Updated note dictionary or None.
    :visibility: public
    """
    note = get_note(notes_list, note_id)
    if not note:
        return None

    if "title" in updates and updates["title"] is not None:
        note["title"] = str(updates["title"]).strip()
    if "content" in updates and updates["content"] is not None:
        note["content"] = str(updates["content"])
    if "tags" in updates and isinstance(updates["tags"], list):
        note["tags"] = list(dict.fromkeys(str(t).strip().lower() for t in updates["tags"] if str(t).strip()))
    if "attached_commands" in updates or "attachedCommands" in updates:
        raw_cmds = updates.get("attached_commands", updates.get("attachedCommands", []))
        if isinstance(raw_cmds, list):
            note["attachedCommands"] = [
                {
                    "id": c.get("id") or f"cmd_{secrets.token_hex(3)}",
                    "name": str(c.get("name") or c.get("command", "Attached Command")).strip(),
                    "command": str(c.get("command") or c.get("name", "")).strip(),
                }
                for c in raw_cmds if isinstance(c, dict)
            ]
    if "is_scratchpad" in updates or "isScratchpad" in updates:
        note["isScratchpad"] = bool(updates.get("is_scratchpad", updates.get("isScratchpad")))
    if "pinned" in updates:
        note["pinned"] = bool(updates["pinned"])

    note["updatedAt"] = datetime.now(timezone.utc).isoformat()
    return note


def delete_note(notes_list: list, note_id: str) -> bool:
    """
    Deletes a note by ID from notes list.
    
    :param notes_list: List of notes.
    :param note_id: Target note ID.
    :returns: True if deleted, False otherwise.
    :visibility: public
    """
    if not isinstance(notes_list, list) or not note_id:
        return False
    for i, n in enumerate(notes_list):
        if n.get("id") == note_id:
            del notes_list[i]
            return True
    return False


def get_scratchpad(notes_list: list) -> dict:
    """
    Gets or creates the default Scratchpad note.
    
    :param notes_list: List of notes.
    :returns: Scratchpad note dictionary.
    :visibility: public
    """
    if not isinstance(notes_list, list):
        raise ValueError("notes_list must be a list.")

    for n in notes_list:
        if n.get("isScratchpad") or n.get("id") == "scratchpad":
            return n

    scratchpad = normalize_note({
        "id": "scratchpad",
        "title": "Scratchpad",
        "content": "",
        "isScratchpad": True,
        "pinned": True,
        "tags": ["scratchpad"],
    })
    notes_list.insert(0, scratchpad)
    return scratchpad


def update_scratchpad(notes_list: list, content: str = "") -> dict:
    """
    Updates scratchpad content quickly.
    
    :param notes_list: List of notes.
    :param content: New scratchpad content string.
    :returns: Updated scratchpad note dictionary.
    :visibility: public
    """
    scratchpad = get_scratchpad(notes_list)
    return update_note(notes_list, scratchpad["id"], content=content)


def render_markdown(markdown_text: str = "") -> str:
    """
    Renders Markdown content into basic HTML formatted representation.
    
    :param markdown_text: Input Markdown string.
    :returns: Formatted HTML string.
    :visibility: public
    """
    if not markdown_text:
        return ""

    lines = str(markdown_text).split("\n")
    html_lines = []
    in_code_block = False

    for line in lines:
        if line.strip().startswith("```"):
            if in_code_block:
                html_lines.append("</code></pre>")
                in_code_block = False
            else:
                html_lines.append("<pre><code>")
                in_code_block = True
            continue

        if in_code_block:
            html_lines.append(_escape_html(line))
            continue

        trimmed = line.strip()
        if trimmed.startswith("### "):
            html_lines.append(f"<h3>{_render_inline_markdown(trimmed[4:])}</h3>")
        elif trimmed.startswith("## "):
            html_lines.append(f"<h2>{_render_inline_markdown(trimmed[3:])}</h2>")
        elif trimmed.startswith("# "):
            html_lines.append(f"<h1>{_render_inline_markdown(trimmed[2:])}</h1>")
        elif trimmed.startswith("- [ ] "):
            html_lines.append(f'<li><input type="checkbox" disabled /> {_render_inline_markdown(trimmed[6:])}</li>')
        elif trimmed.startswith("- [x] ") or trimmed.startswith("- [X] "):
            html_lines.append(f'<li><input type="checkbox" checked disabled /> {_render_inline_markdown(trimmed[6:])}</li>')
        elif trimmed.startswith("- ") or trimmed.startswith("* "):
            html_lines.append(f"<li>{_render_inline_markdown(trimmed[2:])}</li>")
        elif trimmed == "":
            html_lines.append("<br/>")
        else:
            html_lines.append(f"<p>{_render_inline_markdown(line)}</p>")

    if in_code_block:
        html_lines.append("</code></pre>")

    return "\n".join(html_lines)


def _render_inline_markdown(text: str) -> str:
    escaped = _escape_html(text)
    escaped = re.sub(r"\*\*(.*?)\*\*", r"<strong>\1</strong>", escaped)
    escaped = re.sub(r"\*(.*?)\*", r"<em>\1</em>", escaped)
    escaped = re.sub(r"`(.*?)`", r"<code>\1</code>", escaped)
    escaped = re.sub(r"\[(.*?)\]\((.*?)\)", r'<a href="\2">\1</a>', escaped)
    return escaped


def _escape_html(text: str) -> str:
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#039;")
    )


def strip_markdown(markdown_text: str = "") -> str:
    """
    Strips Markdown formatting elements to return plain text.
    
    :param markdown_text: Input Markdown string.
    :returns: Plain text without Markdown markup.
    :visibility: public
    """
    if not markdown_text:
        return ""
    text = str(markdown_text)
    text = re.sub(r"```[\s\S]*?```", "", text)
    text = re.sub(r"^#+\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^-\s+\[[ xX]\]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^[-*]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)
    text = re.sub(r"\*(.*?)\*", r"\1", text)
    text = re.sub(r"__(.*?)__", r"\1", text)
    text = re.sub(r"_(.*?)_", r"\1", text)
    text = re.sub(r"`(.*?)`", r"\1", text)
    text = re.sub(r"\[(.*?)\]\((.*?)\)", r"\1", text)
    return text.strip()


def search_notes(notes_list: list, query: str = "", options: dict = None) -> list:
    """
    Searches notes list by query string, tag filter, or options.
    
    :param notes_list: List of notes.
    :param query: Search term or tag filter (e.g., "tag:work" or "meeting").
    :param options: Dict with optional keys 'tag' and 'limit'.
    :returns: Filtered list of matching notes.
    :visibility: public
    """
    if not isinstance(notes_list, list):
        return []

    options = options or {}
    search_term = str(query or "").strip()
    filter_tag = str(options.get("tag")).strip().lower() if options.get("tag") else None

    tag_match = re.search(r"tag:([^\s]+)", search_term, re.IGNORECASE)
    if tag_match:
        filter_tag = tag_match.group(1).lower()
        search_term = search_term.replace(tag_match.group(0), "").strip()

    clean_query = search_term.lower()

    results = []
    for note in notes_list:
        note_tags = [t.lower() for t in note.get("tags", [])]
        if filter_tag and filter_tag not in note_tags:
            continue

        if not clean_query:
            results.append(note)
            continue

        title_match = clean_query in note.get("title", "").lower()
        content_match = clean_query in note.get("content", "").lower()
        tag_match_in_note = any(clean_query in t for t in note_tags)

        if title_match or content_match or tag_match_in_note:
            results.append(note)

    limit = options.get("limit")
    if isinstance(limit, int) and limit > 0:
        return results[:limit]

    return results


def add_tag(note: dict, tag: str) -> bool:
    """
    Adds a tag to a note.
    
    :param note: Target note dictionary.
    :param tag: Tag string to add.
    :returns: True if tag added, False if already exists or invalid.
    :visibility: public
    """
    if not isinstance(note, dict) or not tag:
        return False
    clean_tag = str(tag).strip().lower()
    if not clean_tag:
        return False

    tags = note.setdefault("tags", [])
    if clean_tag not in tags:
        tags.append(clean_tag)
        note["updatedAt"] = datetime.now(timezone.utc).isoformat()
        return True
    return False


def remove_tag(note: dict, tag: str) -> bool:
    """
    Removes a tag from a note.
    
    :param note: Target note dictionary.
    :param tag: Tag string to remove.
    :returns: True if tag removed, False if not found.
    :visibility: public
    """
    if not isinstance(note, dict) or not tag:
        return False
    clean_tag = str(tag).strip().lower()
    tags = note.get("tags", [])
    if clean_tag in tags:
        tags.remove(clean_tag)
        note["updatedAt"] = datetime.now(timezone.utc).isoformat()
        return True
    return False


def filter_by_tag(notes_list: list, tag: str = "") -> list:
    """
    Filters notes array by tag.
    
    :param notes_list: List of notes.
    :param tag: Target tag string.
    :returns: Filtered notes list.
    :visibility: public
    """
    if not isinstance(notes_list, list) or not tag:
        return []
    clean_tag = str(tag).strip().lower()
    return [n for n in notes_list if any(t.lower() == clean_tag for t in n.get("tags", []))]


def get_all_tags(notes_list: list) -> list:
    """
    Retrieves all unique tags with count from notes list.
    
    :param notes_list: List of notes.
    :returns: List of dicts [{"tag": str, "count": int}].
    :visibility: public
    """
    if not isinstance(notes_list, list):
        return []

    counts = {}
    for note in notes_list:
        for tag in note.get("tags", []):
            clean_tag = str(tag).strip().lower()
            if clean_tag:
                counts[clean_tag] = counts.get(clean_tag, 0) + 1

    return [{"tag": t, "count": counts[t]} for t in sorted(counts.keys())]


def attach_command(note: dict, name: str = "", command: str = "") -> dict:
    """
    Attaches a command to a note.
    
    :param note: Target note dictionary.
    :param name: Command display name.
    :param command: Shell command template/string.
    :returns: Attached command dictionary or None.
    :visibility: public
    """
    if not isinstance(note, dict):
        return None

    clean_name = str(name or command or "").strip()
    clean_cmd = str(command or name or "").strip()

    if not clean_cmd:
        return None

    cmds = note.setdefault("attachedCommands", [])
    new_cmd = {
        "id": f"cmd_{secrets.token_hex(3)}",
        "name": clean_name or clean_cmd,
        "command": clean_cmd,
    }
    cmds.append(new_cmd)
    note["updatedAt"] = datetime.now(timezone.utc).isoformat()
    return new_cmd


def detach_command(note: dict, command_identifier: str) -> bool:
    """
    Detaches a command from a note by ID or name/command string.
    
    :param note: Target note dictionary.
    :param command_identifier: ID or name/command string.
    :returns: True if detached, False otherwise.
    :visibility: public
    """
    if not isinstance(note, dict) or not command_identifier:
        return False

    target = str(command_identifier).strip().lower()
    cmds = note.get("attachedCommands", [])
    for i, c in enumerate(cmds):
        if (c.get("id") == command_identifier or
                c.get("name", "").lower() == target or
                c.get("command", "").lower() == target):
            del cmds[i]
            note["updatedAt"] = datetime.now(timezone.utc).isoformat()
            return True
    return False


def execute_note_command(note: dict, command_identifier: str = None, executor=None):
    """
    Executes an attached command on a note using provided executor callable.
    
    :param note: Target note dictionary.
    :param command_identifier: Optional command ID, index, or name.
    :param executor: Callable taking (command, name).
    :returns: Result of executor.
    :visibility: public
    """
    cmds = note.get("attachedCommands", [])
    if not cmds:
        raise ValueError("Note has no attached commands.")

    cmd_obj = None
    if isinstance(command_identifier, int) and 0 <= command_identifier < len(cmds):
        cmd_obj = cmds[command_identifier]
    elif command_identifier:
        target = str(command_identifier).strip().lower()
        for c in cmds:
            if (c.get("id") == command_identifier or
                    c.get("name", "").lower() == target or
                    c.get("command", "").lower() == target):
                cmd_obj = c
                break
    else:
        cmd_obj = cmds[0]

    if not cmd_obj:
        raise ValueError(f"Attached command '{command_identifier}' not found on note.")

    if callable(executor):
        return executor(cmd_obj["command"], cmd_obj["name"])

    return cmd_obj


def generate_share_link(note: dict, base_url: str = "cmdbar://note/share") -> str:
    """
    Generates a shareable URL link for a note.
    
    :param note: Target note dictionary.
    :param base_url: Base URI scheme / URL string.
    :returns: Shareable URL string.
    :visibility: public
    """
    if not isinstance(note, dict):
        raise ValueError("Note dictionary required to generate share link.")

    payload = {
        "title": note.get("title", ""),
        "content": note.get("content", ""),
        "tags": note.get("tags", []),
        "attachedCommands": note.get("attachedCommands", []),
    }

    json_bytes = json.dumps(payload).encode("utf-8")
    base64_data = base64.urlsafe_b64encode(json_bytes).decode("utf-8").rstrip("=")
    return f"{base_url}?data={base64_data}"


def parse_share_link(share_url: str) -> dict:
    """
    Parses a shareable URL link into note data dictionary.
    
    :param share_url: Target share link URL.
    :returns: Extracted note dictionary.
    :visibility: public
    """
    if not share_url:
        raise ValueError("share_url required.")

    parsed = urllib.parse.urlparse(share_url)
    query_params = urllib.parse.parse_qs(parsed.query)

    if "data" not in query_params or not query_params["data"]:
        raise ValueError("Invalid share link format: missing data parameter.")

    raw_data = query_params["data"][0]
    padding = "=" * (4 - (len(raw_data) % 4)) if len(raw_data) % 4 != 0 else ""
    base64_data = raw_data + padding

    json_bytes = base64.urlsafe_b64decode(base64_data.encode("utf-8"))
    payload = json.loads(json_bytes.decode("utf-8"))

    return normalize_note({
        "title": payload.get("title", "Shared Note"),
        "content": payload.get("content", ""),
        "tags": payload.get("tags", []),
        "attachedCommands": payload.get("attachedCommands", []),
    })


def import_from_share_link(notes_list: list, share_url: str) -> dict:
    """
    Imports a shared note from share link into notes list.
    
    :param notes_list: Target notes list.
    :param share_url: Target share link.
    :returns: Imported note dictionary.
    :visibility: public
    """
    if not isinstance(notes_list, list):
        raise ValueError("notes_list must be a list.")
    note_data = parse_share_link(share_url)
    note_data["id"] = generate_note_id()
    new_note = normalize_note(note_data)
    notes_list.append(new_note)
    return new_note


def merge_notes(local_notes: list, remote_notes: list) -> list:
    """
    Merges local and remote notes lists for cross-device sync.
    Resolves conflicts based on updatedAt timestamp.
    
    :param local_notes: List of local note dicts.
    :param remote_notes: List of remote note dicts.
    :returns: Merged list of note dicts.
    :visibility: public
    """
    note_map = {}

    def process_note(note):
        if not isinstance(note, dict) or not note.get("id"):
            return
        note_id = note["id"]
        if note_id not in note_map:
            note_map[note_id] = dict(note)
        else:
            existing = note_map[note_id]
            existing_time = existing.get("updatedAt", "")
            new_time = note.get("updatedAt", "")
            if new_time >= existing_time:
                note_map[note_id] = dict(note)

    for n in local_notes or []:
        process_note(n)
    for n in remote_notes or []:
        process_note(n)

    merged = list(note_map.values())
    merged.sort(key=lambda x: str(x.get("updatedAt", "")), reverse=True)
    return merged


def save_notes_atomically(notes_list: list, filepath: str) -> None:
    """
    Saves notes list atomically to file.
    
    :param notes_list: List of notes to save.
    :param filepath: Target file path string.
    :visibility: public
    """
    if not filepath:
        raise ValueError("Filepath required.")

    tmp_path = f"{filepath}.tmp"
    dir_path = os.path.dirname(filepath)
    if dir_path and not os.path.exists(dir_path):
        os.makedirs(dir_path, exist_ok=True)

    content = json.dumps(notes_list, indent=2)
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(content)
        f.flush()
        os.fsync(f.fileno())

    os.replace(tmp_path, filepath)


def load_notes_atomically(filepath: str) -> list:
    """
    Loads notes list atomically from file.
    
    :param filepath: Target file path string.
    :returns: List of normalized note dicts.
    :visibility: public
    """
    if not filepath or not os.path.exists(filepath):
        return []

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return [normalize_note(n) for n in data if isinstance(n, dict)]
        return []
    except Exception as e:
        print(f"Error loading notes from {filepath}: {e}")
        return []
