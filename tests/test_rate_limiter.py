import unittest
import time
from app.rate_limiter import TokenBucket, APIRateLimiter, default_rate_limiter
from companion.dbus_service import CmdBarDBusService

class TestTokenBucket(unittest.TestCase):
    def test_initialization(self):
        bucket = TokenBucket(capacity=50, refill_rate=2.0)
        self.assertEqual(bucket.capacity, 50.0)
        self.assertEqual(bucket.refill_rate, 2.0)
        self.assertEqual(bucket.tokens, 50.0)

    def test_try_consume_allowed_and_depleted(self):
        bucket = TokenBucket(capacity=5, refill_rate=1.0)
        now = 1000000.0
        bucket.last_refill = now

        res1 = bucket.try_consume(cost=3, now=now)
        self.assertTrue(res1["allowed"])
        self.assertEqual(res1["remaining"], 2.0)

        res2 = bucket.try_consume(cost=2, now=now)
        self.assertTrue(res2["allowed"])
        self.assertEqual(res2["remaining"], 0.0)

        res3 = bucket.try_consume(cost=1, now=now)
        self.assertFalse(res3["allowed"])
        self.assertEqual(res3["remaining"], 0.0)
        self.assertEqual(res3["retry_after_sec"], 1)

    def test_refill_over_time(self):
        bucket = TokenBucket(capacity=10, refill_rate=2.0, initial_tokens=0)
        now = 1000000.0
        bucket.last_refill = now

        self.assertEqual(bucket.get_tokens(now=now), 0.0)

        now += 2.5 # 2.5s * 2.0 = 5.0 tokens
        self.assertEqual(bucket.get_tokens(now=now), 5.0)

        res = bucket.try_consume(cost=3, now=now)
        self.assertTrue(res["allowed"])
        self.assertEqual(res["remaining"], 2.0)

        now += 10.0 # Capped at capacity 10
        self.assertEqual(bucket.get_tokens(now=now), 10.0)

    def test_reset(self):
        bucket = TokenBucket(capacity=10, refill_rate=1.0, initial_tokens=0)
        now = 1000000.0
        bucket.reset(now=now)
        self.assertEqual(bucket.get_tokens(now=now), 10.0)


class TestAPIRateLimiter(unittest.TestCase):
    def setUp(self):
        self.limiter = APIRateLimiter(default_capacity=20, default_refill_rate=1.0)

    def test_client_isolation_and_tiers(self):
        now = 1000000.0
        self.limiter.set_client_tier("client_A", "free") # capacity 10, refill 0.1667
        self.limiter.set_client_tier("client_B", "enterprise") # capacity 300, refill 5.0

        resA = self.limiter.consume("client_A", cost=10, now=now)
        self.assertTrue(resA["allowed"])
        self.assertEqual(resA["remaining"], 0.0)

        resA_blocked = self.limiter.consume("client_A", cost=1, now=now)
        self.assertFalse(resA_blocked["allowed"])

        # Client B unaffected
        resB = self.limiter.consume("client_B", cost=100, now=now)
        self.assertTrue(resB["allowed"])
        self.assertEqual(resB["remaining"], 200.0)

    def test_custom_limits_and_routes(self):
        now = 1000000.0
        self.limiter.set_client_limit("tenant1", capacity=5, refill_rate=1.0)

        for _ in range(5):
            self.assertTrue(self.limiter.consume("tenant1", route="ai", now=now)["allowed"])
        self.assertFalse(self.limiter.consume("tenant1", route="ai", now=now)["allowed"])

        # Route isolation
        self.assertTrue(self.limiter.consume("tenant1", route="dbus", now=now)["allowed"])

    def test_peek_and_usage_percentage(self):
        now = 1000000.0
        self.limiter.set_client_limit("client_peek", capacity=10, refill_rate=1.0)

        peek = self.limiter.check_limit("client_peek", now=now)
        self.assertTrue(peek["allowed"])
        self.assertEqual(peek["remaining"], 10.0)

        self.limiter.consume("client_peek", cost=5, now=now)
        self.assertEqual(self.limiter.get_usage_percentage("client_peek", now=now), 50.0)

    def test_analytics(self):
        now = 1000000.0
        self.limiter.set_client_limit("user1", capacity=2, refill_rate=1.0)

        self.limiter.consume("user1", cost=1, now=now)
        self.limiter.consume("user1", cost=1, now=now)
        self.limiter.consume("user1", cost=1, now=now) # throttled

        stats = self.limiter.get_analytics()
        self.assertEqual(stats["total_requests"], 3)
        self.assertEqual(stats["allowed_requests"], 2)
        self.assertEqual(stats["throttled_requests"], 1)
        self.assertEqual(stats["throttle_rate_percentage"], 33.33)

        client_stats = self.limiter.get_analytics("user1")
        self.assertEqual(client_stats["client_id"], "user1")
        self.assertEqual(client_stats["total_requests"], 3)


class TestDBusServiceRateLimiting(unittest.TestCase):
    def test_dbus_service_rate_limit_methods(self):
        service = CmdBarDBusService()
        check_res = service.check_rate_limit("dbus_user", route="ExecuteCommand")
        self.assertTrue(check_res["allowed"])

        consume_res = service.consume_rate_limit("dbus_user", route="ExecuteCommand", cost=1)
        self.assertTrue(consume_res["allowed"])

        analytics = service.get_rate_limit_analytics("dbus_user")
        self.assertEqual(analytics["total_requests"], 1)


if __name__ == "__main__":
    unittest.main()
