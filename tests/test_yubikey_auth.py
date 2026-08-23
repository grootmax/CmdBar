import json
import os
import pytest
from companion.yubikey_auth import (
    YubiKeyAuthManager,
    is_modhex,
    validate_yubico_otp,
    verify_hmac_sha1_challenge_response,
    verify_fido2_assertion,
    wait_for_touch_confirmation,
    generate_emergency_codes,
    verify_and_consume_emergency_code,
    is_sensitive_command,
    benchmark_yubikey_auth,
)
from companion.dbus_service import CmdBarDBusService
from companion.dbus_client import CmdBarDBusClient


def test_is_modhex():
    assert is_modhex("cbdefghijklnrtuv") is True
    assert is_modhex("CCCCCCBEDVCE") is True
    assert is_modhex("invalid_xyz!") is False
    assert is_modhex("") is False
    assert is_modhex(None) is False


def test_validate_yubico_otp():
    valid_otp = "ccccccbedvcebcgdehbcfnhfhkfvvtrgeubfnfgnrtgr"
    valid, pub_id, msg = validate_yubico_otp(valid_otp, "ccccccbedvce")
    assert valid is True
    assert pub_id == "ccccccbedvce"

    # Mismatched prefix
    valid_mismatch, pub_id_mismatch, _ = validate_yubico_otp(
        valid_otp, "differentprefix"
    )
    assert valid_mismatch is False
    assert pub_id_mismatch == "ccccccbedvce"

    # Invalid length
    valid_len, _, msg_len = validate_yubico_otp("short_otp")
    assert valid_len is False
    assert "Invalid OTP length" in msg_len

    # Non-modhex chars
    valid_chars, _, _ = validate_yubico_otp(
        "ccccccbedvcebcgdehbcfnhfhkfvvtrgeubfnfgnrtgX"
    )
    assert valid_chars is False


def test_verify_hmac_sha1_challenge_response():
    secret_hex = "000102030405060708090a0b0c0d0e0f10111213"
    challenge_hex = "0001020304050607"
    # Expected HMAC-SHA1 of secret_hex and challenge_hex
    import hmac, hashlib

    expected = hmac.new(
        bytes.fromhex(secret_hex), bytes.fromhex(challenge_hex), hashlib.sha1
    ).hexdigest()

    assert (
        verify_hmac_sha1_challenge_response(secret_hex, challenge_hex, expected) is True
    )
    assert (
        verify_hmac_sha1_challenge_response(secret_hex, challenge_hex, "wrong_response")
        is False
    )


def test_verify_fido2_assertion():
    assertion = {
        "user_presence": True,
        "user_verification": True,
        "challenge": "challenge_123",
        "signature": "mock_valid",
    }
    valid, msg = verify_fido2_assertion(assertion, "challenge_123")
    assert valid is True

    # User presence false
    assertion_no_presence = dict(assertion)
    assertion_no_presence["user_presence"] = False
    valid_no_pres, _ = verify_fido2_assertion(assertion_no_presence, "challenge_123")
    assert valid_no_pres is False

    # Challenge mismatch
    valid_mismatch, _ = verify_fido2_assertion(assertion, "wrong_challenge")
    assert valid_mismatch is False


def test_wait_for_touch_confirmation():
    # Simulator confirms touch immediately
    valid, msg = wait_for_touch_confirmation(
        timeout_seconds=0.5, touch_simulator=lambda: True
    )
    assert valid is True
    assert "confirmed" in msg

    # Simulator rejects touch
    rejected, _ = wait_for_touch_confirmation(
        timeout_seconds=0.5, touch_simulator=lambda: False
    )
    assert rejected is False

    # Timeout
    timeout, msg_timeout = wait_for_touch_confirmation(
        timeout_seconds=0.01, touch_simulator=lambda: None
    )
    assert timeout is False
    assert "timed out" in msg_timeout


def test_generate_and_consume_emergency_codes():
    raw_codes, hashed_codes = generate_emergency_codes(count=3)
    assert len(raw_codes) == 3
    assert len(hashed_codes) == 3

    yk_config = {"emergency_codes": list(hashed_codes)}

    # Consume valid emergency code
    valid, msg = verify_and_consume_emergency_code(raw_codes[0], yk_config)
    assert valid is True
    assert len(yk_config["emergency_codes"]) == 2

    # Attempt reuse (single-use consumption)
    valid_reuse, _ = verify_and_consume_emergency_code(raw_codes[0], yk_config)
    assert valid_reuse is False

    # Consume second code
    valid2, _ = verify_and_consume_emergency_code(raw_codes[1], yk_config)
    assert valid2 is True
    assert len(yk_config["emergency_codes"]) == 1


def test_is_sensitive_command():
    # Marked commands
    assert is_sensitive_command({"name": "Deploy", "requires_yubikey": True}) is True
    assert is_sensitive_command({"name": "Drop DB", "sensitive": True}) is True
    assert is_sensitive_command({"name": "Reset", "yubikey_required": True}) is True

    # Pattern matched commands
    assert is_sensitive_command("sudo systemctl restart nginx") is True
    assert is_sensitive_command("rm -rf /tmp/build") is True
    assert (
        is_sensitive_command("aws secretsmanager get-secret-value --secret-id prod")
        is True
    )
    assert is_sensitive_command("vault kv get secret/db") is True

    # Safe commands
    assert is_sensitive_command("echo Hello World") is False
    assert is_sensitive_command("ping -c 3 google.com") is False


def test_yubikey_auth_manager():
    manager = YubiKeyAuthManager()

    # Safe command passes without payload
    valid_safe, _ = manager.authenticate_command("echo Hello")
    assert valid_safe is True

    # Sensitive command with touch simulator
    sensitive_cmd = {"name": "Sudo System Check", "command": "sudo systemctl status"}
    valid_touch, _ = manager.authenticate_command(
        sensitive_cmd,
        {"mode": "touch", "touch_simulator": lambda: True},
        {"yubikey": {"enabled": True}},
    )
    assert valid_touch is True

    # Sensitive command with emergency code
    raw_codes, hashed_codes = generate_emergency_codes(count=1)
    yk_cfg = {"enabled": True, "emergency_codes": hashed_codes}
    valid_emergency, _ = manager.authenticate_command(
        sensitive_cmd,
        {"mode": "emergency", "emergency_code": raw_codes[0]},
        {"yubikey": yk_cfg},
    )
    assert valid_emergency is True


def test_benchmark_yubikey_auth():
    bench = benchmark_yubikey_auth(iterations=50)
    assert bench["total_passed_benchmark"] is True
    assert bench["avg_otp_ms"] < 50.0
    assert bench["avg_fido2_ms"] < 50.0


def test_dbus_yubikey_integration(temp_config_file):
    if os.path.exists(temp_config_file):
        os.remove(temp_config_file)
    from companion.companion_app import init_config

    init_config()

    service = CmdBarDBusService(config_path=temp_config_file)
    client = CmdBarDBusClient(service=service)

    service.add_command(
        "Sensitive Sudo Task", "sudo systemctl restart service", "Admin"
    )

    assert client.is_yubikey_required("Sensitive Sudo Task") is True

    raw_codes = client.generate_emergency_codes(count=2)
    assert len(raw_codes) == 2

    # Verify and consume emergency code via D-Bus client
    consumed = client.verify_emergency_code(raw_codes[0])
    assert consumed is True

    # Re-use should fail
    consumed_again = client.verify_emergency_code(raw_codes[0])
    assert consumed_again is False
