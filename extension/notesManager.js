/**
 * Quick Notes and Scratchpad Manager for CmdBar.
 * Provides note CRUD operations, Markdown rendering, Tag organization,
 * Fast Search, Command Attachments, Share Links, and Multi-device Sync.
 */

import { writeConfigAtomically, substituteTokens, tokenizeCommand } from "./commandProcessor.js";
import { loadConfig, saveConfig, getDefaultConfigPath } from "./configSync.js";

/**
 * Creates a new note object with a unique ID and ISO timestamps.
 * @param {Object} [options]
 * @param {string} [options.title]
 * @param {string} [options.content]
 * @param {string[]} [options.tags]
 * @param {string|null} [options.attachedCommand]
 * @param {boolean} [options.pinned]
 * @returns {Object} note
 */
export function createNote({ title = "Untitled Note", content = "", tags = [], attachedCommand = null, pinned = false } = {}) {
  const now = new Date().toISOString();
  const id = "note_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 7);
  
  const cleanTags = Array.isArray(tags) 
    ? Array.from(new Set(tags.map(t => String(t).trim()).filter(Boolean)))
    : [];

  return {
    id,
    title: String(title || "Untitled Note").trim(),
    content: String(content || ""),
    tags: cleanTags,
    attachedCommand: attachedCommand ? String(attachedCommand).trim() : null,
    pinned: Boolean(pinned),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Updates an existing note in the list of notes.
 * @param {Array} notes
 * @param {string} id
 * @param {Object} updates
 * @returns {Array} updated notes array
 */
export function updateNote(notes, id, updates = {}) {
  if (!Array.isArray(notes) || !id) return notes || [];
  const index = notes.findIndex(n => n && n.id === id);
  if (index === -1) return notes;

  const now = new Date().toISOString();
  const existing = notes[index];
  
  const newTags = updates.tags !== undefined
    ? (Array.isArray(updates.tags) ? Array.from(new Set(updates.tags.map(t => String(t).trim()).filter(Boolean))) : [])
    : existing.tags;

  const updatedNote = {
    ...existing,
    ...updates,
    id: existing.id, // ID cannot be changed
    tags: newTags,
    updatedAt: now,
  };

  const updatedNotes = [...notes];
  updatedNotes[index] = updatedNote;
  return updatedNotes;
}

/**
 * Deletes a note by ID.
 * @param {Array} notes
 * @param {string} id
 * @returns {Array} filtered notes array
 */
export function deleteNote(notes, id) {
  if (!Array.isArray(notes) || !id) return notes || [];
  return notes.filter(n => n && n.id !== id);
}

/**
 * Retrieves a note by ID.
 * @param {Array} notes
 * @param {string} id
 * @returns {Object|null}
 */
export function getNoteById(notes, id) {
  if (!Array.isArray(notes) || !id) return null;
  return notes.find(n => n && n.id === id) || null;
}

/**
 * Searches notes based on query string or tag filter.
 * Supports `tag:tagname` or explicit tag filter option.
 * @param {Array} notes
 * @param {string} [query]
 * @param {Object} [options]
 * @returns {Array} search results
 */
export function searchNotes(notes, query = "", options = {}) {
  if (!Array.isArray(notes)) return [];
  if (!notes.length) return [];

  let q = String(query || "").trim();
  let filterTag = options && options.tag ? String(options.tag).trim().toLowerCase() : null;

  // Extract `tag:tagName` syntax from query if present
  const tagMatch = q.match(/\btag:([^\s]+)/i);
  if (tagMatch) {
    filterTag = tagMatch[1].toLowerCase();
    q = q.replace(tagMatch[0], "").trim();
  }

  const cleanQuery = q.toLowerCase();

  return notes.filter(note => {
    if (!note) return false;

    // Check tag filter
    if (filterTag) {
      const noteTags = (note.tags || []).map(t => String(t).toLowerCase());
      if (!noteTags.includes(filterTag)) {
        return false;
      }
    }

    if (!cleanQuery) return true;

    // Match title, content, tags, or attachedCommand
    const titleMatch = (note.title || "").toLowerCase().includes(cleanQuery);
    const contentMatch = (note.content || "").toLowerCase().includes(cleanQuery);
    const tagMatch = (note.tags || []).some(t => String(t).toLowerCase().includes(cleanQuery));
    const commandMatch = (note.attachedCommand || "").toLowerCase().includes(cleanQuery);

    return titleMatch || contentMatch || tagMatch || commandMatch;
  }).sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });
}

/**
 * Groups notes by tag and returns unique tag summary with counts.
 * @param {Array} notes
 * @returns {Object} { tags, summary }
 */
export function organizeByTag(notes) {
  if (!Array.isArray(notes)) return { tags: {}, summary: [] };

  const tagsMap = {};
  const counts = {};

  for (const note of notes) {
    if (!note) continue;
    const noteTags = (note.tags && note.tags.length > 0) ? note.tags : ["untagged"];
    for (const tag of noteTags) {
      const cleanTag = String(tag).trim();
      if (!tagsMap[cleanTag]) {
        tagsMap[cleanTag] = [];
        counts[cleanTag] = 0;
      }
      tagsMap[cleanTag].push(note);
      counts[cleanTag]++;
    }
  }

  const summary = Object.keys(counts).map(tag => ({
    tag,
    count: counts[tag],
  })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

  return { tags: tagsMap, summary };
}

/**
 * Helper to add a tag to a note.
 * @param {Object} note
 * @param {string} tag
 * @returns {Object} updated note
 */
export function addTagToNote(note, tag) {
  if (!note || !tag) return note;
  const cleanTag = String(tag).trim();
  if (!cleanTag) return note;
  const existingTags = note.tags || [];
  if (existingTags.map(t => t.toLowerCase()).includes(cleanTag.toLowerCase())) {
    return note;
  }
  return {
    ...note,
    tags: [...existingTags, cleanTag],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Helper to remove a tag from a note.
 * @param {Object} note
 * @param {string} tag
 * @returns {Object} updated note
 */
export function removeTagFromNote(note, tag) {
  if (!note || !tag) return note;
  const cleanTag = String(tag).trim().toLowerCase();
  const existingTags = note.tags || [];
  const updatedTags = existingTags.filter(t => String(t).trim().toLowerCase() !== cleanTag);
  return {
    ...note,
    tags: updatedTags,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Renders Markdown text to Pango Markup (for GNOME Shell UI) and HTML (for Web/Companion).
 * @param {string} markdownText
 * @returns {Object} { pango, html, raw }
 */
export function renderMarkdown(markdownText) {
  if (!markdownText || typeof markdownText !== "string") {
    return { pango: "", html: "", raw: "" };
  }

  const text = markdownText;

  // Render Pango Markup
  let pango = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks: ```code``` -> <font face="monospace">code</font>
  pango = pango.replace(/```([\s\S]*?)```/g, (match, p1) => {
    return `<font face="monospace" size="small">${p1.trim()}</font>`;
  });

  // Inline code: `code` -> <font face="monospace">code</font>
  pango = pango.replace(/`([^`]+)`/g, '<font face="monospace">$1</font>');

  // Headers: # Header -> <b>Header</b>
  pango = pango.replace(/^(#{1,6})\s+(.*)$/gm, '<b><span size="large">$2</span></b>');

  // Bold: **bold** -> <b>bold</b>
  pango = pango.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

  // Italic: *italic* -> <i>italic</i>
  pango = pango.replace(/\*([^*]+)\*/g, '<i>$1</i>');

  // Bullet lists: - item -> • item
  pango = pango.replace(/^[\s]*[-*+]\s+(.*)$/gm, '  • $1');

  // Render HTML
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks HTML
  html = html.replace(/```([\s\S]*?)```/g, (match, p1) => {
    return `<pre><code>${p1.trim()}</code></pre>`;
  });

  // Inline code HTML
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headers HTML
  html = html.replace(/^###\s+(.*)$/gm, '<h3>$1</h3>')
             .replace(/^##\s+(.*)$/gm, '<h2>$1</h2>')
             .replace(/^#\s+(.*)$/gm, '<h1>$1</h1>');

  // Bold & Italic HTML
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
             .replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Bullet lists HTML
  html = html.replace(/^[\s]*[-*+]\s+(.*)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  return { pango, html, raw: text };
}

/**
 * Extracts pure plain text from Markdown formatted content.
 * @param {string} markdownText
 * @returns {string} plain text
 */
export function extractPlainText(markdownText) {
  if (!markdownText || typeof markdownText !== "string") return "";
  
  return markdownText
    .replace(/```[\s\S]*?```/g, m => m.replace(/```/g, ""))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^(#{1,6})\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^[\s]*[-*+]\s+/gm, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .trim();
}

/**
 * Attaches a command template to a note.
 * @param {Object} note
 * @param {string|null} commandTemplate
 * @returns {Object} updated note
 */
export function attachCommand(note, commandTemplate) {
  if (!note) return null;
  return {
    ...note,
    attachedCommand: commandTemplate ? String(commandTemplate).trim() : null,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Prepares execution of an attached command on a note with parameter substitution.
 * @param {Object} note
 * @param {Object|string} [params]
 * @returns {Object} { command, tokens, noteId, noteTitle }
 */
export function executeAttachedCommand(note, params = {}) {
  if (!note || !note.attachedCommand) {
    throw new Error("Note has no attached command.");
  }

  let cmd = note.attachedCommand;

  if (typeof params === "object" && params !== null) {
    for (const [key, val] of Object.entries(params)) {
      const reg1 = new RegExp(`<${key}>`, "g");
      const reg2 = new RegExp(`\\{\\{${key}\\}\\}`, "g");
      const reg3 = new RegExp(`\\{${key}\\}`, "g");
      cmd = cmd.replace(reg1, String(val)).replace(reg2, String(val)).replace(reg3, String(val));
    }
  } else if (typeof params === "string") {
    cmd = cmd.replace(/<[^>]+>|\{\{[^}]+\}\}|\{[^}]+\}/g, params);
  }

  const tokens = tokenizeCommand(cmd);
  return {
    command: cmd,
    tokens,
    noteId: note.id,
    noteTitle: note.title,
  };
}

/**
 * Generates a shareable URL/link for a note.
 * @param {Object} note
 * @returns {string} share link URL
 */
export function generateShareLink(note) {
  if (!note) return "";
  const payload = {
    id: note.id,
    title: note.title,
    content: note.content,
    tags: note.tags,
    attachedCommand: note.attachedCommand,
    createdAt: note.createdAt,
  };

  const jsonStr = JSON.stringify(payload);
  let encoded = "";

  if (typeof Buffer !== "undefined") {
    encoded = Buffer.from(jsonStr, "utf8").toString("base64url");
  } else if (typeof btoa !== "undefined") {
    encoded = btoa(encodeURIComponent(jsonStr));
  } else {
    encoded = encodeURIComponent(jsonStr);
  }

  return `cmdbar://note/share?data=${encodeURIComponent(encoded)}`;
}

/**
 * Parses and decodes a share link back into a Note object.
 * @param {string} shareUrl
 * @returns {Object|null} note
 */
export function parseShareLink(shareUrl) {
  if (!shareUrl || typeof shareUrl !== "string") return null;

  try {
    let encoded = "";
    if (shareUrl.includes("data=")) {
      const match = shareUrl.match(/[?&]data=([^&]+)/);
      encoded = match ? decodeURIComponent(match[1]) : "";
    } else {
      encoded = shareUrl;
    }

    if (!encoded) return null;

    let jsonStr = "";
    if (typeof Buffer !== "undefined") {
      jsonStr = Buffer.from(encoded, "base64url").toString("utf8");
    } else if (typeof atob !== "undefined") {
      jsonStr = decodeURIComponent(atob(encoded));
    } else {
      jsonStr = decodeURIComponent(encoded);
    }

    const data = JSON.parse(jsonStr);
    if (!data || typeof data !== "object") return null;

    return createNote({
      title: data.title || "Imported Note",
      content: data.content || "",
      tags: data.tags || [],
      attachedCommand: data.attachedCommand || null,
    });
  } catch (err) {
    return null;
  }
}

/**
 * Synchronizes local notes array with remote/companion notes array (last-write-wins).
 * @param {Array} localNotes
 * @param {Array} remoteNotes
 * @returns {Array} synchronized notes array
 */
export function syncNotes(localNotes = [], remoteNotes = []) {
  const noteMap = new Map();

  const safeLocal = Array.isArray(localNotes) ? localNotes : [];
  const safeRemote = Array.isArray(remoteNotes) ? remoteNotes : [];

  for (const note of [...safeLocal, ...safeRemote]) {
    if (!note || !note.id) continue;
    if (!noteMap.has(note.id)) {
      noteMap.set(note.id, note);
    } else {
      const existing = noteMap.get(note.id);
      const existingTime = new Date(existing.updatedAt || 0).getTime();
      const newTime = new Date(note.updatedAt || 0).getTime();
      if (newTime >= existingTime) {
        noteMap.set(note.id, note);
      }
    }
  }

  return Array.from(noteMap.values()).sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });
}

/**
 * Loads notes from configuration or file.
 * @param {string} [configPath]
 * @returns {Promise<Array>} notes
 */
export async function loadNotes(configPath) {
  try {
    const config = await loadConfig(configPath);
    return Array.isArray(config.notes) ? config.notes : [];
  } catch (e) {
    return [];
  }
}

/**
 * Saves notes to configuration file atomically.
 * @param {string} configPath
 * @param {Array} notes
 * @returns {Promise<Array>} saved notes
 */
export async function saveNotes(configPath, notes) {
  const safeNotes = Array.isArray(notes) ? notes : [];
  let config;
  try {
    config = await loadConfig(configPath);
  } catch (e) {
    config = { categories: [], notes: [] };
  }
  if (!config || typeof config !== "object") {
    config = { categories: [], notes: [] };
  }
  if (!Array.isArray(config.categories)) {
    config.categories = [];
  }
  config.notes = safeNotes;
  await saveConfig(config, configPath);
  return safeNotes;
}
