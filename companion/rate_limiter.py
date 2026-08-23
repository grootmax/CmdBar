#!/usr/bin/env python3
"""
Enterprise API Rate Limiting Module for CmdBar Python Companion.
Implements Token Bucket algorithm, burst handling, fair usage isolation,
custom limits, tier management, analytics, and middleware integration wrappers.
"""

import time
import math
import functools
from typing import Dict, Any, Optional, Callable, Tuple


class TokenBucket:
    """
    TokenBucket class representing a single rate limiting bucket.
    """
    def __init__(
        self,
        capacity: int = 60,
        refill_rate: float = 1.0,
        refill_interval_ms: float = 1000.0,
        initial_tokens: Optional[float] = None,
        time_provider: Optional[Callable[[], float]] = None
    ):
        self.capacity = max(1, capacity)
        self.refill_rate = max(0.0, float(refill_rate))
        self.refill_interval_ms = max(1.0, float(refill_interval_ms))
        self.time_provider = time_provider if time_provider is not None else time.time

        if initial_tokens is not None:
            self.tokens = min(float(self.capacity), max(0.0, float(initial_tokens)))
        else:
            self.tokens = float(self.capacity)

        self.last_refill_time = self.time_provider()

    def refill(self) -> None:
        """
        Refills tokens based on elapsed time since last refill.
        """
        now = self.time_provider()
        elapsed_sec = max(0.0, now - self.last_refill_time)
        elapsed_ms = elapsed_sec * 1000.0

        if elapsed_ms > 0:
            tokens_to_add = (elapsed_ms / self.refill_interval_ms) * self.refill_rate
            self.tokens = min(float(self.capacity), self.tokens + tokens_to_add)
            self.last_refill_time = now

    def try_consume(self, tokens_to_consume: int = 1) -> Dict[str, Any]:
        """
        Attempts to consume tokens from the bucket.
        """
        self.refill()
        amount = max(1, int(tokens_to_consume))

        if self.tokens >= amount:
            self.tokens -= amount
            missing_for_full = self.capacity - self.tokens
            reset_ms = (
                math.ceil((missing_for_full / self.refill_rate) * self.refill_interval_ms)
                if self.refill_rate > 0 else 0
            )
            return {
                "allowed": True,
                "remaining": math.floor(self.tokens),
                "limit": self.capacity,
                "reset_ms": reset_ms,
                "retry_after_ms": 0,
                "tokens_consumed": amount,
            }
        else:
            missing_tokens = amount - self.tokens
            retry_after_ms = (
                math.ceil((missing_tokens / self.refill_rate) * self.refill_interval_ms)
                if self.refill_rate > 0 else 0
            )
            missing_for_full = self.capacity - self.tokens
            reset_ms = (
                math.ceil((missing_for_full / self.refill_rate) * self.refill_interval_ms)
                if self.refill_rate > 0 else 0
            )
            return {
                "allowed": False,
                "remaining": math.floor(self.tokens),
                "limit": self.capacity,
                "reset_ms": reset_ms,
                "retry_after_ms": retry_after_ms,
                "tokens_consumed": 0,
            }

    def get_tokens(self) -> int:
        """
        Returns current available token count after refill.
        """
        self.refill()
        return math.floor(self.tokens)

    def reset(self) -> None:
        """
        Resets the bucket to maximum capacity.
        """
        self.tokens = float(self.capacity)
        self.last_refill_time = self.time_provider()


class ApiRateLimiter:
    """
    Enterprise API Rate Limiter Manager for Python.
    Manages token buckets per client, tier, and endpoint with custom rules and analytics.
    """
    def __init__(
        self,
        default_limit: Optional[Dict[str, Any]] = None,
        tiers: Optional[Dict[str, Dict[str, Any]]] = None,
        custom_limits: Optional[Dict[str, Dict[str, Any]]] = None,
        time_provider: Optional[Callable[[], float]] = None,
        enable_analytics: bool = True
    ):
        self.time_provider = time_provider if time_provider is not None else time.time
        self.enable_analytics = enable_analytics

        self.default_limit = {
            "capacity": 60,
            "refill_rate": 1.0,
            "refill_interval_ms": 1000.0,
        }
        if default_limit:
            self.default_limit.update(default_limit)

        self.tiers = {
            "enterprise": {"capacity": 1000, "refill_rate": 50.0, "refill_interval_ms": 1000.0},
            "pro": {"capacity": 300, "refill_rate": 10.0, "refill_interval_ms": 1000.0},
            "free": {"capacity": 60, "refill_rate": 1.0, "refill_interval_ms": 1000.0},
        }
        if tiers:
            self.tiers.update(tiers)

        self.custom_limits: Dict[str, Dict[str, Any]] = {}
        if custom_limits:
            self.custom_limits.update(custom_limits)

        self.buckets: Dict[str, TokenBucket] = {}

        self.analytics = {
            "total_requests": 0,
            "allowed_requests": 0,
            "throttled_requests": 0,
            "tokens_consumed": 0,
            "client_stats": {},
            "endpoint_stats": {},
            "start_time": self.time_provider(),
        }

    def set_custom_limit(self, key: str, limit_config: Dict[str, Any]) -> None:
        """
        Registers or updates a custom rate limit rule.
        """
        if key and isinstance(key, str):
            self.custom_limits[key] = limit_config

    def remove_custom_limit(self, key: str) -> bool:
        """
        Removes a custom rate limit rule.
        """
        if key in self.custom_limits:
            del self.custom_limits[key]
            return True
        return False

    def get_limit_config(self, key: Optional[str] = None, tier: Optional[str] = None) -> Dict[str, Any]:
        """
        Resolves the limit configuration for a key or tier.
        """
        if key and key in self.custom_limits:
            return self.custom_limits[key]
        if tier and tier in self.tiers:
            return self.tiers[tier]
        return self.default_limit

    def get_bucket(self, bucket_key: str, limit_config: Dict[str, Any]) -> TokenBucket:
        """
        Retrieves or creates a TokenBucket for a bucket key.
        """
        bucket = self.buckets.get(bucket_key)
        cap = limit_config.get("capacity", 60)
        rate = limit_config.get("refill_rate", 1.0)
        interval = limit_config.get("refill_interval_ms", 1000.0)

        if not bucket:
            bucket = TokenBucket(
                capacity=cap,
                refill_rate=rate,
                refill_interval_ms=interval,
                time_provider=self.time_provider,
            )
            self.buckets[bucket_key] = bucket
        elif (
            bucket.capacity != cap
            or bucket.refill_rate != rate
            or bucket.refill_interval_ms != interval
        ):
            bucket.capacity = cap
            bucket.refill_rate = rate
            bucket.refill_interval_ms = interval

        return bucket

    def check_rate_limit(
        self,
        client_id: str = "global",
        endpoint: str = "default",
        tokens_to_consume: int = 1,
        tier: Optional[str] = None,
        cost: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Checks rate limit for a client and endpoint request.
        """
        actual_tokens = cost if cost is not None else tokens_to_consume
        bucket_key = f"{client_id}:{endpoint}" if endpoint != "default" else client_id
        limit_config = self.get_limit_config(endpoint, tier) or self.get_limit_config(client_id, tier)

        bucket = self.get_bucket(bucket_key, limit_config)
        result = bucket.try_consume(actual_tokens)

        headers = {
            "X-RateLimit-Limit": str(result["limit"]),
            "X-RateLimit-Remaining": str(result["remaining"]),
            "X-RateLimit-Reset": str(math.ceil(result["reset_ms"] / 1000.0)),
        }
        if not result["allowed"]:
            headers["Retry-After"] = str(math.ceil(result["retry_after_ms"] / 1000.0))

        if self.enable_analytics:
            self._record_analytics(client_id, endpoint, result, actual_tokens)

        return {
            "allowed": result["allowed"],
            "limit": result["limit"],
            "remaining": result["remaining"],
            "reset_ms": result["reset_ms"],
            "retry_after_ms": result["retry_after_ms"],
            "tokens_consumed": result["tokens_consumed"],
            "headers": headers,
            "client": client_id,
            "endpoint": endpoint,
            "bucket_key": bucket_key,
        }

    def _record_analytics(
        self,
        client_id: str,
        endpoint: str,
        result: Dict[str, Any],
        tokens_requested: int
    ) -> None:
        """
        Records analytics statistics for requests.
        """
        self.analytics["total_requests"] += 1
        if result["allowed"]:
            self.analytics["allowed_requests"] += 1
            self.analytics["tokens_consumed"] += result["tokens_consumed"]
        else:
            self.analytics["throttled_requests"] += 1

        c_stats = self.analytics["client_stats"].setdefault(
            client_id, {"total": 0, "allowed": 0, "throttled": 0, "tokens_consumed": 0, "last_request": 0}
        )
        c_stats["total"] += 1
        c_stats["last_request"] = self.time_provider()
        if result["allowed"]:
            c_stats["allowed"] += 1
            c_stats["tokens_consumed"] += result["tokens_consumed"]
        else:
            c_stats["throttled"] += 1

        e_stats = self.analytics["endpoint_stats"].setdefault(
            endpoint, {"total": 0, "allowed": 0, "throttled": 0, "tokens_consumed": 0, "last_request": 0}
        )
        e_stats["total"] += 1
        e_stats["last_request"] = self.time_provider()
        if result["allowed"]:
            e_stats["allowed"] += 1
            e_stats["tokens_consumed"] += result["tokens_consumed"]
        else:
            e_stats["throttled"] += 1

    def get_quota_status(
        self, client_id: str = "global", endpoint: Optional[str] = None, tier: str = "free"
    ) -> Dict[str, Any]:
        """
        Inspects current quota status without consuming tokens.
        """
        ep_key = endpoint or "default"
        bucket_key = f"{client_id}:{ep_key}" if ep_key != "default" else client_id
        limit_config = self.get_limit_config(ep_key, tier) or self.get_limit_config(client_id, tier)

        bucket = self.get_bucket(bucket_key, limit_config)
        tokens = bucket.get_tokens()
        missing_for_full = bucket.capacity - tokens
        reset_ms = (
            math.ceil((missing_for_full / bucket.refill_rate) * bucket.refill_interval_ms)
            if bucket.refill_rate > 0 else 0
        )

        return {
            "client": client_id,
            "endpoint": ep_key,
            "tokens": tokens,
            "capacity": bucket.capacity,
            "refill_rate": bucket.refill_rate,
            "reset_ms": reset_ms,
            "is_throttled": tokens < 1,
        }

    def get_analytics(self) -> Dict[str, Any]:
        """
        Returns summary of rate limit analytics.
        """
        now = self.time_provider()
        uptime = now - self.analytics["start_time"]
        return {
            "total_requests": self.analytics["total_requests"],
            "allowed_requests": self.analytics["allowed_requests"],
            "throttled_requests": self.analytics["throttled_requests"],
            "tokens_consumed": self.analytics["tokens_consumed"],
            "active_buckets": len(self.buckets),
            "uptime_sec": uptime,
            "client_stats": {k: dict(v) for k, v in self.analytics["client_stats"].items()},
            "endpoint_stats": {k: dict(v) for k, v in self.analytics["endpoint_stats"].items()},
        }

    def get_client_stats(self, client_id: str) -> Optional[Dict[str, Any]]:
        """
        Returns stats for a specific client.
        """
        if client_id in self.analytics["client_stats"]:
            return dict(self.analytics["client_stats"][client_id])
        return None

    def reset_analytics(self) -> None:
        """
        Resets recorded analytics statistics.
        """
        self.analytics["total_requests"] = 0
        self.analytics["allowed_requests"] = 0
        self.analytics["throttled_requests"] = 0
        self.analytics["tokens_consumed"] = 0
        self.analytics["client_stats"].clear()
        self.analytics["endpoint_stats"].clear()
        self.analytics["start_time"] = self.time_provider()

    def reset_buckets(self) -> None:
        """
        Resets all managed token buckets.
        """
        for bucket in self.buckets.values():
            bucket.reset()

    def wrap_dbus_method(
        self,
        method_name: str,
        handler: Callable,
        client_id: str = "dbus-client",
        tier: Optional[str] = None,
        tokens_to_consume: int = 1,
        reject_with_error: bool = False,
    ) -> Callable:
        """
        Decorator/wrapper to apply rate limiting to D-Bus methods.
        """
        @functools.wraps(handler)
        def wrapper(*args, **kwargs):
            res = self.check_rate_limit(
                client_id=client_id,
                endpoint=method_name,
                tokens_to_consume=tokens_to_consume,
                tier=tier,
            )
            if not res["allowed"]:
                if reject_with_error:
                    raise RuntimeError(
                        f"Rate limit exceeded for {method_name}. Retry after {res['retry_after_ms']}ms."
                    )
                return False
            return handler(*args, **kwargs)

        return wrapper

    def wrap_ai_service(
        self,
        translate_fn: Callable,
        client_id: str = "ai-user",
        tier: str = "pro",
        tokens_to_consume: int = 5,
    ) -> Callable:
        """
        Decorator/wrapper for AI service calls with rate limiting.
        """
        @functools.wraps(translate_fn)
        def wrapper(*args, **kwargs):
            res = self.check_rate_limit(
                client_id=client_id,
                endpoint="ai-translate",
                tokens_to_consume=tokens_to_consume,
                tier=tier,
            )
            if not res["allowed"]:
                retry_sec = math.ceil(res["retry_after_ms"] / 1000.0)
                raise RuntimeError(f"AI rate limit exceeded. Retry after {retry_sec} seconds.")
            return translate_fn(*args, **kwargs)

        return wrapper
