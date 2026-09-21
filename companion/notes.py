"""
Notes and Scratchpad Manager for CmdBar Python Companion & App.
Provides note CRUD operations, Markdown rendering, Tag organization,
Fast Search, Command Attachments, Share Links, and Multi-device Sync.
"""

import os
import json
import re
import time
import base64
import urllib.parse
from typing import List, Dict, Any, Optional

def create_note(
    title: str = "Untitled Note",
    content: str = "",
    tags: Optional[List[str]] = None,
    attached_command: Optional[str] = None,
    pinned: bool = False
) -> Dict[str, Any]:
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    id_suffix = base64.b32encode(os.urandom(5)).decode("utf-8").lower().rstrip("=")
    note_id = f"note_{int(time.time())}_{id_suffix}"
    
    clean_tags = []
    if tags:
        seen = set()
        for t in tags:
            st = str(t).strip()
            if st and st.lower() not in seen:
                seen.add(st.lower())
                clean_tags.append(st)

    return {
        "id": note_id,
        "title": str(title or "Untitled Note").strip(),
        "content": str(content or ""),
        "tags": clean_tags,
        "attachedCommand": str(attached_command).strip() if attached_command else None,
        "pinned": bool(pinned),
        "createdAt": now,
        "updatedAt": now,
    }

def update_note(notes: List[Dict[str, Any]], note_id: str, updates: Dict[str, Any]) -> List[Dict[str, Any]]:
    if not isinstance(notes, list) or not note_id:
        return notes or []
    
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    updated_notes = []
    for n in notes:
        if isinstance(n, dict) and n.get("id") == note_id:
            updated = dict(n)
            updated.update(updates)
            updated["id"] = note_id  # Cannot change ID
            if "tags" in updates:
                seen = set()
                clean_tags = []
                for t in updates["tags"]:
                    st = str(t).strip()
                    if st and st.lower() not in seen:
                        seen.add(st.lower())
                        clean_tags.append(st)
                updated["tags"] = clean_tags
            updated["updatedAt"] = now
            updated_notes.append(updated)
        else:
            updated_notes.append(n)
    return updated_notes

def delete_note(notes: List[Dict[str, Any]], note_id: str) -> List[Dict[str, Any]]:
    if not isinstance(notes, list) or not note_id:
        return notes or []
    return [n for n in notes if isinstance(n, dict) and n.get("id") != note_id]

def get_note_by_id(notes: List[Dict[str, Any]], note_id: str) -> Optional[Dict[str, Any]]:
    if not isinstance(notes, list) or not note_id:
        return None
    for n in notes:
        if isinstance(n, dict) and n.get("id") == note_id:
            return n
    return None

def search_notes(notes: List[Dict[str, Any]], query: str = "", tag_filter: Optional[str] = None) -> List[Dict[str, Any]]:
    if not isinstance(notes, list):
        return []
    
    q = str(query or "").strip()
    filter_tag = str(tag_filter).strip().lower() if tag_filter else None
    
    tag_match = re.search(r'\btag:([^\s]+)', q, re.IGNORECASE)
    if tag_match:
        filter_tag = tag_match.group(1).lower()
        q = re.sub(r'\btag:[^\s]+', '', q, flags=re.IGNORECASE).strip()
        
    clean_query = q.lower()
    
    results = []
    for note in notes:
        if not isinstance(note, dict):
            continue
            
        if filter_tag:
            note_tags = [str(t).lower() for t in note.get("tags", [])]
            if filter_tag not in note_tags:
                continue
                
        if not clean_query:
            results.append(note)
            continue
            
        title_match = clean_query in str(note.get("title", "")).lower()
        content_match = clean_query in str(note.get("content", "")).lower()
        tag_match_flag = any(clean_query in str(t).lower() for t in note.get("tags", []))
        command_match = clean_query in str(note.get("attachedCommand", "")).lower()
        
        if title_match or content_match or tag_match_flag or command_match:
            results.append(note)

    results.sort(key=lambda n: (not n.get("pinned", False), n.get("updatedAt", "")), reverse=False)
    return results

def organize_by_tag(notes: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(notes, list):
        return {"tags": {}, "summary": []}
        
    tags_map = {}
    counts = {}
    
    for note in notes:
        if not isinstance(note, dict):
            continue
        note_tags = note.get("tags") or ["untagged"]
        for tag in note_tags:
            clean_tag = str(tag).strip()
            if clean_tag not in tags_map:
                tags_map[clean_tag] = []
                counts[clean_tag] = 0
            tags_map[clean_tag].append(note)
            counts[clean_tag] += 1
            
    summary = [
        {"tag": tag, "count": counts[tag]}
        for tag in counts
    ]
    summary.sort(key=lambda x: (-x["count"], x["tag"]))
    return {"tags": tags_map, "summary": summary}

def render_markdown(markdown_text: str) -> Dict[str, str]:
    if not markdown_text or not isinstance(markdown_text, str):
        return {"pango": "", "html": "", "raw": ""}
        
    text = markdown_text
    
    html = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    html = re.sub(r'```([\s\S]*?)```', r'<pre><code>\1</code></pre>', html)
    html = re.sub(r'`([^`]+)`', r'<code>\1</code>', html)
    html = re.sub(r'^###\s+(.*)$', r'<h3>\1</h3>', html, flags=re.MULTILINE)
    html = re.sub(r'^##\s+(.*)$', r'<h2>\1</h2>', html, flags=re.MULTILINE)
    html = re.sub(r'^#\s+(.*)$', r'<h1>\1</h1>', html, flags=re.MULTILINE)
    html = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', html)
    html = re.sub(r'\*([^*]+)\*', r'<em>\1</em>', html)
    html = re.sub(r'^[\s]*[-*+]\s+(.*)$', r'<li>\1</li>', html, flags=re.MULTILINE)
    html = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', html)

    pango = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    pango = re.sub(r'```([\s\S]*?)```', r'<font face="monospace" size="small">\1</font>', pango)
    pango = re.sub(r'`([^`]+)`', r'<font face="monospace">\1</font>', pango)
    pango = re.sub(r'^(#{1,6})\s+(.*)$', r'<b><span size="large">\2</span></b>', pango, flags=re.MULTILINE)
    pango = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', pango)
    pango = re.sub(r'\*([^*]+)\*', r'<i>\1</i>', pango)
    pango = re.sub(r'^[\s]*[-*+]\s+(.*)$', r'  • \1', pango, flags=re.MULTILINE)

    return {"pango": pango, "html": html, "raw": text}

def generate_share_link(note: Dict[str, Any]) -> str:
    if not note or not isinstance(note, dict):
        return ""
    payload = {
        "id": note.get("id"),
        "title": note.get("title"),
        "content": note.get("content"),
        "tags": note.get("tags", []),
        "attachedCommand": note.get("attachedCommand"),
        "createdAt": note.get("createdAt"),
    }
    json_str = json.dumps(payload)
    encoded = base64.urlsafe_b64encode(json_str.encode("utf-8")).decode("utf-8").rstrip("=")
    return f"cmdbar://note/share?data={encoded}"

def parse_share_link(share_url: str) -> Optional[Dict[str, Any]]:
    if not share_url or not isinstance(share_url, str):
        return None
    try:
        data_param = None
        if "data=" in share_url:
            parsed = urllib.parse.urlparse(share_url)
            qs = urllib.parse.parse_qs(parsed.query)
            data_param = qs.get("data", [None])[0]
        else:
            data_param = share_url

        if not data_param:
            return None

        padded = data_param + "=" * (-len(data_param) % 4)
        json_str = base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8")
        data = json.loads(json_str)

        return create_note(
            title=data.get("title", "Imported Note"),
            content=data.get("content", ""),
            tags=data.get("tags", []),
            attached_command=data.get("attachedCommand"),
        )
    except Exception:
        return None

def sync_notes(local_notes: List[Dict[str, Any]], remote_notes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    note_map = {}
    safe_local = local_notes if isinstance(local_notes, list) else []
    safe_remote = remote_notes if isinstance(remote_notes, list) else []
    
    for note in safe_local + safe_remote:
        if not isinstance(note, dict) or not note.get("id"):
            continue
        nid = note["id"]
        if nid not in note_map:
            note_map[nid] = note
        else:
            existing = note_map[nid]
            if note.get("updatedAt", "") >= existing.get("updatedAt", ""):
                note_map[nid] = note

    results = list(note_map.values())
    results.sort(key=lambda n: (not n.get("pinned", False), n.get("updatedAt", "")))
    return results
