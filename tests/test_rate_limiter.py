#!/usr/bin/env python3
"""
Unit and Integration Tests for Python API Rate Limiter in CmdBar.
"""

import time
import pytest
from companion.rate_limiter import TokenBucket, ApiRateLimiter
from companion.dbus_service import CmdBarDBusService


class MockTime:
    def __init__(self, start_time=1000.0):
        self.current_time = start_time

    def time(self):
        return self.current_time

    def advance(self, seconds):
        self.current_time += seconds


def test_token_bucket_initialization():
    mt = MockTime()
    bucket = TokenBucket(capacity=10, refill_rate=1.0, refill_interval_ms=1000.0, time_provider=mt.time)
    assert bucket.capacity == 10
    assert bucket.get_tokens() == 10


def test_token_bucket_consumption_and_refill():
    mt = MockTime()
    bucket = TokenBucket(capacity=10, refill_rate=2.0, refill_interval_ms=1000.0, time_provider=mt.time)

    res1 = bucket.try_consume(4)
    assert res1["allowed"] is True
    assert res1["remaining"] == 6

    # Consume remaining 6
    res2 = bucket.try_consume(6)
    assert res2["allowed"] is True
    assert res2["remaining"] == 0

    # Next consume should fail
    res3 = bucket.try_consume(1)
    assert res3["allowed"] is False
    assert res3["retry_after_ms"] > 0

    # Advance time by 2 seconds -> +4 tokens refilled
    mt.advance(2.0)
    assert bucket.get_tokens() == 4

    res4 = bucket.try_consume(3)
    assert res4["allowed"] is True
    assert res4["remaining"] == 1


def test_token_bucket_reset():
    mt = MockTime()
    bucket = TokenBucket(capacity=10, time_provider=mt.time)
    bucket.try_consume(8)
    assert bucket.get_tokens() == 2

    bucket.reset()
    assert bucket.get_tokens() == 10


def test_api_rate_limiter_tiers_and_custom_limits():
    mt = MockTime()
    limiter = ApiRateLimiter(time_provider=mt.time)

    ent = limiter.check_rate_limit("c-ent", tier="enterprise")
    assert ent["limit"] == 1000

    pro = limiter.check_rate_limit("c-pro", tier="pro")
    assert pro["limit"] == 300

    free = limiter.check_rate_limit("c-free", tier="free")
    assert free["limit"] == 60

    # Custom limit
    limiter.set_custom_limit("custom-ep", {"capacity": 5, "refill_rate": 1.0, "refill_interval_ms": 1000.0})
    custom_res = limiter.check_rate_limit("user1", endpoint="custom-ep")
    assert custom_res["limit"] == 5

    # Remove custom limit
    assert limiter.remove_custom_limit("custom-ep") is True
    after_res = limiter.check_rate_limit("user1", endpoint="custom-ep")
    assert after_res["limit"] == 60


def test_api_rate_limiter_fair_usage_isolation():
    mt = MockTime()
    limiter = ApiRateLimiter(
        default_limit={"capacity": 2, "refill_rate": 1.0, "refill_interval_ms": 1000.0},
        time_provider=mt.time,
    )

    # Client A exhausts quota
    assert limiter.check_rate_limit("clientA")["allowed"] is True
    assert limiter.check_rate_limit("clientA")["allowed"] is True
    assert limiter.check_rate_limit("clientA")["allowed"] is False

    # Client B is isolated and has full quota
    assert limiter.check_rate_limit("clientB")["allowed"] is True
    assert limiter.check_rate_limit("clientB")["allowed"] is True


def test_api_rate_limiter_headers_and_quota_status():
    mt = MockTime()
    limiter = ApiRateLimiter(time_provider=mt.time)

    res = limiter.check_rate_limit("c1")
    assert "X-RateLimit-Limit" in res["headers"]
    assert "X-RateLimit-Remaining" in res["headers"]
    assert "X-RateLimit-Reset" in res["headers"]

    status = limiter.get_quota_status("c1", tier="pro")
    assert status["capacity"] == 300
    assert status["is_throttled"] is False


def test_api_rate_limiter_analytics():
    mt = MockTime()
    limiter = ApiRateLimiter(
        default_limit={"capacity": 2, "refill_rate": 1.0, "refill_interval_ms": 1000.0},
        time_provider=mt.time,
    )

    limiter.check_rate_limit("c1", endpoint="add")
    limiter.check_rate_limit("c1", endpoint="add")
    limiter.check_rate_limit("c1", endpoint="add")  # throttled

    analytics = limiter.get_analytics()
    assert analytics["total_requests"] == 3
    assert analytics["allowed_requests"] == 2
    assert analytics["throttled_requests"] == 1
    assert analytics["tokens_consumed"] == 2

    c_stats = limiter.get_client_stats("c1")
    assert c_stats["total"] == 3
    assert c_stats["allowed"] == 2

    limiter.reset_analytics()
    assert limiter.get_analytics()["total_requests"] == 0


def test_wrap_dbus_method():
    mt = MockTime()
    limiter = ApiRateLimiter(
        default_limit={"capacity": 2, "refill_rate": 1.0, "refill_interval_ms": 1000.0},
        time_provider=mt.time,
    )

    call_count = [0]

    def dummy_method(a, b):
        call_count[0] += 1
        return a + b

    wrapped = limiter.wrap_dbus_method("dummy_method", dummy_method, client_id="test")

    assert wrapped(1, 2) == 3
    assert wrapped(2, 3) == 5
    assert wrapped(3, 4) is False  # Throttled
    assert call_count[0] == 2


def test_wrap_ai_service():
    mt = MockTime()
    limiter = ApiRateLimiter(
        tiers={"pro": {"capacity": 10, "refill_rate": 1.0, "refill_interval_ms": 1000.0}},
        time_provider=mt.time,
    )

    def ai_translate(prompt):
        return f"echo {prompt}"

    wrapped = limiter.wrap_ai_service(ai_translate, client_id="user1", tier="pro", tokens_to_consume=5)

    assert wrapped("hello") == "echo hello"
    assert wrapped("world") == "echo world"

    # 10 tokens consumed, next should raise RuntimeError
    with pytest.raises(RuntimeError, match="AI rate limit exceeded"):
        wrapped("fail")


def test_dbus_service_rate_limiter_integration():
    mt = MockTime()
    limiter = ApiRateLimiter(
        default_limit={"capacity": 1, "refill_rate": 1.0, "refill_interval_ms": 1000.0},
        time_provider=mt.time,
    )

    service = CmdBarDBusService(rate_limiter=limiter)

    # First call allowed (returns list of commands)
    cmds = service.get_commands()
    assert isinstance(cmds, list)
    assert len(cmds) > 0

    # Second call throttled by rate limiter (returns empty list)
    assert service.get_commands() == []
    assert limiter.get_analytics()["throttled_requests"] == 1


def test_rate_limiter_performance_benchmark():
    limiter = ApiRateLimiter()
    start_time = time.perf_counter()

    for i in range(10000):
        limiter.check_rate_limit(f"client-{i % 100}", endpoint=f"endpoint-{i % 10}")

    duration = time.perf_counter() - start_time
    assert duration < 0.2  # Evaluates 10,000 rate limit requests in sub-200ms
