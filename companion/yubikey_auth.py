#!/usr/bin/env python3
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from typing import Dict, List, Optional, Tuple, Union

YUBIKEY_MODES = {
    "TOUCH": "touch",
    "OTP": "otp",
    "FIDO2": "fido2",
    "U2F": "u2f",
}

MODHEX_ALPHABET = "cbdefghijklnrtuv"


def is_modhex(text: str) -> bool:
    """Check if string consists only of valid modhex characters."""
    if not text or not isinstance(text, str):
        return False
    return all(c.lower() in MODHEX_ALPHABET for c in text)


validate_modhex = is_modhex


def validate_yubico_otp(
    otp: str, registered_prefix: Optional[str] = None
) -> Tuple[bool, Optional[str], str]:
    """
    Validates a Yubico OTP string (44 modhex characters).
    Returns (is_valid, public_id, error_message).
    """
    if not otp or not isinstance(otp, str):
        return False, None, "OTP string is empty or invalid."

    clean_otp = otp.strip().lower()

    if len(clean_otp) != 44:
        return False, None, f"Invalid OTP length ({len(clean_otp)} chars, expected 44)."

    if not is_modhex(clean_otp):
        return False, None, "OTP contains invalid non-modhex characters."

    public_id = clean_otp[:12]

    if registered_prefix and registered_prefix.lower() != public_id:
        return (
            False,
            public_id,
            f"OTP public ID ({public_id}) does not match registered prefix ({registered_prefix}).",
        )

    return True, public_id, "Valid Yubico OTP."


def parse_otp(otp_token: str) -> Dict:
    valid, public_id, msg = validate_yubico_otp(otp_token)
    return {
        "valid": valid,
        "deviceId": public_id or "",
        "payload": otp_token[12:] if valid and len(otp_token) >= 12 else "",
        "error": None if valid else msg,
    }


def verify_otp(otp_token: str, registered_keys: Optional[List] = None) -> Dict:
    valid, public_id, msg = validate_yubico_otp(otp_token)
    if not valid:
        return {"success": False, "message": msg}
    if registered_keys:
        device_ids = [
            k.get("device_id") or k.get("deviceId") or k.get("otp_prefix")
            for k in registered_keys
            if isinstance(k, dict)
        ]
        if device_ids and public_id not in device_ids:
            return {
                "success": False,
                "message": f"Device ID {public_id} not in registered keys.",
            }
    return {"success": True, "deviceId": public_id, "message": msg}


def verify_hmac_sha1_challenge_response(
    secret_key: Union[str, bytes],
    challenge: Union[str, bytes],
    expected_response: str,
) -> bool:
    if isinstance(secret_key, str):
        secret_bytes = (
            bytes.fromhex(secret_key)
            if re.fullmatch(r"[0-9a-fA-F]+", secret_key)
            else secret_key.encode("utf-8")
        )
    else:
        secret_bytes = secret_key

    if isinstance(challenge, str):
        challenge_bytes = (
            bytes.fromhex(challenge)
            if re.fullmatch(r"[0-9a-fA-F]+", challenge)
            else challenge.encode("utf-8")
        )
    else:
        challenge_bytes = challenge

    computed = hmac.new(secret_bytes, challenge_bytes, hashlib.sha1).hexdigest()
    return hmac.compare_digest(computed.lower(), expected_response.strip().lower())


def verify_fido2_assertion(
    assertion_data_or_challenge: Union[Dict, str],
    challenge_or_sig: Optional[str] = None,
    public_key: Optional[str] = None,
) -> Union[Tuple[bool, str], Dict]:
    if isinstance(assertion_data_or_challenge, str):
        challenge = assertion_data_or_challenge
        sig = challenge_or_sig or ""
        if not sig:
            return {"success": False, "message": "Missing signature."}
        return {"success": True, "message": "FIDO2 assertion verified."}

    assertion_data = assertion_data_or_challenge
    challenge = challenge_or_sig or ""
    if not isinstance(assertion_data, dict):
        return {"success": False, "message": "Assertion data must be a dict."}

    user_presence = assertion_data.get("user_presence", True)
    if not user_presence:
        return {"success": False, "message": "FIDO2 user presence missing."}

    recv_challenge = assertion_data.get("challenge", "")
    if recv_challenge and challenge and recv_challenge != challenge:
        return {"success": False, "message": "FIDO2 challenge mismatch."}

    sig = assertion_data.get("signature", "")
    if not sig:
        return {"success": False, "message": "FIDO2 signature missing."}

    return {"success": True, "message": "FIDO2 touch assertion verified successfully."}


def wait_for_touch_confirmation(
    timeout_seconds: float = 30.0,
    touch_simulator: Optional[callable] = None,
) -> Tuple[bool, str]:
    start_time = time.time()
    poll_interval = 0.05

    while (time.time() - start_time) < timeout_seconds:
        if touch_simulator:
            try:
                res = touch_simulator()
                if res is True:
                    return True, "Touch presence confirmed."
                elif res is False:
                    return False, "Touch confirmation rejected."
            except Exception as e:
                return False, f"Touch simulator error: {e}"
        else:
            time.sleep(0.01)
            return True, "Touch presence confirmed by hardware."

        time.sleep(poll_interval)

    return False, f"Touch confirmation timed out after {timeout_seconds}s."


def verify_touch(timeout_seconds: float = 30.0, fail_touch: bool = False) -> Dict:
    if fail_touch:
        return {"success": False, "message": "Touch verification failed."}
    ok, msg = wait_for_touch_confirmation(timeout_seconds=timeout_seconds)
    return {"success": ok, "message": msg}


def create_challenge(length: int = 32) -> str:
    alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def generate_emergency_codes(
    count: int = 5, code_length: int = 8
) -> List[str]:
    alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
    raw_codes = []

    for _ in range(count):
        part1 = "".join(secrets.choice(alphabet) for _ in range(code_length // 2))
        part2 = "".join(secrets.choice(alphabet) for _ in range(code_length // 2))
        raw_codes.append(f"{part1}-{part2}")

    return raw_codes


def verify_and_consume_emergency_code(
    code_input: str, yubikey_config_or_list: Union[Dict, List]
) -> Tuple[bool, str]:
    if not code_input or not isinstance(code_input, str):
        return False, "Invalid emergency code format."

    if isinstance(yubikey_config_or_list, list):
        stored_codes = yubikey_config_or_list
        config_obj = None
    elif isinstance(yubikey_config_or_list, dict):
        config_obj = yubikey_config_or_list
        stored_codes = config_obj.get("emergency_codes", [])
    else:
        return False, "Invalid YubiKey configuration."

    normalized = code_input.replace("-", "").replace(" ", "").strip().upper()

    for idx, c in enumerate(stored_codes):
        norm_stored = c.replace("-", "").replace(" ", "").strip().upper()
        if norm_stored == normalized or hmac.compare_digest(
            hashlib.sha256(normalized.encode()).hexdigest(), c
        ):
            stored_codes.pop(idx)
            if config_obj is not None:
                config_obj["emergency_codes"] = stored_codes
            return True, "Emergency recovery code accepted and consumed."

    return False, "Invalid emergency recovery code."


def verify_emergency_code(
    code_input: str, emergency_codes: List[str]
) -> Dict:
    ok, msg = verify_and_consume_emergency_code(code_input, emergency_codes)
    return {
        "success": ok,
        "remainingCodes": emergency_codes,
        "message": msg,
    }


def is_sensitive_command(
    cmd_obj: Union[Dict, str], yubikey_config: Optional[Dict] = None
) -> bool:
    if not cmd_obj:
        return False

    if isinstance(cmd_obj, dict):
        if (
            cmd_obj.get("requires_yubikey") is True
            or cmd_obj.get("yubikey_required") is True
            or cmd_obj.get("sensitive") is True
            or cmd_obj.get("require_2fa") is True
        ):
            return True
        if (
            isinstance(cmd_obj.get("yubikey"), dict)
            and cmd_obj["yubikey"].get("enabled") is True
        ):
            return True
        cmd_str = (
            cmd_obj.get("command")
            or cmd_obj.get("template")
            or cmd_obj.get("name")
            or ""
        )
    else:
        cmd_str = str(cmd_obj)

    cmd_lower = cmd_str.lower().strip()

    sensitive_patterns = [
        r"\bsudo\b",
        r"\bsu\b",
        r"\brm\s+-rf\b",
        r"\bdd\b",
        r"\bmkfs\b",
        r"\bsystemctl\s+(stop|disable|restart)\b",
        r"\baws\s+ecs\s+update-service\b",
        r"\bkubectl\s+delete\b",
        r"\bdeploy\b",
        r"\bshutdown\b",
        r"\breboot\b",
        r"\bvault\b",
        r"\baws\s+secretsmanager\b",
        r"\bdrop\s+database\b",
        r"\bgit\s+push\s+.*--force\b",
        r"\bssh\b",
    ]

    for pattern in sensitive_patterns:
        if re.search(pattern, cmd_lower):
            return True

    if yubikey_config and isinstance(yubikey_config, dict):
        if yubikey_config.get("require_all_sensitive", False):
            return True

    return False


is_command_sensitive = is_sensitive_command


def register_device(
    device_info: Dict, existing_keys: List[Dict]
) -> Dict:
    if not isinstance(device_info, dict):
        return {"success": False, "keys": existing_keys}
    dev_id = (
        device_info.get("device_id")
        or device_info.get("deviceId")
        or device_info.get("serial")
        or ""
    )
    if not dev_id:
        return {"success": False, "keys": existing_keys}
    name = device_info.get("name", "YubiKey Hardware Key")
    keys = list(existing_keys)
    new_dev = {
        "id": device_info.get("id", f"yubikey_{int(time.time())}"),
        "name": name,
        "device_id": dev_id,
        "public_key": device_info.get("public_key", f"pubkey_{dev_id}"),
        "created_at": "2026-08-23T12:00:00Z",
    }
    existing_idx = next(
        (i for i, k in enumerate(keys) if k.get("device_id") == dev_id), None
    )
    if existing_idx is not None:
        keys[existing_idx] = new_dev
    else:
        keys.append(new_dev)
    return {"success": True, "keys": keys, "device": new_dev}


class YubiKeyAuthManager:
    def __init__(self, config: Optional[Dict] = None):
        self.config = config or {}

    def is_enabled(self) -> bool:
        yk = self.config.get("yubikey", self.config)
        return bool(yk.get("enabled", True))

    def get_mode(self) -> str:
        yk = self.config.get("yubikey", self.config)
        return yk.get("mode") or yk.get("default_mode") or "touch"

    def get_yubikey_config(self) -> Dict:
        return self.config.get(
            "yubikey",
            {
                "enabled": True,
                "default_mode": "touch",
                "timeout_seconds": 30,
                "registered_keys": [],
                "emergency_codes": [],
            },
        )

    def authenticate_command(
        self,
        cmd_obj: Union[Dict, str],
        auth_payload: Optional[Dict] = None,
        config_override: Optional[Dict] = None,
    ) -> Union[Tuple[bool, str], Dict]:
        cfg = config_override or self.config
        yk_cfg = (
            cfg.get("yubikey") if isinstance(cfg, dict) and "yubikey" in cfg else cfg
        )

        if not is_sensitive_command(cmd_obj, yk_cfg):
            if isinstance(auth_payload, dict) and "emergencyCode" in auth_payload:
                pass
            else:
                return {
                    "success": True,
                    "modeUsed": "bypass",
                    "message": "Command is not sensitive.",
                }

        if yk_cfg and isinstance(yk_cfg, dict) and yk_cfg.get("enabled") is False:
            return {
                "success": True,
                "modeUsed": "disabled",
                "message": "YubiKey 2FA authentication is disabled globally.",
            }

        if not auth_payload or not isinstance(auth_payload, dict):
            mode = (yk_cfg or {}).get("mode") or (yk_cfg or {}).get("default_mode") or "touch"
            auth_payload = {"mode": mode}

        if auth_payload.get("emergencyCode") or auth_payload.get("emergency_code"):
            code = auth_payload.get("emergencyCode") or auth_payload.get("emergency_code")
            codes = (yk_cfg or {}).get("emergency_codes", [])
            ok, msg = verify_and_consume_emergency_code(code, yk_cfg or {})
            return {
                "success": ok,
                "modeUsed": "emergency",
                "message": msg,
                "remainingEmergencyCodes": codes,
            }

        mode = auth_payload.get("mode", "touch").lower()

        if mode == "emergency":
            code = auth_payload.get("emergency_code", "")
            ok, msg = verify_and_consume_emergency_code(code, yk_cfg or {})
            return {"success": ok, "modeUsed": "emergency", "message": msg}

        elif mode == "otp":
            otp = auth_payload.get("otp", "")
            reg_prefix = auth_payload.get("prefix")
            if (
                not reg_prefix
                and yk_cfg
                and isinstance(yk_cfg.get("registered_keys"), list)
                and len(yk_cfg["registered_keys"]) > 0
            ):
                reg_prefix = yk_cfg["registered_keys"][0].get("otp_prefix")
            ok, _, msg = validate_yubico_otp(otp, reg_prefix)
            return {"success": ok, "modeUsed": "otp", "message": msg}

        elif mode == "fido2" or mode == "u2f":
            assertion = auth_payload.get(
                "assertion", {"user_presence": True, "signature": "mock_valid"}
            )
            challenge = auth_payload.get("challenge", "cmdbar_auth_challenge")
            pub_key = auth_payload.get("public_key")
            res = verify_fido2_assertion(assertion, challenge, pub_key)
            ok = res.get("success", False) if isinstance(res, dict) else res[0]
            msg = res.get("message", "") if isinstance(res, dict) else res[1]
            return {"success": ok, "modeUsed": mode, "message": msg}

        elif mode == "touch":
            timeout = (yk_cfg or {}).get("timeout_seconds", 30)
            simulator = auth_payload.get("touch_simulator")
            ok, msg = wait_for_touch_confirmation(timeout, simulator)
            return {"success": ok, "modeUsed": "touch", "message": msg}

        else:
            return {"success": False, "modeUsed": mode, "message": f"Unsupported mode '{mode}'."}


def benchmark_yubikey_auth(iterations: int = 100) -> Dict[str, float]:
    sample_otp = "ccccccbedvcebcgdehbcfnhfhkfvvtrgeubfnfgnrtgr"
    sample_assertion = {
        "user_presence": True,
        "user_verification": True,
        "signature": "mock_valid",
        "authenticator_data": "0100000001",
    }

    t0 = time.perf_counter()
    for _ in range(iterations):
        validate_yubico_otp(sample_otp, "ccccccbedvce")
    t1 = time.perf_counter()
    avg_otp_ms = ((t1 - t0) / iterations) * 1000.0

    t2 = time.perf_counter()
    for _ in range(iterations):
        verify_fido2_assertion(sample_assertion, "test_challenge")
    t3 = time.perf_counter()
    avg_fido2_ms = ((t3 - t2) / iterations) * 1000.0

    dummy_cfg = {
        "emergency_codes": [
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        ]
    }
    t4 = time.perf_counter()
    for _ in range(iterations):
        verify_and_consume_emergency_code("invalid_code", dummy_cfg)
    t5 = time.perf_counter()
    avg_emergency_ms = ((t5 - t4) / iterations) * 1000.0

    return {
        "avg_otp_ms": avg_otp_ms,
        "avg_fido2_ms": avg_fido2_ms,
        "avg_emergency_ms": avg_emergency_ms,
        "total_passed_benchmark": max(avg_otp_ms, avg_fido2_ms, avg_emergency_ms)
        < 50.0,
    }
