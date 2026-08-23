# Quick Notes & Scratchpad

CmdBar provides a lightweight, fast, and feature-packed Quick Notes & Scratchpad system built directly into your desktop environment and CLI companion app.

## Key Features

1. **Plain-Text & Markdown Support**
   - Full support for plain text and Markdown formatting (`# Headers`, `**bold**`, `*italic*`, `` `code` ``, code blocks, links, lists, and `- [ ]` task checkboxes).
   - Render Markdown into formatted preview HTML or strip Markdown to plain text.

2. **Quick Scratchpad**
   - Instant-access scratchpad note (`getScratchpad` / `updateScratchpad`) for capturing quick thoughts, code snippets, or command outputs.

3. **Tag Organization**
   - Categorize and organize notes with custom tags (`#work`, `#devops`, `#todo`).
   - Filter notes by tag using the `tag:name` query syntax or tag filtering options.

4. **Attach Commands**
   - Attach shell commands directly to notes.
   - Run attached commands directly from the note interface or D-Bus API.

5. **Share via Link**
   - Share notes via portable `cmdbar://note/share?data=...` links containing base64 encoded title, content, tags, and attached commands.
   - Import notes seamlessly from share links.

6. **Cross-Device Sync**
   - Sync notes safely across devices using atomic file persistence and timestamp-based conflict resolution (`mergeNotes`).

7. **D-Bus Integration**
   - Manage notes, search, update scratchpad, and generate share links over D-Bus (`org.gnome.CmdBar`).
