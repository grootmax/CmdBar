# YubiKey 2FA Authentication for CmdBar

## Overview

CmdBar provides hardware-backed YubiKey two-factor authentication (2FA) for sensitive commands. This feature ensures that high-risk operations (such as running `sudo`, destructive database actions, or deploying production infrastructure) require physical touch confirmation or hardware key assertion before execution.

---

## Features

- **Sensitive Command Detection**: Automatically identifies sensitive commands (e.g., `sudo`, `rm -rf`, `vault`, `aws secretsmanager`, `kubectl delete`) or explicitly flagged commands (`requires_yubikey: true`, `sensitive: true`).
- **Touch-to-Confirm**: Requires physical interaction with the YubiKey hardware device with configurable timeout window (default 30 seconds).
- **Yubico OTP Support**: Parses and validates 44-character modhex Yubico OTP strings against registered key prefixes.
- **FIDO2 / U2F Assertion**: Hardware-backed CTAP2 / WebAuthn touch assertions with user presence flags and challenge verification.
- **HMAC-SHA1 Challenge-Response**: Cryptographic slot challenge verification.
- **Emergency Access Recovery Codes**: Single-use cryptographic recovery codes (`X8K2-9M1L`) hashed with SHA-256 for emergency bypass when hardware key is unavailable. Single-use consumption guarantees zero replay ability.
- **D-Bus Integration**: D-Bus API methods for querying YubiKey authentication requirement, authenticating via YubiKey/emergency codes, and managing emergency recovery codes remotely.
- **Performance Optimized**: Sub-millisecond local verification latency (< 50ms requirement).

---

## Configuration Schema

In `~/.config/cmdbar/config.json`:

```json
{
  "yubikey": {
    "enabled": true,
    "default_mode": "touch",
    "timeout_seconds": 30,
    "registered_keys": [
      {
        "id": "yk-01",
        "name": "Primary YubiKey 5C",
        "otp_prefix": "ccccccbedvce",
        "public_key": "04..."
      }
    ],
    "emergency_codes": [
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    ]
  },
  "categories": [
    {
      "name": "Production Infrastructure",
      "commands": [
        {
          "name": "Restart System Service",
          "command": "sudo systemctl restart nginx",
          "requires_yubikey": true
        }
      ]
    }
  ]
}
```

---

## Authentication Modes

1. **Touch-to-Confirm (`mode: "touch"`)**:
   Prompts the user to touch the YubiKey key within `timeout_seconds`.

2. **Yubico OTP (`mode: "otp"`)**:
   Accepts a 44-character Yubico OTP token (e.g. `ccccccbedvce...`), extracts the 12-char public ID (`ccccccbedvce`), and validates against registered key prefixes.

3. **FIDO2 / U2F (`mode: "fido2"`)**:
   Verifies WebAuthn assertion data including `user_presence` touch flag and challenge matching.

4. **Emergency Access (`mode: "emergency"`)**:
   Allows user to enter a 8-character single-use emergency recovery code. The code is SHA-256 hashed and matched against stored `emergency_codes`. Once used, the hash is immediately consumed and removed from configuration.

---

## D-Bus API Methods

The `org.gnome.CmdBar` interface includes the following YubiKey methods:

- `IsYubiKeyRequired(string name) -> boolean`: Returns true if command requires YubiKey authentication.
- `AuthenticateYubiKey(string name, string mode, string credential) -> (boolean success, string message)`: Authenticates command execution using specified mode (touch, otp, fido2, emergency).
- `GenerateEmergencyCodes(int count) -> string (JSON)`: Generates `count` emergency recovery codes, saves hashes in active configuration, and returns raw code list.
- `VerifyEmergencyCode(string code) -> boolean`: Verifies and consumes a single-use emergency recovery code.

---

## Programmatic API Usage

### Python (`companion/yubikey_auth.py`)

```python
from companion.yubikey_auth import YubiKeyAuthManager, is_sensitive_command

manager = YubiKeyAuthManager(config)

# Check sensitivity
if is_sensitive_command({"command": "sudo systemctl restart nginx"}):
    success, msg = manager.authenticate_command(
        "sudo systemctl restart nginx",
        {"mode": "touch"}
    )
    if success:
        print("YubiKey authentication passed!")
```

### JavaScript (`extension/yubikeyAuth.js`)

```javascript
import { isSensitiveCommand, authenticateCommand } from './extension/yubikeyAuth.js';

if (isSensitiveCommand(cmdObj)) {
    const res = await authenticateCommand(cmdObj, { mode: 'touch' }, config);
    if (res.success) {
        // Execute sensitive command
    }
}
```
