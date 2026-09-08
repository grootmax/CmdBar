# Live Terminal Sharing

CmdBar provides collaborative terminal session capabilities, enabling real-time terminal input/output streaming, participant cursor tracking, permission control, session recording, E2E encryption, and WebRTC channel abstractions.

## Key Capabilities

1. **Collaborative Terminal Sessions**:
   - Create, join, manage, and end live terminal sharing sessions.
   - Real-time streaming of stdout/stderr terminal output and keyboard input.

2. **Real-Time Cursor Tracking**:
   - Live tracking of participant cursors (line, column, visibility, selection).
   - Distinct participant names and custom color indicators.

3. **Permission Control**:
   - Role-based permissions: `Host` (full control), `Editor` (read-write), and `Viewer` (read-only).
   - Interactive permission requests: Viewers can request write access, which Hosts/Editors can approve or revoke.

4. **Session Recording & Export**:
   - Frame recording with relative timestamps.
   - Pause, resume, and stop recording controls.
   - Export recordings to standard **Asciinema v2** format or structured **JSON**.

5. **End-to-End Encryption (E2E)**:
   - Symmetric 256-bit key encryption (AES-256-GCM / HMAC-XOR).
   - Automatic key derivation from passphrases.

6. **WebRTC Channel Abstraction**:
   - SDP offer/answer exchange and ICE candidate management.
   - Seamless P2P data streaming with fallback handling.

## Usage & Configuration

In `~/.config/cmdbar/config.json`:

```json
{
  "live_terminal_sharing": {
    "enabled": true,
    "default_role": "viewer",
    "e2e_encryption": true,
    "record_sessions": false,
    "max_participants": 10,
    "signaling_server": "wss://signaling.cmdbar.local"
  }
}
```

## D-Bus Interface Integration

External tools and scripts can manage live terminal sharing sessions via D-Bus (`org.gnome.CmdBar`):

- `StartTerminalSharing(sessionId, title)`
- `StopTerminalSharing(sessionId)`
- `GetTerminalSharingSessions()`
