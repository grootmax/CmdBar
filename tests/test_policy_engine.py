import time
from datetime import datetime, timezone
from app.policy_engine import PolicyEngine, validate_luhn, is_ip_in_cidr


def test_luhn_and_cidr_helpers():
    assert validate_luhn("49927398716") is True
    assert validate_luhn("49927398717") is False

    assert is_ip_in_cidr("192.168.1.50", "192.168.1.0/24") is True
    assert is_ip_in_cidr("192.168.2.50", "192.168.1.0/24") is False
    assert is_ip_in_cidr("10.0.0.1", "10.0.0.0/8") is True


def test_mfa_enforcement():
    engine = PolicyEngine(
        {
            "mfa": {
                "enabled": True,
                "mfa_secret": "654321",
                "session_duration_sec": 1,
                "sensitive_commands": ["*deploy*", "*rm -rf*", "*sudo*"],
            }
        }
    )

    assert engine.is_sensitive_operation("make deploy-staging") is True
    assert engine.is_sensitive_operation("echo hello") is False

    # Evaluation without MFA token fails for sensitive operation
    res = engine.evaluate({"command": "make deploy-staging"})
    assert res["allowed"] is False
    assert res["mfa_required"] is True
    assert res["mfa_verified"] is False

    # Non-sensitive operation passes
    res_non_sens = engine.evaluate({"command": "echo hello"})
    assert res_non_sens["allowed"] is True

    # Providing valid token succeeds
    res_valid = engine.evaluate(
        {"command": "make deploy-staging", "mfaToken": "654321"}
    )
    assert res_valid["allowed"] is True
    assert res_valid["mfa_verified"] is True


def test_dlp_scanning_and_redaction():
    engine = PolicyEngine({"dlp": {"enabled": True, "action": "redact"}})

    eval_res = engine.evaluate(
        {
            "command": "echo My card is 4532015112830366 and SSN is 123-45-6789",
            "parameters": {
                "key": "AKIAIOSFODNN7EXAMPLE",
            },
        }
    )

    assert eval_res["allowed"] is True
    assert len(eval_res["dlp_matches"]) > 0
    assert "[REDACTED:CREDIT_CARD]" in eval_res["redacted_command"]
    assert "[REDACTED:SSN]" in eval_res["redacted_command"]
    assert "[REDACTED:AWS_KEY]" in eval_res["redacted_parameters"]["key"]

    # Redacting output
    output = "Generated key AKIAIOSFODNN7EXAMPLE"
    redacted = eval_res["redact_output"](output)
    assert "[REDACTED:AWS_KEY]" in redacted
    assert "AKIAIOSFODNN7EXAMPLE" not in redacted


def test_dlp_blocking():
    engine = PolicyEngine({"dlp": {"enabled": True, "action": "block"}})
    eval_res = engine.evaluate(
        {"command": "aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE"}
    )
    assert eval_res["allowed"] is False
    assert any("DLP Violation" in r for r in eval_res["reasons"])


def test_geo_restrictions():
    engine = PolicyEngine(
        {
            "geo": {
                "enabled": True,
                "allowed_countries": ["US", "CA"],
                "blocked_countries": ["RU", "CN"],
                "allowed_ip_ranges": ["10.0.0.0/8"],
            }
        }
    )

    assert engine.evaluate_geo({"countryCode": "US", "ip": "10.1.2.3"})["allowed"] is True
    assert engine.evaluate_geo({"countryCode": "RU", "ip": "10.1.2.3"})["allowed"] is False
    assert engine.evaluate_geo({"countryCode": "US", "ip": "8.8.8.8"})["allowed"] is False


def test_time_restrictions():
    engine = PolicyEngine(
        {
            "time": {
                "enabled": True,
                "allowed_days": ["Mon", "Tue", "Wed", "Thu", "Fri"],
                "allowed_hours": {"start": "09:00", "end": "17:00"},
            }
        }
    )

    # Wednesday 10:30 UTC
    wed_work_hour = datetime(2026, 8, 26, 10, 30, tzinfo=timezone.utc)
    assert engine.evaluate_time(wed_work_hour)["allowed"] is True

    # Wednesday 20:00 UTC (after hours)
    wed_after_hours = datetime(2026, 8, 26, 20, 0, tzinfo=timezone.utc)
    assert engine.evaluate_time(wed_after_hours)["allowed"] is False

    # Sunday 12:00 UTC (weekend)
    sunday = datetime(2026, 8, 23, 12, 0, tzinfo=timezone.utc)
    assert engine.evaluate_time(sunday)["allowed"] is False


def test_performance_benchmark():
    engine = PolicyEngine(
        {
            "mfa": {"enabled": True, "sensitive_commands": ["*deploy*"]},
            "dlp": {"enabled": True, "action": "redact"},
            "geo": {"enabled": True, "allowed_countries": ["US"]},
            "time": {"enabled": True, "allowed_days": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]},
        }
    )

    t0 = time.perf_counter()
    for _ in range(100):
        engine.evaluate(
            {
                "command": "deploy --key AKIAIOSFODNN7EXAMPLE",
                "mfaToken": "123456",
                "geo": {"countryCode": "US", "ip": "10.0.0.1"},
            }
        )
    dt_ms = (time.perf_counter() - t0) * 1000
    avg_ms = dt_ms / 100
    assert avg_ms < 5.0
