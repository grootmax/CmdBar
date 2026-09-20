#!/usr/bin/env python3
"""
Re-export YubiKey Authentication Module for app package compatibility.
"""
from companion.yubikey_auth import (
    YUBIKEY_MODES,
    SENSITIVE_PATTERNS,
    is_command_sensitive,
    validate_modhex,
    parse_otp,
    verify_touch,
    verify_otp,
    create_challenge,
    verify_fido2_assertion,
    generate_emergency_codes,
    verify_emergency_code,
    register_device,
    YubiKeyAuthManager,
)

__all__ = [
    "YUBIKEY_MODES",
    "SENSITIVE_PATTERNS",
    "is_command_sensitive",
    "validate_modhex",
    "parse_otp",
    "verify_touch",
    "verify_otp",
    "create_challenge",
    "verify_fido2_assertion",
    "generate_emergency_codes",
    "verify_emergency_code",
    "register_device",
    "YubiKeyAuthManager",
]
