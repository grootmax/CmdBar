# Live Terminal Sharing Developer Specification

## Architecture Overview

The **Live Terminal Sharing** feature provides real-time collaborative terminal sessions between host operators and remote participants within CmdBar.

### Core Modules

1. **`TerminalSession`**: Orchestrates active collaborative sessions, scrollback buffers, participant rosters, and event streams.
2. **`E2EEncryptor`**: Provides zero-trust end-to-end encryption using AES-256-GCM (Node / Extension) and AES-256 authenticated encryption with HMAC-SHA256 (Python Companion).
3. **`PermissionManager`**: Controls granular access roles (`admin`, `read-write`, `read-only`) and handles dynamic control requests.
4. **`CursorTracker`**: Tracks real-time participant cursor coordinates (`row`, `col`), selection bounds, and assigns deterministic user colors.
5. **`SessionRecorder` & `SessionPlayer`**: Captures timestamped event streams, exports to JSON or Asciinema v2 formats, and provides interactive replay.
6. **`WebRTCManager`**: Manages WebRTC peer connection lifecycle, SDP offers/answers, ICE candidate exchange, and encrypted data channels.

## Data Flows

```
[ Host Terminal ] ---> TerminalSession ---> E2EEncryptor ---> WebRTC Data Channel
                                                                    |
                                                                    v
[ Remote Client ] <--- TerminalSession <--- E2EEncryptor <-----------
```

## Security & Encryption Specs

- **Key Generation**: 256-bit cryptographic keys generated via CSPRNG (`randomBytes` / `secrets.token_hex`).
- **Passphrase Derivation**: PBKDF2 with SHA-256 and 10,000 iterations.
- **Payload Integrity**: Authenticated AEAD tags ensure payloads cannot be tampered with in transit.
