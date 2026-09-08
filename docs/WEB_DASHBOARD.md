# CmdBar Web Dashboard Documentation

The **CmdBar Web Dashboard** is an enterprise-grade web application and drag-and-drop editor for managing CmdBar configurations, category structures, and command parameters.

## Key Features

1. **Drag-and-Drop Editor**:
   - Reorder categories and command shortcuts with interactive drag handles.
   - Drag shortcuts across categories to move them seamlessly.
   - Form-based parameter configuration (execution mode, placeholder patterns, regex validation).

2. **Real-Time Top-Bar Preview**:
   - Interactive simulation of the GNOME 46 top-bar indicator and dropdown menu.
   - Live search input matching with character highlighting.
   - Formatted output preview (pretty JSON, ASCII tables, code blocks).

3. **Team Collaboration & Workspaces**:
   - Switch between personal and team workspace profiles.
   - Export and import team configuration packages.
   - 2-way structural configuration merge tool with conflict resolution.
   - Real-time event sync via Server-Sent Events (SSE).

4. **Mobile Responsive & Offline Capable (PWA)**:
   - Optimized UI layout for desktop, tablet, and mobile screens.
   - Progressive Web App with Service Worker (`sw.js`) and Web App Manifest (`manifest.json`).
   - LocalStorage / IndexedDB fallback offline buffer when disconnected.

5. **Security**:
   - Path traversal prevention.
   - Origin / CSRF checks on state-changing API endpoints.
   - Input schema validation and parameter regex verification.

## Running the Dashboard

Start the web server using `make` or Python:
```bash
make dashboard
# or
python3 scripts/serve_dashboard.py --port 8080
```
Then visit `http://localhost:8080` in your web browser.
