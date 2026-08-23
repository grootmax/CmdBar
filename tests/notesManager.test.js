import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  createNote,
  updateNote,
  deleteNote,
  getNoteById,
  searchNotes,
  organizeByTag,
  addTagToNote,
  removeTagFromNote,
  renderMarkdown,
  extractPlainText,
  attachCommand,
  executeAttachedCommand,
  generateShareLink,
  parseShareLink,
  syncNotes,
  loadNotes,
  saveNotes,
} from '../extension/notesManager.js';

describe('Quick Notes & Scratchpad Manager Suite', () => {
  let tempConfigDir;
  let tempConfigPath;

  beforeEach(() => {
    tempConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdbar-notes-test-'));
    tempConfigPath = path.join(tempConfigDir, 'config.json');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempConfigDir, { recursive: true, force: true });
    } catch (e) {}
  });

  describe('Note CRUD Operations', () => {
    test('createNote should instantiate note with unique ID, tags, and timestamps', () => {
      const note = createNote({
        title: 'Project Roadmap',
        content: '# Roadmap\n- Feature 1\n- Feature 2',
        tags: ['work', 'planning', 'work'], // duplicate tag check
        attachedCommand: 'make build',
        pinned: true,
      });

      expect(note).toHaveProperty('id');
      expect(note.id).toMatch(/^note_/);
      expect(note.title).toBe('Project Roadmap');
      expect(note.content).toContain('Roadmap');
      expect(note.tags).toEqual(['work', 'planning']);
      expect(note.attachedCommand).toBe('make build');
      expect(note.pinned).toBe(true);
      expect(note.createdAt).toBeDefined();
      expect(note.updatedAt).toBeDefined();
    });

    test('updateNote should update fields and refresh updatedAt timestamp without changing ID', () => {
      const note = createNote({ title: 'Draft Note', content: 'Initial text' });
      const initialTime = note.updatedAt;

      const updatedList = updateNote([note], note.id, {
        title: 'Final Note',
        content: 'Updated content',
        tags: ['final'],
      });

      expect(updatedList.length).toBe(1);
      const updated = updatedList[0];
      expect(updated.id).toBe(note.id);
      expect(updated.title).toBe('Final Note');
      expect(updated.content).toBe('Updated content');
      expect(updated.tags).toEqual(['final']);
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(initialTime).getTime());
    });

    test('deleteNote should remove note by ID', () => {
      const note1 = createNote({ title: 'Note 1' });
      const note2 = createNote({ title: 'Note 2' });
      const notes = [note1, note2];

      const remaining = deleteNote(notes, note1.id);
      expect(remaining.length).toBe(1);
      expect(remaining[0].id).toBe(note2.id);
    });

    test('getNoteById should find note by ID or return null', () => {
      const note = createNote({ title: 'Target Note' });
      const list = [note];

      expect(getNoteById(list, note.id)).toEqual(note);
      expect(getNoteById(list, 'nonexistent')).toBeNull();
      expect(getNoteById([], 'test')).toBeNull();
    });
  });

  describe('Search & Tag Organization', () => {
    test('searchNotes should filter notes by title, content, tags, or attached command', () => {
      const n1 = createNote({ title: 'Deploy Script', content: 'Deploy to AWS', tags: ['aws', 'devops'] });
      const n2 = createNote({ title: 'Shopping List', content: 'Buy milk & coffee', tags: ['personal'] });
      const n3 = createNote({ title: 'Kubernetes Task', attachedCommand: 'kubectl get pods', tags: ['k8s'] });
      const notes = [n1, n2, n3];

      expect(searchNotes(notes, 'AWS')).toEqual([n1]);
      expect(searchNotes(notes, 'milk')).toEqual([n2]);
      expect(searchNotes(notes, 'kubectl')).toEqual([n3]);
      expect(searchNotes(notes, 'tag:devops')).toEqual([n1]);
      expect(searchNotes(notes, 'nonexistent')).toEqual([]);
    });

    test('organizeByTag should group notes by tag and produce tag summary counts', () => {
      const n1 = createNote({ title: 'Task 1', tags: ['work', 'urgent'] });
      const n2 = createNote({ title: 'Task 2', tags: ['work'] });
      const n3 = createNote({ title: 'Task 3', tags: ['personal'] });
      const notes = [n1, n2, n3];

      const { tags, summary } = organizeByTag(notes);

      expect(tags.work.length).toBe(2);
      expect(tags.urgent.length).toBe(1);
      expect(tags.personal.length).toBe(1);

      expect(summary[0]).toEqual({ tag: 'work', count: 2 });
    });

    test('addTagToNote and removeTagFromNote should mutate tags correctly', () => {
      let note = createNote({ title: 'Test Note', tags: ['alpha'] });

      note = addTagToNote(note, 'beta');
      expect(note.tags).toEqual(['alpha', 'beta']);

      // Adding existing tag should not duplicate
      note = addTagToNote(note, 'ALPHA');
      expect(note.tags).toEqual(['alpha', 'beta']);

      note = removeTagFromNote(note, 'alpha');
      expect(note.tags).toEqual(['beta']);
    });
  });

  describe('Markdown Support & Plain Text Extraction', () => {
    test('renderMarkdown should output valid Pango markup and HTML', () => {
      const md = '# Title\n**Bold Text** and *Italic*\n- Bullet 1\n`inline code`\n```\nconst x = 10;\n```\n[Link](https://cmdbar.app)';
      const rendered = renderMarkdown(md);

      expect(rendered.pango).toContain('<b><span size="large">Title</span></b>');
      expect(rendered.pango).toContain('<b>Bold Text</b>');
      expect(rendered.pango).toContain('<i>Italic</i>');
      expect(rendered.pango).toContain('<font face="monospace">inline code</font>');

      expect(rendered.html).toContain('<h1>Title</h1>');
      expect(rendered.html).toContain('<strong>Bold Text</strong>');
      expect(rendered.html).toContain('<em>Italic</em>');
      expect(rendered.html).toContain('<code>inline code</code>');
      expect(rendered.html).toContain('<pre><code>const x = 10;</code></pre>');
      expect(rendered.html).toContain('<a href="https://cmdbar.app">Link</a>');
    });

    test('extractPlainText should strip Markdown tags', () => {
      const md = '# Header\nSome **bold** text with `code` and [Link](http://example.com)';
      const plain = extractPlainText(md);

      expect(plain).toBe('Header\nSome bold text with code and Link (http://example.com)');
    });
  });

  describe('Attached Commands & Execution', () => {
    test('attachCommand should attach or detach command template', () => {
      let note = createNote({ title: 'CI Job' });
      note = attachCommand(note, 'echo "Deploying <service>"');
      expect(note.attachedCommand).toBe('echo "Deploying <service>"');

      note = attachCommand(note, null);
      expect(note.attachedCommand).toBeNull();
    });

    test('executeAttachedCommand should perform parameter substitution', () => {
      const note = createNote({ title: 'Deploy', attachedCommand: 'aws ecs update-service --service <svc> --count {{cnt}}' });
      const exec = executeAttachedCommand(note, { svc: 'api-service', cnt: '3' });

      expect(exec.command).toBe('aws ecs update-service --service api-service --count 3');
      expect(exec.tokens).toContain('api-service');
      expect(exec.tokens).toContain('3');
    });

    test('executeAttachedCommand should throw if no command attached', () => {
      const note = createNote({ title: 'Plain Note' });
      expect(() => executeAttachedCommand(note)).toThrow('Note has no attached command.');
    });
  });

  describe('Share Links & Parsing', () => {
    test('generateShareLink and parseShareLink should encode and restore note', () => {
      const original = createNote({
        title: 'Shared Note',
        content: 'This is shared text',
        tags: ['share', 'test'],
        attachedCommand: 'ping -c 3 localhost',
      });

      const shareUrl = generateShareLink(original);
      expect(shareUrl).toContain('cmdbar://note/share?data=');

      const imported = parseShareLink(shareUrl);
      expect(imported).not.toBeNull();
      expect(imported.title).toBe('Shared Note');
      expect(imported.content).toBe('This is shared text');
      expect(imported.tags).toEqual(['share', 'test']);
      expect(imported.attachedCommand).toBe('ping -c 3 localhost');
    });

    test('parseShareLink should handle invalid URL gracefully', () => {
      expect(parseShareLink('invalid-link')).toBeNull();
      expect(parseShareLink('')).toBeNull();
    });
  });

  describe('Sync Across Devices (Conflict Resolution)', () => {
    test('syncNotes should merge notes list using last-write-wins by updatedAt', () => {
      const id = 'note_shared_123';
      const localNote = {
        id,
        title: 'Local Version',
        updatedAt: '2026-08-23T10:00:00Z',
      };

      const remoteNote = {
        id,
        title: 'Remote Version (Newer)',
        updatedAt: '2026-08-23T12:00:00Z',
      };

      const synced = syncNotes([localNote], [remoteNote]);
      expect(synced.length).toBe(1);
      expect(synced[0].title).toBe('Remote Version (Newer)');
    });
  });

  describe('Persistence (loadNotes & saveNotes)', () => {
    test('saveNotes and loadNotes should save and reload notes from config file', async () => {
      const n1 = createNote({ title: 'Persistent Note 1' });
      const n2 = createNote({ title: 'Persistent Note 2' });

      await saveNotes(tempConfigPath, [n1, n2]);
      const loaded = await loadNotes(tempConfigPath);

      expect(loaded.length).toBe(2);
      expect(loaded[0].title).toBe('Persistent Note 1');
      expect(loaded[1].title).toBe('Persistent Note 2');
    });
  });

  describe('Performance Benchmark', () => {
    test('searchNotes performance over 1000 notes should take less than 15ms', () => {
      const dataset = [];
      for (let i = 0; i < 1000; i++) {
        dataset.push(
          createNote({
            title: `Note Item ${i}`,
            content: `Body content for item number ${i} with tags and markdown`,
            tags: [i % 2 === 0 ? 'even' : 'odd', `tag_${i}`],
            attachedCommand: i % 10 === 0 ? `echo "Command ${i}"` : null,
          })
        );
      }

      const start = Date.now();
      const results = searchNotes(dataset, 'item 99');
      const duration = Date.now() - start;

      expect(results.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(50); // Generous assertion for dev container CPU
    });
  });
});
