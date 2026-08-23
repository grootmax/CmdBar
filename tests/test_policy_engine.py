"""
Pytest test suite for Policy Enforcement Engine.
"""

import time
import pytest
import datetime
from app.policy_engine import (
    DEFAULT_POLICY_CONFIG,
    PolicyEngine,
    generate_totp,
    verify_totp,
    is_sensitive_command,
    ip_in_range,
    check_geo,
    check_time,
    check_dlp,
    redact_dlp,
    evaluate_policy,
)

TEST_SECRET = "JBSWY3DPEHPK3PXP"  # Base32 for "Hello!"


class TestTOTP:
    def test_generate_totp_returns_6_digits(self):
        token = generate_totp(TEST_SECRET)
        assert isinstance(token, str)
        assert len(token) == 6
        assert token.isdigit()

    def test_verify_totp_valid_token(self):
        token = generate_totp(TEST_SECRET)
        assert verify_totp(token, TEST_SECRET) is True

    def test_verify_totp_with_window(self):
        now = int(time.time())
        past_token = generate_totp(TEST_SECRET, timestamp=now - 30)
        future_token = generate_totp(TEST_SECRET, timestamp=now + 30)

        assert verify_totp(past_token, TEST_SECRET, window=1, timestamp=now) is True
        assert verify_totp(future_token, TEST_SECRET, window=1, timestamp=now) is True

    def test_verify_totp_invalid_token(self):
        assert verify_totp("000000", TEST_SECRET) is False
        assert verify_totp("", TEST_SECRET) is False
        assert verify_totp(None, TEST_SECRET) is False


class TestSensitivity:
    def test_sensitive_flags(self):
        assert is_sensitive_command({"name": "cmd", "sensitive": True}) is True
        assert is_sensitive_command({"name": "cmd", "mfa_required": True}) is True
        assert (
            is_sensitive_command({"name": "cmd", "sensitivity_level": "high"}) is True
        )
        assert (
            is_sensitive_command({"name": "cmd", "sensitivity_level": "critical"})
            is True
        )

    def test_sensitive_keywords(self):
        assert is_sensitive_command("deploy service staging") is True
        assert is_sensitive_command("sudo systemctl restart nginx") is True
        assert is_sensitive_command("aws kms decrypt --ciphertext") is True
        assert (
            is_sensitive_command(
                {"name": "Delete Table", "command": "drop table users"}
            )
            is True
        )

    def test_non_sensitive_commands(self):
        assert is_sensitive_command("make build") is False
        assert is_sensitive_command("ping -c 3 google.com") is False
        assert is_sensitive_command("echo Hello World") is False


class TestGeoAndCIDR:
    def test_ip_in_range(self):
        assert ip_in_range("192.168.1.100", "192.168.1.0/24") is True
        assert ip_in_range("192.168.2.100", "192.168.1.0/24") is False
        assert ip_in_range("10.0.0.5", "10.0.0.0/8") is True
        assert ip_in_range("172.16.0.1", "10.0.0.0/8") is False
        assert ip_in_range("127.0.0.1", "127.0.0.1") is True

    def test_check_geo_countries(self):
        policy = {
            "enabled": True,
            "allowed_countries": ["US", "CA"],
            "blocked_countries": ["RU"],
        }
        assert check_geo({"country_code": "US"}, policy)["allowed"] is True
        assert check_geo({"country_code": "CA"}, policy)["allowed"] is True
        assert check_geo({"country_code": "FR"}, policy)["allowed"] is False
        assert check_geo({"country_code": "RU"}, policy)["allowed"] is False

    def test_check_geo_ip_ranges(self):
        policy = {
            "enabled": True,
            "allowed_ip_ranges": ["192.168.1.0/24"],
            "blocked_ip_ranges": ["192.168.1.50/32"],
        }
        assert check_geo({"ip": "192.168.1.10"}, policy)["allowed"] is True
        assert check_geo({"ip": "192.168.1.50"}, policy)["allowed"] is False
        assert check_geo({"ip": "10.0.0.1"}, policy)["allowed"] is False


class TestTimeRestrictions:
    def test_check_time_days(self):
        # 2026-08-24 is a Monday, 2026-08-23 is a Sunday
        mon_dt = datetime.datetime(2026, 8, 24, 12, 0, tzinfo=datetime.timezone.utc)
        sun_dt = datetime.datetime(2026, 8, 23, 12, 0, tzinfo=datetime.timezone.utc)

        policy = {
            "enabled": True,
            "allowed_days": ["Mon", "Tue", "Wed", "Thu", "Fri"],
            "start_time": "00:00",
            "end_time": "23:59",
        }

        assert check_time({"timestamp": mon_dt}, policy)["allowed"] is True
        assert check_time({"timestamp": sun_dt}, policy)["allowed"] is False

    def test_check_time_windows(self):
        mon_day_dt = datetime.datetime(
            2026, 8, 24, 10, 0, tzinfo=datetime.timezone.utc
        )  # 10:00 UTC
        mon_night_dt = datetime.datetime(
            2026, 8, 24, 3, 0, tzinfo=datetime.timezone.utc
        )  # 03:00 UTC

        policy = {
            "enabled": True,
            "allowed_days": ["Mon"],
            "start_time": "08:00",
            "end_time": "18:00",
        }

        assert check_time({"timestamp": mon_day_dt}, policy)["allowed"] is True
        assert check_time({"timestamp": mon_night_dt}, policy)["allowed"] is False


class TestDLP:
    def test_check_dlp_detects_patterns(self):
        sample = "Deploying with AWS Key AKIAIOSFODNN7EXAMPLE and SSN 123-45-6789"
        violations = check_dlp(sample, DEFAULT_POLICY_CONFIG["dlp"])
        assert len(violations) >= 2
        names = [v["name"] for v in violations]
        assert "AWS Access Key" in names
        assert "SSN" in names

    def test_redact_dlp_replaces_secrets(self):
        sample = "Deploying with AWS Key AKIAIOSFODNN7EXAMPLE and SSN 123-45-6789"
        redacted = redact_dlp(sample, DEFAULT_POLICY_CONFIG["dlp"])
        assert "AKIAIOSFODNN7EXAMPLE" not in redacted
        assert "123-45-6789" not in redacted
        assert "[REDACTED_CREDENTIALS]" in redacted
        assert "[REDACTED_PII]" in redacted


class TestEvaluatePolicy:
    def test_globally_disabled(self):
        res = evaluate_policy("deploy app", policy_config={"enabled": False})
        assert res["allowed"] is True
        assert res["action"] == "allow"

    def test_mfa_required_for_sensitive_op(self):
        res = evaluate_policy("deploy app to production")
        assert res["allowed"] is False
        assert res["action"] == "mfa_required"
        assert res["mfa_required"] is True

    def test_mfa_verified_with_totp(self):
        token = generate_totp(TEST_SECRET)
        res = evaluate_policy(
            "deploy app to production",
            context={"mfa_token": token},
            policy_config=DEFAULT_POLICY_CONFIG,
        )
        assert res["allowed"] is True
        assert res["action"] == "allow"
        assert res["mfa_verified"] is True

    def test_dlp_block_action(self):
        cmd = "echo AKIAIOSFODNN7EXAMPLE"
        res = evaluate_policy(cmd, policy_config=DEFAULT_POLICY_CONFIG)
        assert res["allowed"] is False
        assert res["action"] == "block"
        assert len(res["dlp_violations"]) > 0

    def test_dlp_redact_action(self):
        policy = dict(DEFAULT_POLICY_CONFIG)
        policy["dlp"] = dict(DEFAULT_POLICY_CONFIG["dlp"])
        policy["dlp"]["action"] = "redact"

        cmd = "echo AKIAIOSFODNN7EXAMPLE"
        res = evaluate_policy(cmd, policy_config=policy)
        assert res["allowed"] is True
        assert res["action"] == "redact"
        assert "AKIAIOSFODNN7EXAMPLE" not in res["sanitized_command"]
        assert "[REDACTED_CREDENTIALS]" in res["sanitized_command"]

    def test_policy_engine_class(self):
        engine = PolicyEngine(DEFAULT_POLICY_CONFIG)
        token = generate_totp(TEST_SECRET)
        res = engine.evaluate_policy("make build")
        assert res["allowed"] is True

        res_sens = engine.evaluate_policy(
            "sudo systemctl restart nginx", context={"mfa_token": token}
        )
        assert res_sens["allowed"] is True


class TestBenchmark:
    def test_performance_throughput(self):
        start = time.time()
        for _ in range(1000):
            evaluate_policy(
                "make build", params={"host": "localhost"}, context={"user": "dev"}
            )
        duration = time.time() - start
        assert duration < 0.5  # 1000 evaluations in < 500ms
