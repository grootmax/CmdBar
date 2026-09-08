# YubiKey 2FA Authentication Specification

## Overview

CmdBar includes enterprise-grade YubiKey multi-factor authentication (2FA) for sensitive command execution. This feature provides hardware-backed key verification, Touch-to-Confirm presence detection, Yubico OTP support, FIDO2/U2F assertion signature verification, single-use emergency recovery codes, and D-Bus integration.

## Configuration Schema

YubiKey settings are managed within the unified configuration file (`config.json`):

```json
{
  "yubikey": {
    "enabled": true,
    "mode": "touch",
    "require_for_sensitive": true,
    "timeout_seconds": 30,
    "keys": [
      {
        "id": "yubikey_1",
        "name": "Primary YubiKey 5 NFC",
        "device_id": "vvccccccvccc",
        "public_key": "pubkey_vvccccccvccc",
        "created_at": "2026-08-23T12:00:00Z"
      }
    ],
    "emergency_codes": [
      "A1B2-C3D4",
      "E5F6-G7H8"
    ]
  }
}
```

## Authentication Modes

### 1. Touch-to-Confirm (`touch`)
- Requiring physical presence on the hardware key (touch sensor) before executing sensitive commands.
- Defaults to a 30-second timeout.

### 2. Yubico OTP (`otp`)
- Accepts 44-character ModHex encoded Yubico OTP strings.
- Extracts the 12-character device ID prefix and verifies it against registered YubiKey hardware devices.

### 3. FIDO2 / U2F (`fido2` / `u2f`)
- Hardware-backed challenge-response signature verification.
- Validates assertion signatures against stored public keys for registered YubiKey hardware keys.

### 4. Emergency Access
- Single-use 8-character recovery codes (e.g. `A1B2-C3D4`) for emergency access when the hardware key is unavailable.
- Single-use consumption automatically invalidates used codes from configuration upon successful authentication.

## Sensitive Command Detection

A command requires YubiKey 2FA if:
1. The command object contains `sensitive: true`, `require_2fa: true`, or `require_yubikey: true`.
2. The command matches dangerous system execution patterns (`sudo`, `rm -rf`, `dd`, `mkfs`, `systemctl stop`, `aws ecs update-service`, `kubectl delete`, `deploy`, `shutdown`, `reboot`).

## D-Bus API Methods

The D-Bus service interface (`org.gnome.CmdBar`) provides the following YubiKey endpoints:

- `VerifyYubiKey2FA(command_json, auth_data_json) -> bool`: Verifies YubiKey 2FA for a given command.
- `GetYubiKeyStatus() -> json_string`: Returns status and configuration summary.
- `RegisterYubiKeyDevice(device_json) -> bool`: Registers a new hardware key.
- `ValidateEmergencyCode(code) -> bool`: Validates and consumes an emergency code.
