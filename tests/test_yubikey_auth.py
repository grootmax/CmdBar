#!/usr/bin/env python3
"""
Unit and Integration Tests for YubiKey 2FA Authentication in Python Backend.
"""

import pytest
import json
from companion.yubikey_auth import (
    YUBIKEY_MODES,
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
from companion.dbus_service import CmdBarDBusService
from app.config_schema import DEFAULT_CONFIG


class TestYubiKeyAuthentication:
    def test_is_command_sensitive(self):
        assert is_command_sensitive({"command": "echo test", "sensitive": True}) is True
        assert is_command_sensitive({"command": "echo test", "require_2fa": True}) is True
        assert is_command_sensitive("sudo apt update") is True
        assert is_command_sensitive("rm -rf /var/log") is True
        assert is_command_sensitive("systemctl stop docker") is True
        assert is_command_sensitive("aws ecs update-service --service web") is True
        assert is_command_sensitive("kubectl delete deployment app") is True
        assert is_command_sensitive("deploy release") is True
        assert is_command_sensitive("echo hello world") is False
        assert is_command_sensitive("git status") is False

    def test_modhex_validation_and_otp_parsing(self):
        assert validate_modhex("cbdefghijklnrtuv") is True
        assert validate_modhex("vvccccccvccc") is True
        assert validate_modhex("123456") is False

        otp = "vvccccccvccc" + "cbdefghijklnrtuvcbdefghijklnrtuv"
        parsed = parse_otp(otp)
        assert parsed["valid"] is True
        assert parsed["deviceId"] == "vvccccccvccc"
        assert len(parsed["payload"]) == 32

        invalid_parsed = parse_otp("invalid_otp")
        assert invalid_parsed["valid"] is False

    def test_verify_touch(self):
        res = verify_touch(timeout_seconds=10)
        assert res["success"] is True

        res_fail = verify_touch(fail_touch=True)
        assert res_fail["success"] is False

    def test_verify_otp(self):
        otp = "vvccccccvccc" + "cbdefghijklnrtuvcbdefghijklnrtuv"
        res = verify_otp(otp, registered_keys=[])
        assert res["success"] is True

        registered = [{"name": "My YubiKey", "device_id": "vvccccccvccc"}]
        res_reg = verify_otp(otp, registered_keys=registered)
        assert res_reg["success"] is True

        unregistered = [{"name": "Other Key", "device_id": "kkkkkkkkkkkk"}]
        res_unreg = verify_otp(otp, registered_keys=unregistered)
        assert res_unreg["success"] is False

    def test_fido2_assertion_verification(self):
        challenge = create_challenge(32)
        assert len(challenge) >= 16

        pub_key = "pub_key_123"
        sig = f"sig_{challenge}_{pub_key}"
        res = verify_fido2_assertion(challenge, sig, pub_key)
        assert res["success"] is True

        res_missing = verify_fido2_assertion(challenge, "", pub_key)
        assert res_missing["success"] is False

    def test_emergency_recovery_codes(self):
        codes = generate_emergency_codes(5)
        assert len(codes) == 5

        code_to_use = codes[0]
        res = verify_emergency_code(code_to_use, codes)
        assert res["success"] is True
        assert len(res["remainingCodes"]) == 4
        assert code_to_use not in res["remainingCodes"]

        res_invalid = verify_emergency_code("INVALID-CODE", codes)
        assert res_invalid["success"] is False

    def test_device_registration(self):
        dev_info = {"name": "Test Key", "device_id": "vvccccccvccc"}
        res = register_device(dev_info, [])
        assert res["success"] is True
        assert len(res["keys"]) == 1
        assert res["keys"][0]["device_id"] == "vvccccccvccc"

        # Update existing
        dev_info_updated = {"name": "Test Key Updated", "device_id": "vvccccccvccc"}
        res_updated = register_device(dev_info_updated, res["keys"])
        assert res_updated["success"] is True
        assert len(res_updated["keys"]) == 1
        assert res_updated["keys"][0]["name"] == "Test Key Updated"

    def test_yubikey_auth_manager_class(self):
        config = {
            "yubikey": {
                "enabled": True,
                "mode": YUBIKEY_MODES["TOUCH"],
                "require_for_sensitive": True,
                "keys": [{"device_id": "vvccccccvccc"}],
                "emergency_codes": ["EMERG123-CODE"],
            }
        }
        manager = YubiKeyAuthManager(config)
        assert manager.is_enabled() is True
        assert manager.get_mode() == "touch"

        # Bypass for non-sensitive command
        res_non = manager.authenticate_command("echo hello")
        assert res_non["success"] is True
        assert res_non["modeUsed"] == "bypass"

        # Sensitive command touch auth
        res_sens = manager.authenticate_command("sudo reboot")
        assert res_sens["success"] is True
        assert res_sens["modeUsed"] == "touch"

        # Emergency code override
        res_emerg = manager.authenticate_command(
            "sudo reboot", {"emergencyCode": "EMERG123-CODE"}
        )
        assert res_emerg["success"] is True
        assert res_emerg["modeUsed"] == "emergency"

    def test_default_config_and_dbus_api(self):
        assert "yubikey" in DEFAULT_CONFIG
        assert DEFAULT_CONFIG["yubikey"]["enabled"] is False

        service = CmdBarDBusService()
        status_json = service.get_yubikey_status()
        status = json.loads(status_json)
        assert "enabled" in status
        assert "mode" in status

        ok = service.register_yubikey_device(
            json.dumps({"name": "DBus Key", "device_id": "vvccccccvccc"})
        )
        assert ok is True
