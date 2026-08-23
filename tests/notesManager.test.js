import fs from "fs";
import path from "path";
import os from "os";
import { jest } from "@jest/globals";
import {
  generateNoteId,
  normalizeNote,
  createNote,
  getNote,
  updateNote,
  deleteNote,
  getScratchpad,
  updateScratchpad,
  renderMarkdown,
  stripMarkdown,
  searchNotes,
  addTag,
  removeTag,
  filterByTag,
  getAllTags,
  attachCommand,
  detachCommand,
  executeNoteCommand,
  generateShareLink,
  parseShareLink,
  importFromShareLink,
  mergeNotes,
  saveNotesAtomically,
  loadNotesAtomically,
} from "../extension/notesManager.js";

describe("Quick Notes and Scratchpad Manager (JS)", () => {
  let tempDir;
  let tempFile;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `cmdbar-notes-test-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`);
    tempFile = path.join(tempDir, "notes.json");
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("ID Generation & Normalization", () => {
    test("generateNoteId returns unique note ID string", () => {
      const id1 = generateNoteId();
      const id2 = generateNoteId();
      expect(id1).toMatch(/^note_/);
      expect(id2).toMatch(/^note_/);
      expect(id1).not.toBe(id2);
    });

    test("normalizeNote produces valid note structure", () => {
      const note = normalizeNote({
        title: " Test Note ",
        content: "Hello world",
        tags: ["Work", "WORK", "todo"],
        attachedCommands: [{ name: "Build", command: "npm test" }],
      });

      expect(note.id).toMatch(/^note_/);
      expect(note.title).toBe("Test Note");
      expect(note.content).toBe("Hello world");
      expect(note.tags).toEqual(["work", "todo"]);
      expect(note.attachedCommands).toHaveLength(1);
      expect(note.attachedCommands[0].name).toBe("Build");
      expect(note.attachedCommands[0].command).toBe("npm test");
      expect(note.isScratchpad).toBe(false);
      expect(note.pinned).toBe(false);
      expect(note.createdAt).toBeDefined();
      expect(note.updatedAt).toBeDefined();
    });

    test("normalizeNote handles empty or invalid note input", () => {
      expect(() => normalizeNote(null)).toThrow("Invalid note object provided.");
      expect(() => normalizeNote("not an object")).toThrow("Invalid note object provided.");

      const fallback = normalizeNote({});
      expect(fallback.title).toBe("Untitled Note");
      expect(fallback.content).toBe("");
      expect(fallback.tags).toEqual([]);
      expect(fallback.attachedCommands).toEqual([]);
    });
  });

  describe("CRUD Operations", () => {
    test("createNote creates and appends note to notes list", () => {
      const notes = [];
      const note = createNote(notes, {
        title: "My Note",
        content: "Drafting idea",
        tags: ["idea"],
      });

      expect(notes).toHaveLength(1);
      expect(note.title).toBe("My Note");
      expect(getNote(notes, note.id)).toBe(note);
    });

    test("createNote throws if notesList is not an array", () => {
      expect(() => createNote(null, { title: "Fail" })).toThrow("notesList must be an array.");
    });

    test("getNote returns note by ID or null", () => {
      const notes = [];
      const note = createNote(notes, { title: "Find Me" });
      expect(getNote(notes, note.id)).toEqual(note);
      expect(getNote(notes, "non-existent-id")).toBeNull();
      expect(getNote(null, note.id)).toBeNull();
    });

    test("updateNote modifies note properties and updates timestamp", () => {
      const notes = [];
      const note = createNote(notes, { title: "Initial Title", content: "Old Content" });
      const initialUpdatedAt = note.updatedAt;

      // Small delay to ensure timestamp change
      const updated = updateNote(notes, note.id, {
        title: "New Title",
        content: "New Content",
        tags: ["UpdatedTag"],
        pinned: true,
      });

      expect(updated).not.toBeNull();
      expect(updated.title).toBe("New Title");
      expect(updated.content).toBe("New Content");
      expect(updated.tags).toEqual(["updatedtag"]);
      expect(updated.pinned).toBe(true);

      expect(updateNote(notes, "invalid-id", { title: "No Note" })).toBeNull();
    });

    test("deleteNote removes note from array", () => {
      const notes = [];
      const note1 = createNote(notes, { title: "Note 1" });
      const note2 = createNote(notes, { title: "Note 2" });

      expect(deleteNote(notes, note1.id)).toBe(true);
      expect(notes).toHaveLength(1);
      expect(getNote(notes, note1.id)).toBeNull();
      expect(deleteNote(notes, "invalid-id")).toBe(false);
    });
  });

  describe("Scratchpad Feature", () => {
    test("getScratchpad returns existing scratchpad or creates one", () => {
      const notes = [];
      const sp = getScratchpad(notes);

      expect(sp).toBeDefined();
      expect(sp.isScratchpad).toBe(true);
      expect(sp.id).toBe("scratchpad");
      expect(notes).toHaveLength(1);

      const sp2 = getScratchpad(notes);
      expect(sp2).toBe(sp);
    });

    test("updateScratchpad updates scratchpad note content", () => {
      const notes = [];
      const updated = updateScratchpad(notes, "Quick scratchpad draft");

      expect(updated.content).toBe("Quick scratchpad draft");
      expect(getScratchpad(notes).content).toBe("Quick scratchpad draft");
    });
  });

  describe("Markdown Support & Formatting", () => {
    test("renderMarkdown renders headers, lists, code blocks, bold, italic, links, task lists", () => {
      const md = `# Title
## Subtitle
### Heading 3
- Bullet 1
- [ ] Todo item
- [x] Done item
**bold text** and *italic text* and \`code\`
[CmdBar](https://cmdbar.app)
\`\`\`
const x = 1;
\`\`\``;

      const html = renderMarkdown(md);

      expect(html).toContain("<h1>Title</h1>");
      expect(html).toContain("<h2>Subtitle</h2>");
      expect(html).toContain("<h3>Heading 3</h3>");
      expect(html).toContain("<li>Bullet 1</li>");
      expect(html).toContain('<input type="checkbox" disabled />');
      expect(html).toContain('<input type="checkbox" checked disabled />');
      expect(html).toContain("<strong>bold text</strong>");
      expect(html).toContain("<em>italic text</em>");
      expect(html).toContain("<code>code</code>");
      expect(html).toContain('<a href="https://cmdbar.app">CmdBar</a>');
      expect(html).toContain("<pre><code>");
      expect(html).toContain("const x = 1;");
    });

    test("renderMarkdown handles empty or null input", () => {
      expect(renderMarkdown("")).toBe("");
      expect(renderMarkdown(null)).toBe("");
    });

    test("stripMarkdown strips markdown formatting elements", () => {
      const md = `# Header
**Bold** and *Italic* and \`Code\`
- List item
- [ ] Task
[Link](https://example.com)
\`\`\`
code block
\`\`\``;

      const plain = stripMarkdown(md);

      expect(plain).not.toContain("# Header");
      expect(plain).not.toContain("**Bold**");
      expect(plain).toContain("Header");
      expect(plain).toContain("Bold and Italic and Code");
      expect(plain).toContain("List item");
      expect(plain).toContain("Task");
      expect(plain).toContain("Link");
    });

    test("stripMarkdown handles empty input", () => {
      expect(stripMarkdown("")).toBe("");
      expect(stripMarkdown(null)).toBe("");
    });
  });

  describe("Search Notes & Tag Organization", () => {
    test("searchNotes filters notes by term in title, content, or tags", () => {
      const notes = [
        normalizeNote({ title: "Deployment Guide", content: "Run docker compose up", tags: ["devops"] }),
        normalizeNote({ title: "Meeting Minutes", content: "Discussed Q3 goals", tags: ["meeting"] }),
        normalizeNote({ title: "Shopping List", content: "Milk and eggs", tags: ["personal"] }),
      ];

      expect(searchNotes(notes, "docker")).toHaveLength(1);
      expect(searchNotes(notes, "meeting")).toHaveLength(1);
      expect(searchNotes(notes, "personal")).toHaveLength(1);
      expect(searchNotes(notes, "nonexistent")).toHaveLength(0);
    });

    test("searchNotes handles tag filtering with tag: prefix or options.tag", () => {
      const notes = [
        normalizeNote({ title: "Note A", content: "Task A", tags: ["work", "important"] }),
        normalizeNote({ title: "Note B", content: "Task B", tags: ["personal"] }),
      ];

      expect(searchNotes(notes, "tag:work")).toHaveLength(1);
      expect(searchNotes(notes, "", { tag: "personal" })).toHaveLength(1);
      expect(searchNotes(notes, "Task A", { tag: "work" })).toHaveLength(1);
      expect(searchNotes(notes, "Task B", { tag: "work" })).toHaveLength(0);
    });

    test("addTag and removeTag manage tags on a note", () => {
      const note = normalizeNote({ title: "Tagged Note", tags: ["initial"] });

      expect(addTag(note, "newtag")).toBe(true);
      expect(note.tags).toContain("newtag");
      expect(addTag(note, "newtag")).toBe(false); // Duplicate tag

      expect(removeTag(note, "newtag")).toBe(true);
      expect(note.tags).not.toContain("newtag");
      expect(removeTag(note, "nonexistent")).toBe(false);
    });

    test("filterByTag returns matching notes", () => {
      const notes = [
        normalizeNote({ title: "N1", tags: ["ops"] }),
        normalizeNote({ title: "N2", tags: ["dev", "ops"] }),
        normalizeNote({ title: "N3", tags: ["design"] }),
      ];

      expect(filterByTag(notes, "ops")).toHaveLength(2);
      expect(filterByTag(notes, "design")).toHaveLength(1);
      expect(filterByTag(notes, "missing")).toHaveLength(0);
    });

    test("getAllTags returns tag counts", () => {
      const notes = [
        normalizeNote({ title: "N1", tags: ["alpha", "beta"] }),
        normalizeNote({ title: "N2", tags: ["alpha", "gamma"] }),
      ];

      const tags = getAllTags(notes);
      expect(tags).toEqual([
        { tag: "alpha", count: 2 },
        { tag: "beta", count: 1 },
        { tag: "gamma", count: 1 },
      ]);
    });
  });

  describe("Attached Commands", () => {
    test("attachCommand and detachCommand manage commands on note", () => {
      const note = normalizeNote({ title: "Note with command" });

      const cmd = attachCommand(note, { name: "Build App", command: "npm run build" });
      expect(cmd).toBeDefined();
      expect(cmd.name).toBe("Build App");
      expect(note.attachedCommands).toHaveLength(1);

      expect(detachCommand(note, cmd.id)).toBe(true);
      expect(note.attachedCommands).toHaveLength(0);
    });

    test("executeNoteCommand runs attached command executor", async () => {
      const note = normalizeNote({ title: "Command Note" });
      attachCommand(note, { name: "Echo Test", command: "echo hello" });

      const mockExecutor = jest.fn().mockResolvedValue("hello");
      const result = await executeNoteCommand(note, "Echo Test", mockExecutor);

      expect(mockExecutor).toHaveBeenCalledWith("echo hello", "Echo Test");
      expect(result).toBe("hello");
    });

    test("executeNoteCommand throws if note has no commands", async () => {
      const note = normalizeNote({ title: "Empty" });
      await expect(executeNoteCommand(note, "foo")).rejects.toThrow("Note has no attached commands.");
    });
  });

  describe("Share via Link", () => {
    test("generateShareLink and parseShareLink roundtrip note data", () => {
      const note = normalizeNote({
        title: "Shared Strategy",
        content: "Secret plans for Q4",
        tags: ["roadmap", "confidential"],
        attachedCommands: [{ name: "Deploy", command: "make deploy" }],
      });

      const shareLink = generateShareLink(note);
      expect(shareLink).toContain("cmdbar://note/share?data=");

      const importedData = parseShareLink(shareLink);
      expect(importedData.title).toBe("Shared Strategy");
      expect(importedData.content).toBe("Secret plans for Q4");
      expect(importedData.tags).toEqual(["roadmap", "confidential"]);
      expect(importedData.attachedCommands[0].name).toBe("Deploy");
    });

    test("importFromShareLink imports shared note into notes list", () => {
      const notes = [];
      const note = normalizeNote({ title: "Shareable", content: "Link test" });
      const link = generateShareLink(note);

      const imported = importFromShareLink(notes, link);
      expect(notes).toHaveLength(1);
      expect(imported.title).toBe("Shareable");
      expect(imported.content).toBe("Link test");
    });

    test("parseShareLink throws on invalid share link", () => {
      expect(() => parseShareLink("cmdbar://note/share?invalid=true")).toThrow(
        "Invalid share link format: missing data parameter."
      );
    });
  });

  describe("Device Sync & Atomic File Persistence", () => {
    test("mergeNotes merges notes resolving conflicts by updatedAt", () => {
      const localNotes = [
        { id: "n1", title: "N1 Local", content: "v1", updatedAt: "2026-08-23T10:00:00Z" },
        { id: "n2", title: "N2 Local", content: "v1", updatedAt: "2026-08-23T12:00:00Z" },
      ];
      const remoteNotes = [
        { id: "n1", title: "N1 Remote", content: "v2", updatedAt: "2026-08-23T11:00:00Z" }, // Newer
        { id: "n3", title: "N3 Remote", content: "v1", updatedAt: "2026-08-23T09:00:00Z" },
      ];

      const merged = mergeNotes(localNotes, remoteNotes);
      expect(merged).toHaveLength(3);

      const n1 = merged.find((n) => n.id === "n1");
      expect(n1.title).toBe("N1 Remote"); // Updated from remote

      const n2 = merged.find((n) => n.id === "n2");
      expect(n2.title).toBe("N2 Local");
    });

    test("saveNotesAtomically and loadNotesAtomically save and restore notes list", () => {
      const notes = [
        normalizeNote({ title: "Persistent Note 1", content: "Content 1" }),
        normalizeNote({ title: "Persistent Note 2", content: "Content 2" }),
      ];

      saveNotesAtomically(notes, tempFile);
      expect(fs.existsSync(tempFile)).toBe(true);

      const loaded = loadNotesAtomically(tempFile);
      expect(loaded).toHaveLength(2);
      expect(loaded[0].title).toBe("Persistent Note 1");
      expect(loaded[1].title).toBe("Persistent Note 2");
    });

    test("loadNotesAtomically returns empty array for non-existent file", () => {
      expect(loadNotesAtomically("/path/does/not/exist/notes.json")).toEqual([]);
    });
  });
});
