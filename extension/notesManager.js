/**
 * @file extension/notesManager.js
 * @description Quick Notes and Scratchpad Management for CmdBar.
 * Provides plain-text and Markdown note management, tag organization,
 * command attachments, share link generation/parsing, device sync,
 * and atomic file persistence.
 */

import fs from "fs";
import path from "path";

/**
 * Generates a unique note identifier.
 * @returns {string} Unique note ID string.
 */
export function generateNoteId() {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 8);
  return `note_${timestamp}_${randomStr}`;
}

/**
 * Validates and normalizes note object structure.
 * @param {Object} note - The raw note object.
 * @returns {Object} Normalized note object.
 */
export function normalizeNote(note) {
  if (!note || typeof note !== "object") {
    throw new Error("Invalid note object provided.");
  }

  const now = new Date().toISOString();
  return {
    id: note.id || generateNoteId(),
    title: String(note.title || "Untitled Note").trim(),
    content: String(note.content || ""),
    tags: Array.isArray(note.tags)
      ? Array.from(new Set(note.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)))
      : [],
    attachedCommands: Array.isArray(note.attachedCommands)
      ? note.attachedCommands
          .filter((c) => c && typeof c === "object" && (c.name || c.command))
          .map((c) => ({
            id: c.id || `cmd_${Math.random().toString(36).substring(2, 8)}`,
            name: String(c.name || c.command || "Attached Command").trim(),
            command: String(c.command || c.name || "").trim(),
          }))
      : [],
    isScratchpad: Boolean(note.isScratchpad),
    pinned: Boolean(note.pinned),
    createdAt: note.createdAt || now,
    updatedAt: note.updatedAt || now,
  };
}

/**
 * Creates a new note object and appends it to notes list.
 * @param {Array<Object>} notesList - Target notes list array.
 * @param {Object} noteData - Note initialization options.
 * @returns {Object} The created and normalized note object.
 */
export function createNote(notesList = [], noteData = {}) {
  const newNote = normalizeNote({
    title: noteData.title || "Untitled Note",
    content: noteData.content || "",
    tags: noteData.tags || [],
    attachedCommands: noteData.attachedCommands || [],
    isScratchpad: Boolean(noteData.isScratchpad),
    pinned: Boolean(noteData.pinned),
  });

  if (!Array.isArray(notesList)) {
    throw new Error("notesList must be an array.");
  }

  notesList.push(newNote);
  return newNote;
}

/**
 * Retrieves a note by ID from notes list.
 * @param {Array<Object>} notesList - Array of notes.
 * @param {string} id - Target note ID.
 * @returns {Object|null} Matching note or null.
 */
export function getNote(notesList = [], id) {
  if (!Array.isArray(notesList) || !id) return null;
  return notesList.find((n) => n.id === id) || null;
}

/**
 * Updates an existing note in notes list.
 * @param {Array<Object>} notesList - Array of notes.
 * @param {string} id - Target note ID.
 * @param {Object} updates - Properties to update.
 * @returns {Object|null} Updated note or null if not found.
 */
export function updateNote(notesList = [], id, updates = {}) {
  const note = getNote(notesList, id);
  if (!note) return null;

  if (updates.title !== undefined) note.title = String(updates.title).trim();
  if (updates.content !== undefined) note.content = String(updates.content);
  if (updates.tags !== undefined && Array.isArray(updates.tags)) {
    note.tags = Array.from(new Set(updates.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)));
  }
  if (updates.attachedCommands !== undefined && Array.isArray(updates.attachedCommands)) {
    note.attachedCommands = updates.attachedCommands.map((c) => ({
      id: c.id || `cmd_${Math.random().toString(36).substring(2, 8)}`,
      name: String(c.name || c.command || "Attached Command").trim(),
      command: String(c.command || c.name || "").trim(),
    }));
  }
  if (updates.isScratchpad !== undefined) note.isScratchpad = Boolean(updates.isScratchpad);
  if (updates.pinned !== undefined) note.pinned = Boolean(updates.pinned);

  note.updatedAt = new Date().toISOString();
  return note;
}

/**
 * Deletes a note by ID from notes list.
 * @param {Array<Object>} notesList - Array of notes.
 * @param {string} id - Target note ID.
 * @returns {boolean} True if deleted, false otherwise.
 */
export function deleteNote(notesList = [], id) {
  if (!Array.isArray(notesList) || !id) return false;
  const index = notesList.findIndex((n) => n.id === id);
  if (index !== -1) {
    notesList.splice(index, 1);
    return true;
  }
  return false;
}

/**
 * Gets or creates the default Scratchpad note.
 * @param {Array<Object>} notesList - Array of notes.
 * @returns {Object} Scratchpad note object.
 */
export function getScratchpad(notesList = []) {
  if (!Array.isArray(notesList)) {
    throw new Error("notesList must be an array.");
  }
  let scratchpad = notesList.find((n) => n.isScratchpad || n.id === "scratchpad");
  if (!scratchpad) {
    scratchpad = normalizeNote({
      id: "scratchpad",
      title: "Scratchpad",
      content: "",
      isScratchpad: true,
      pinned: true,
      tags: ["scratchpad"],
    });
    notesList.unshift(scratchpad);
  }
  return scratchpad;
}

/**
 * Updates scratchpad content quickly.
 * @param {Array<Object>} notesList - Array of notes.
 * @param {string} content - New scratchpad content.
 * @returns {Object} Updated scratchpad note.
 */
export function updateScratchpad(notesList = [], content = "") {
  const scratchpad = getScratchpad(notesList);
  return updateNote(notesList, scratchpad.id, { content });
}

/**
 * Renders Markdown content into basic HTML formatted representation.
 * @param {string} markdownText - Input Markdown string.
 * @returns {string} Formatted HTML string.
 */
export function renderMarkdown(markdownText = "") {
  if (!markdownText) return "";

  let lines = String(markdownText).split("\n");
  let htmlLines = [];
  let inCodeBlock = false;

  for (let line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        htmlLines.push("</code></pre>");
        inCodeBlock = false;
      } else {
        htmlLines.push("<pre><code>");
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      htmlLines.push(escapeHtml(line));
      continue;
    }

    let trimmed = line.trim();

    // Headers
    if (trimmed.startsWith("### ")) {
      htmlLines.push(`<h3>${renderInlineMarkdown(trimmed.substring(4))}</h3>`);
    } else if (trimmed.startsWith("## ")) {
      htmlLines.push(`<h2>${renderInlineMarkdown(trimmed.substring(3))}</h2>`);
    } else if (trimmed.startsWith("# ")) {
      htmlLines.push(`<h1>${renderInlineMarkdown(trimmed.substring(2))}</h1>`);
    } else if (trimmed.startsWith("- [ ] ")) {
      htmlLines.push(`<li><input type="checkbox" disabled /> ${renderInlineMarkdown(trimmed.substring(6))}</li>`);
    } else if (trimmed.startsWith("- [x] ") || trimmed.startsWith("- [X] ")) {
      htmlLines.push(`<li><input type="checkbox" checked disabled /> ${renderInlineMarkdown(trimmed.substring(6))}</li>`);
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      htmlLines.push(`<li>${renderInlineMarkdown(trimmed.substring(2))}</li>`);
    } else if (trimmed === "") {
      htmlLines.push("<br/>");
    } else {
      htmlLines.push(`<p>${renderInlineMarkdown(line)}</p>`);
    }
  }

  if (inCodeBlock) {
    htmlLines.push("</code></pre>");
  }

  return htmlLines.join("\n");
}

/**
 * Renders inline Markdown tags (bold, italic, code, links).
 * @param {string} text - Inline text.
 * @returns {string} Formatted inline HTML.
 */
function renderInlineMarkdown(text) {
  let escaped = escapeHtml(text);
  // Bold **text**
  escaped = escaped.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  // Italic *text*
  escaped = escaped.replace(/\*(.*?)\*/g, "<em>$1</em>");
  // Inline Code `code`
  escaped = escaped.replace(/`(.*?)`/g, "<code>$1</code>");
  // Links [text](url)
  escaped = escaped.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');
  return escaped;
}

/**
 * Escapes HTML characters.
 * @param {string} str - Raw string.
 * @returns {string} Escaped string.
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Strips Markdown formatting elements to return plain text.
 * @param {string} markdownText - Input Markdown string.
 * @returns {string} Plain text without Markdown markup.
 */
export function stripMarkdown(markdownText = "") {
  if (!markdownText) return "";
  let text = String(markdownText);
  // Remove code blocks
  text = text.replace(/```[\s\S]*?```/g, "");
  // Remove headers
  text = text.replace(/^#+\s+/gm, "");
  // Remove task list checkboxes
  text = text.replace(/^-\s+\[[ xX]\]\s+/gm, "");
  // Remove list bullets
  text = text.replace(/^[-*]\s+/gm, "");
  // Remove bold / italic
  text = text.replace(/\*\*(.*?)\*\*/g, "$1");
  text = text.replace(/\*(.*?)\*/g, "$1");
  text = text.replace(/__(.*?)__/g, "$1");
  text = text.replace(/_(.*?)_/g, "$1");
  // Remove inline code
  text = text.replace(/`(.*?)`/g, "$1");
  // Remove links
  text = text.replace(/\[(.*?)\]\((.*?)\)/g, "$1");
  return text.trim();
}

/**
 * Searches notes list by query string, tag filter, or options.
 * @param {Array<Object>} notesList - Array of notes.
 * @param {string} query - Search term or tag filter (e.g., "tag:work" or "meeting").
 * @param {Object} options - Options { tag: string, limit: number }.
 * @returns {Array<Object>} Filtered array of matching notes.
 */
export function searchNotes(notesList = [], query = "", options = {}) {
  if (!Array.isArray(notesList)) return [];

  let searchTerm = String(query || "").trim();
  let filterTag = options.tag ? String(options.tag).trim().toLowerCase() : null;

  // Extract inline "tag:xyz" if query starts or contains it
  const tagMatch = searchTerm.match(/tag:([^\s]+)/i);
  if (tagMatch) {
    filterTag = tagMatch[1].toLowerCase();
    searchTerm = searchTerm.replace(tagMatch[0], "").trim();
  }

  const cleanQuery = searchTerm.toLowerCase();

  const results = notesList.filter((note) => {
    if (filterTag) {
      const hasTag = note.tags && note.tags.some((t) => t.toLowerCase() === filterTag);
      if (!hasTag) return false;
    }

    if (!cleanQuery) return true;

    const titleMatch = note.title && note.title.toLowerCase().includes(cleanQuery);
    const contentMatch = note.content && note.content.toLowerCase().includes(cleanQuery);
    const tagMatchInNote = note.tags && note.tags.some((t) => t.toLowerCase().includes(cleanQuery));

    return titleMatch || contentMatch || tagMatchInNote;
  });

  if (options.limit && typeof options.limit === "number") {
    return results.slice(0, options.limit);
  }

  return results;
}

/**
 * Adds a tag to a note.
 * @param {Object} note - Target note object.
 * @param {string} tag - Tag string to add.
 * @returns {boolean} True if tag added, false if existed or invalid.
 */
export function addTag(note, tag) {
  if (!note || !tag) return false;
  const cleanTag = String(tag).trim().toLowerCase();
  if (!cleanTag) return false;
  if (!Array.isArray(note.tags)) note.tags = [];

  if (!note.tags.includes(cleanTag)) {
    note.tags.push(cleanTag);
    note.updatedAt = new Date().toISOString();
    return true;
  }
  return false;
}

/**
 * Removes a tag from a note.
 * @param {Object} note - Target note object.
 * @param {string} tag - Tag string to remove.
 * @returns {boolean} True if tag removed, false if not found.
 */
export function removeTag(note, tag) {
  if (!note || !tag || !Array.isArray(note.tags)) return false;
  const cleanTag = String(tag).trim().toLowerCase();
  const index = note.tags.indexOf(cleanTag);
  if (index !== -1) {
    note.tags.splice(index, 1);
    note.updatedAt = new Date().toISOString();
    return true;
  }
  return false;
}

/**
 * Filters notes array by tag.
 * @param {Array<Object>} notesList - Array of notes.
 * @param {string} tag - Target tag.
 * @returns {Array<Object>} Filtered notes list.
 */
export function filterByTag(notesList = [], tag = "") {
  if (!Array.isArray(notesList) || !tag) return [];
  const cleanTag = String(tag).trim().toLowerCase();
  return notesList.filter((n) => n.tags && n.tags.some((t) => t.toLowerCase() === cleanTag));
}

/**
 * Retrieves all unique tags with count from notes list.
 * @param {Array<Object>} notesList - Array of notes.
 * @returns {Array<Object>} Array of objects { tag: string, count: number }.
 */
export function getAllTags(notesList = []) {
  if (!Array.isArray(notesList)) return [];
  const tagCounts = {};

  for (let note of notesList) {
    if (Array.isArray(note.tags)) {
      for (let tag of note.tags) {
        const cleanTag = String(tag).trim().toLowerCase();
        if (cleanTag) {
          tagCounts[cleanTag] = (tagCounts[cleanTag] || 0) + 1;
        }
      }
    }
  }

  return Object.keys(tagCounts)
    .sort()
    .map((tag) => ({ tag, count: tagCounts[tag] }));
}

/**
 * Attaches a command to a note.
 * @param {Object} note - Target note object.
 * @param {Object} commandObj - Command object { name, command }.
 * @returns {Object|null} The attached command object.
 */
export function attachCommand(note, commandObj = {}) {
  if (!note) return null;
  const name = String(commandObj.name || commandObj.command || "").trim();
  const command = String(commandObj.command || commandObj.name || "").trim();

  if (!command) return null;

  if (!Array.isArray(note.attachedCommands)) {
    note.attachedCommands = [];
  }

  const newCmd = {
    id: `cmd_${Math.random().toString(36).substring(2, 8)}`,
    name: name || command,
    command: command,
  };

  note.attachedCommands.push(newCmd);
  note.updatedAt = new Date().toISOString();
  return newCmd;
}

/**
 * Detaches a command from a note by ID or command name.
 * @param {Object} note - Target note object.
 * @param {string} commandIdentifier - ID or name/command string.
 * @returns {boolean} True if detached, false otherwise.
 */
export function detachCommand(note, commandIdentifier) {
  if (!note || !commandIdentifier || !Array.isArray(note.attachedCommands)) return false;

  const target = String(commandIdentifier).trim().toLowerCase();
  const index = note.attachedCommands.findIndex(
    (c) => c.id === commandIdentifier || c.name.toLowerCase() === target || c.command.toLowerCase() === target
  );

  if (index !== -1) {
    note.attachedCommands.splice(index, 1);
    note.updatedAt = new Date().toISOString();
    return true;
  }
  return false;
}

/**
 * Executes an attached command on a note using provided executor function.
 * @param {Object} note - Target note object.
 * @param {string} commandIdentifier - ID or command name/index.
 * @param {Function} executorFn - Async/sync command execution handler.
 * @returns {Promise<*>} Result of executorFn.
 */
export async function executeNoteCommand(note, commandIdentifier, executorFn) {
  if (!note || !Array.isArray(note.attachedCommands) || note.attachedCommands.length === 0) {
    throw new Error("Note has no attached commands.");
  }

  let cmdObj = null;
  if (typeof commandIdentifier === "number") {
    cmdObj = note.attachedCommands[commandIdentifier];
  } else if (commandIdentifier) {
    const target = String(commandIdentifier).trim().toLowerCase();
    cmdObj = note.attachedCommands.find(
      (c) => c.id === commandIdentifier || c.name.toLowerCase() === target || c.command.toLowerCase() === target
    );
  } else {
    cmdObj = note.attachedCommands[0];
  }

  if (!cmdObj) {
    throw new Error(`Attached command '${commandIdentifier}' not found on note.`);
  }

  if (typeof executorFn === "function") {
    return await executorFn(cmdObj.command, cmdObj.name);
  }

  return cmdObj;
}

/**
 * Generates a shareable URL link for a note.
 * @param {Object} note - Target note.
 * @param {string} baseUrl - Base URL or URI scheme (default: "cmdbar://note/share").
 * @returns {string} Shareable link URL.
 */
export function generateShareLink(note, baseUrl = "cmdbar://note/share") {
  if (!note) throw new Error("Note required to generate share link.");

  const payload = {
    title: note.title,
    content: note.content,
    tags: note.tags || [],
    attachedCommands: note.attachedCommands || [],
  };

  const jsonStr = JSON.stringify(payload);
  const base64Data = Buffer.from(jsonStr, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${baseUrl}?data=${base64Data}`;
}

/**
 * Parses a shareable URL link into note data.
 * @param {string} shareUrl - Target shareable link URL.
 * @returns {Object} Extracted note object.
 */
export function parseShareLink(shareUrl = "") {
  if (!shareUrl) throw new Error("shareUrl required.");

  const match = String(shareUrl).match(/[\?&]data=([^&]+)/);
  if (!match) {
    throw new Error("Invalid share link format: missing data parameter.");
  }

  let base64Data = match[1].replace(/-/g, "+").replace(/_/g, "/");
  while (base64Data.length % 4) {
    base64Data += "=";
  }

  const jsonStr = Buffer.from(base64Data, "base64").toString("utf-8");
  const payload = JSON.parse(jsonStr);

  return normalizeNote({
    title: payload.title || "Shared Note",
    content: payload.content || "",
    tags: payload.tags || [],
    attachedCommands: payload.attachedCommands || [],
  });
}

/**
 * Imports a shared note from share link into notes list.
 * @param {Array<Object>} notesList - Target notes list array.
 * @param {string} shareUrl - Target share link.
 * @returns {Object} Imported note.
 */
export function importFromShareLink(notesList = [], shareUrl = "") {
  if (!Array.isArray(notesList)) {
    throw new Error("notesList must be an array.");
  }
  const noteData = parseShareLink(shareUrl);
  noteData.id = generateNoteId();
  const importedNote = normalizeNote(noteData);
  notesList.push(importedNote);
  return importedNote;
}

/**
 * Merges local and remote notes lists for cross-device sync.
 * Resolves conflicts based on updatedAt timestamp.
 * @param {Array<Object>} localNotes - Array of local notes.
 * @param {Array<Object>} remoteNotes - Array of remote notes.
 * @returns {Array<Object>} Merged notes list array.
 */
export function mergeNotes(localNotes = [], remoteNotes = []) {
  const noteMap = new Map();

  const processNote = (note) => {
    if (!note || !note.id) return;
    const existing = noteMap.get(note.id);
    if (!existing) {
      noteMap.set(note.id, { ...note });
    } else {
      const existingTime = new Date(existing.updatedAt || 0).getTime();
      const newTime = new Date(note.updatedAt || 0).getTime();
      if (newTime >= existingTime) {
        noteMap.set(note.id, { ...note });
      }
    }
  };

  (localNotes || []).forEach(processNote);
  (remoteNotes || []).forEach(processNote);

  return Array.from(noteMap.values()).sort((a, b) => {
    return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
  });
}

/**
 * Saves notes list atomically to file.
 * @param {Array<Object>} notesList - Notes array to save.
 * @param {string} filepath - Target file path.
 */
export function saveNotesAtomically(notesList, filepath) {
  if (!filepath) throw new Error("Filepath required.");
  const tmpPath = `${filepath}.tmp`;
  const dir = path.dirname(filepath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const content = JSON.stringify(notesList, null, 2);
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, filepath);
}

/**
 * Loads notes list atomically from file.
 * @param {string} filepath - Target file path.
 * @returns {Array<Object>} Loaded notes array.
 */
export function loadNotesAtomically(filepath) {
  if (!filepath || !fs.existsSync(filepath)) return [];
  try {
    const raw = fs.readFileSync(filepath, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data.map(normalizeNote) : [];
  } catch (err) {
    console.error(`Error loading notes from ${filepath}:`, err);
    return [];
  }
}
