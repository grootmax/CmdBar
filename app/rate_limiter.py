#!/usr/bin/env python3
"""
Enterprise API Rate Limiter using Token Bucket Algorithm.
Implements token buckets, burst handling, fair usage policy across client tiers,
custom limit overrides, and usage analytics tracking for CmdBar Python companion services.
"""

import time
import math
import threading

class TokenBucket:
    """
    TokenBucket represents a single token bucket instance for rate limiting in Python.
    Handles token refills based on elapsed time and burst consumption.

    :visibility: public
    """
    def __init__(self, capacity: float = 60.0, refill_rate: float = 1.0, initial_tokens: float = None):
        """
        Constructs a new TokenBucket instance.

        :param capacity: Maximum capacity (burst size).
        :param refill_rate: Refill rate in tokens per second.
        :param initial_tokens: Initial tokens (defaults to capacity).

        :visibility: public
        """
        self.capacity = max(1.0, float(capacity) if capacity is not None else 60.0)
        self.refill_rate = max(0.0001, float(refill_rate) if refill_rate is not None else 1.0)
        if initial_tokens is not None:
            self.tokens = min(self.capacity, max(0.0, float(initial_tokens)))
        else:
            self.tokens = self.capacity
        self.last_refill = time.time()
        self._lock = threading.Lock()

    def _refill(self, now: float = None) -> float:
        if now is None:
            now = time.time()
        elapsed_sec = max(0.0, now - self.last_refill)
        if elapsed_sec > 0:
            self.tokens = min(self.capacity, self.tokens + elapsed_sec * self.refill_rate)
            self.last_refill = now
        return self.tokens

    def try_consume(self, cost: int = 1, now: float = None) -> dict:
        """
        Attempts to consume the specified number of tokens from the bucket.

        :param cost: Number of tokens to consume.
        :param now: Current timestamp in seconds.
        :return: Result dict containing allowed, remaining, capacity, reset_in_ms, and retry_after_sec.

        :visibility: public
        """
        if now is None:
            now = time.time()

        with self._lock:
            self._refill(now)
            req_cost = max(1, int(cost) if cost is not None else 1)

            if self.tokens >= req_cost:
                self.tokens -= req_cost
                reset_ms = self.get_time_to_refill(req_cost, now=now)
                return {
                    "allowed": True,
                    "remaining": self.tokens,
                    "capacity": self.capacity,
                    "reset_in_ms": reset_ms,
                    "retry_after_sec": 0
                }
            else:
                needed = req_cost - self.tokens
                reset_ms = math.ceil((needed / self.refill_rate) * 1000)
                retry_sec = math.ceil(needed / self.refill_rate)
                return {
                    "allowed": False,
                    "remaining": self.tokens,
                    "capacity": self.capacity,
                    "reset_in_ms": reset_ms,
                    "retry_after_sec": retry_sec
                }

    def get_tokens(self, now: float = None) -> float:
        """
        Retrieves current available tokens in the bucket after refilling.

        :param now: Timestamp in seconds.
        :return: Available tokens count.

        :visibility: public
        """
        if now is None:
            now = time.time()
        with self._lock:
            return self._refill(now)

    def get_time_to_refill(self, needed_tokens: int = 1, now: float = None) -> int:
        """
        Calculates time in milliseconds required to refill up to the needed token count.

        :param needed_tokens: Target number of tokens needed.
        :param now: Current timestamp in seconds.
        :return: Milliseconds to refill.

        :visibility: public
        """
        if now is None:
            now = time.time()
        self._refill(now)
        target = max(1, int(needed_tokens) if needed_tokens is not None else 1)
        if self.tokens >= target:
            return 0
        needed = target - self.tokens
        return math.ceil((needed / self.refill_rate) * 1000)

    def reset(self, now: float = None):
        """
        Resets the bucket to full capacity.

        :param now: Timestamp in seconds.

        :visibility: public
        """
        if now is None:
            now = time.time()
        with self._lock:
            self.tokens = self.capacity
            self.last_refill = now


class APIRateLimiter:
    """
    APIRateLimiter provides enterprise multi-tenant rate limiting with token buckets,
    fair usage isolation, custom client limits, subscription tier management, and analytics.

    :visibility: public
    """
    def __init__(self, default_capacity: float = 60.0, default_refill_rate: float = 1.0, default_tier: str = "pro", tiers: dict = None):
        """
        Constructs an APIRateLimiter instance.

        :param default_capacity: Default capacity for unclassified clients.
        :param default_refill_rate: Default refill rate (tokens/sec).
        :param default_tier: Default tier for unclassified clients.
        :param tiers: Optional dictionary of tier configurations.

        :visibility: public
        """
        self.default_capacity = max(1.0, float(default_capacity))
        self.default_refill_rate = max(0.0001, float(default_refill_rate))
        self.default_tier = str(default_tier or "pro")

        self.tiers = {
            "free": {"capacity": 10.0, "refill_rate": 0.1667},
            "pro": {"capacity": 60.0, "refill_rate": 1.0},
            "enterprise": {"capacity": 300.0, "refill_rate": 5.0}
        }
        if tiers:
            for t_name, t_cfg in tiers.items():
                self.set_tier(t_name, capacity=t_cfg.get("capacity"), refill_rate=t_cfg.get("refill_rate"))

        self.buckets = {}
        self.client_limits = {}
        self.client_tiers = {}
        self._lock = threading.RLock()

        # Analytics
        self.metrics = {
            "total_requests": 0,
            "allowed_requests": 0,
            "throttled_requests": 0,
            "client_metrics": {}
        }

    def set_tier(self, tier_name: str, capacity: float = None, refill_rate: float = None):
        """
        Defines or updates a tier definition.

        :param tier_name: Name of tier.
        :param capacity: Capacity for tier.
        :param refill_rate: Refill rate for tier.

        :visibility: public
        """
        if not tier_name:
            return
        cap = max(1.0, float(capacity)) if capacity is not None else 60.0
        refill = max(0.0001, float(refill_rate)) if refill_rate is not None else 1.0
        self.tiers[str(tier_name)] = {"capacity": cap, "refill_rate": refill}

    def get_tier(self, tier_name: str) -> dict:
        """
        Retrieves configuration for a given tier.

        :param tier_name: Name of tier.
        :return: Dict containing capacity and refill_rate.

        :visibility: public
        """
        if tier_name and str(tier_name) in self.tiers:
            return dict(self.tiers[str(tier_name)])
        return {"capacity": self.default_capacity, "refill_rate": self.default_refill_rate}

    def set_client_limit(self, client_id: str, capacity: float = None, refill_rate: float = None, tier: str = None):
        """
        Sets custom rate limits or assigned tier for a specific client.

        :param client_id: Client identifier.
        :param capacity: Optional capacity override.
        :param refill_rate: Optional refill rate override.
        :param tier: Optional tier assignment.

        :visibility: public
        """
        if not client_id:
            return
        clean_id = str(client_id).strip()
        with self._lock:
            existing = self.client_limits.get(clean_id, {})
            updated = dict(existing)

            if capacity is not None:
                updated["capacity"] = max(1.0, float(capacity))
            if refill_rate is not None:
                updated["refill_rate"] = max(0.0001, float(refill_rate))
            if tier is not None:
                updated["tier"] = str(tier)
                self.client_tiers[clean_id] = str(tier)

            self.client_limits[clean_id] = updated

            # Dynamic update of existing buckets
            key_prefix = f"{clean_id}:"
            for k, b in self.buckets.items():
                if k.startswith(key_prefix) or k == clean_id:
                    if "capacity" in updated:
                        b.capacity = updated["capacity"]
                    if "refill_rate" in updated:
                        b.refill_rate = updated["refill_rate"]

    def set_client_tier(self, client_id: str, tier_name: str):
        """
        Assigns a client to a specific tier.

        :param client_id: Client identifier.
        :param tier_name: Tier name.

        :visibility: public
        """
        if not client_id:
            return
        clean_id = str(client_id).strip()
        clean_tier = str(tier_name).strip()
        self.client_tiers[clean_id] = clean_tier
        tier_cfg = self.get_tier(clean_tier)
        self.set_client_limit(clean_id, capacity=tier_cfg["capacity"], refill_rate=tier_cfg["refill_rate"], tier=clean_tier)

    def resolve_client_params(self, client_id: str) -> dict:
        """
        Resolves rate limit parameters for a client.

        :param client_id: Client identifier.
        :return: Dict with capacity, refill_rate, and tier.

        :visibility: public
        """
        clean_id = str(client_id).strip() if client_id else "default"
        custom = self.client_limits.get(clean_id, {})
        assigned_tier = custom.get("tier") or self.client_tiers.get(clean_id) or self.default_tier
        tier_cfg = self.get_tier(assigned_tier)

        return {
            "capacity": custom.get("capacity") if custom.get("capacity") is not None else tier_cfg["capacity"],
            "refill_rate": custom.get("refill_rate") if custom.get("refill_rate") is not None else tier_cfg["refill_rate"],
            "tier": assigned_tier
        }

    def get_bucket(self, client_id: str, route: str = "default", now: float = None) -> TokenBucket:
        """
        Gets or creates a TokenBucket instance for a client and route.

        :param client_id: Client identifier.
        :param route: Route or command category name.
        :param now: Timestamp in seconds.
        :return: TokenBucket instance.

        :visibility: public
        """
        if now is None:
            now = time.time()
        clean_id = str(client_id).strip() if client_id else "default"
        clean_route = str(route).strip() if route else "default"
        bucket_key = f"{clean_id}:{clean_route}"

        with self._lock:
            if bucket_key not in self.buckets:
                params = self.resolve_client_params(clean_id)
                bucket = TokenBucket(capacity=params["capacity"], refill_rate=params["refill_rate"])
                bucket.last_refill = now
                self.buckets[bucket_key] = bucket

            return self.buckets[bucket_key]

    def check_limit(self, client_id: str, route: str = "default", cost: int = 1, now: float = None) -> dict:
        """
        Evaluates rate limit status for a client without consuming tokens.

        :param client_id: Client identifier.
        :param route: API route name.
        :param cost: Cost in tokens.
        :param now: Timestamp in seconds.
        :return: Evaluation result dict.

        :visibility: public
        """
        if now is None:
            now = time.time()
        clean_id = str(client_id).strip() if client_id else "default"
        clean_route = str(route).strip() if route else "default"
        req_cost = max(1, int(cost) if cost is not None else 1)

        params = self.resolve_client_params(clean_id)
        bucket = self.get_bucket(clean_id, route=clean_route, now=now)
        current_tokens = bucket.get_tokens(now=now)

        allowed = current_tokens >= req_cost
        reset_ms = bucket.get_time_to_refill(req_cost, now=now)
        retry_sec = 0 if allowed else math.ceil((req_cost - current_tokens) / bucket.refill_rate)

        return {
            "allowed": allowed,
            "remaining": current_tokens,
            "capacity": bucket.capacity,
            "reset_in_ms": reset_ms,
            "retry_after_sec": retry_sec,
            "client_id": clean_id,
            "route": clean_route,
            "tier": params["tier"]
        }

    def consume(self, client_id: str, route: str = "default", cost: int = 1, now: float = None) -> dict:
        """
        Consumes tokens for a request from a given client and route.
        Updates analytics and metrics upon consumption.

        :param client_id: Client identifier.
        :param route: API route name.
        :param cost: Cost in tokens.
        :param now: Timestamp in seconds.
        :return: Consumption result dict.

        :visibility: public
        """
        if now is None:
            now = time.time()
        clean_id = str(client_id).strip() if client_id else "default"
        clean_route = str(route).strip() if route else "default"
        req_cost = max(1, int(cost) if cost is not None else 1)

        params = self.resolve_client_params(clean_id)
        bucket = self.get_bucket(clean_id, route=clean_route, now=now)
        result = bucket.try_consume(cost=req_cost, now=now)

        # Update analytics metrics
        with self._lock:
            self.metrics["total_requests"] += 1
            if result["allowed"]:
                self.metrics["allowed_requests"] += 1
            else:
                self.metrics["throttled_requests"] += 1

            if clean_id not in self.metrics["client_metrics"]:
                self.metrics["client_metrics"][clean_id] = {
                    "total_requests": 0,
                    "allowed_requests": 0,
                    "throttled_requests": 0,
                    "last_request_time": now,
                    "tier": params["tier"],
                    "routes": {}
                }

            cm = self.metrics["client_metrics"][clean_id]
            cm["total_requests"] += 1
            cm["last_request_time"] = now
            cm["tier"] = params["tier"]

            if result["allowed"]:
                cm["allowed_requests"] += 1
            else:
                cm["throttled_requests"] += 1

            if clean_route not in cm["routes"]:
                cm["routes"][clean_route] = {"total": 0, "allowed": 0, "throttled": 0}
            cm["routes"][clean_route]["total"] += 1
            if result["allowed"]:
                cm["routes"][clean_route]["allowed"] += 1
            else:
                cm["routes"][clean_route]["throttled"] += 1

        return {
            "allowed": result["allowed"],
            "remaining": result["remaining"],
            "capacity": result["capacity"],
            "reset_in_ms": result["reset_in_ms"],
            "retry_after_sec": result["retry_after_sec"],
            "client_id": clean_id,
            "route": clean_route,
            "tier": params["tier"]
        }

    def enforce_fair_usage(self, client_id: str, route: str = "default", cost: int = 1, now: float = None) -> dict:
        """
        Enforces fair usage policy for a request.

        :param client_id: Client identifier.
        :param route: Route or feature name.
        :param cost: Token cost.
        :param now: Timestamp in seconds.
        :return: Result dict.

        :visibility: public
        """
        return self.consume(client_id, route=route, cost=cost, now=now)

    def get_usage_percentage(self, client_id: str, route: str = "default", now: float = None) -> float:
        """
        Calculates usage percentage for a client's bucket (0% = full bucket, 100% = empty bucket).

        :param client_id: Client identifier.
        :param route: Route name.
        :param now: Timestamp in seconds.
        :return: Usage percentage float (0.0 to 100.0).

        :visibility: public
        """
        if now is None:
            now = time.time()
        bucket = self.get_bucket(client_id, route=route, now=now)
        current = bucket.get_tokens(now=now)
        used = max(0.0, bucket.capacity - current)
        return min(100.0, (used / bucket.capacity) * 100.0)

    def get_analytics(self, client_id: str = None) -> dict:
        """
        Retrieves analytics and metric statistics.

        :param client_id: Optional client ID filter.
        :return: Analytics metrics dict.

        :visibility: public
        """
        with self._lock:
            if client_id:
                clean_id = str(client_id).strip()
                cm = self.metrics["client_metrics"].get(clean_id, {
                    "total_requests": 0,
                    "allowed_requests": 0,
                    "throttled_requests": 0,
                    "last_request_time": None,
                    "tier": self.resolve_client_params(clean_id)["tier"],
                    "routes": {}
                })
                usage_pct = self.get_usage_percentage(clean_id)
                total_reqs = cm["total_requests"]
                throttle_rate_pct = (cm["throttled_requests"] / total_reqs * 100.0) if total_reqs > 0 else 0.0

                return {
                    "client_id": clean_id,
                    **cm,
                    "throttle_rate_percentage": round(throttle_rate_pct, 2),
                    "usage_percentage": round(usage_pct, 2)
                }

            total = self.metrics["total_requests"]
            throttled = self.metrics["throttled_requests"]
            throttle_rate_pct = (throttled / total * 100.0) if total > 0 else 0.0
            active_clients = list(self.metrics["client_metrics"].keys())

            peak_client = None
            max_reqs = 0
            for cid, cm in self.metrics["client_metrics"].items():
                if cm["total_requests"] > max_reqs:
                    max_reqs = cm["total_requests"]
                    peak_client = cid

            client_details = {}
            for cid, cm in self.metrics["client_metrics"].items():
                bucket = self.get_bucket(cid)
                client_details[cid] = {
                    "total_requests": cm["total_requests"],
                    "allowed_requests": cm["allowed_requests"],
                    "throttled_requests": cm["throttled_requests"],
                    "tier": cm["tier"],
                    "current_tokens": bucket.get_tokens(),
                    "capacity": bucket.capacity,
                    "usage_percentage": round(self.get_usage_percentage(cid), 2)
                }

            return {
                "total_requests": total,
                "allowed_requests": self.metrics["allowed_requests"],
                "throttled_requests": throttled,
                "throttle_rate_percentage": round(throttle_rate_pct, 2),
                "active_clients_count": len(active_clients),
                "peak_usage_client": peak_client,
                "client_details": client_details
            }

    def reset_analytics(self):
        """
        Resets all analytics and metrics counters.

        :visibility: public
        """
        with self._lock:
            self.metrics = {
                "total_requests": 0,
                "allowed_requests": 0,
                "throttled_requests": 0,
                "client_metrics": {}
            }

    def reset_client_bucket(self, client_id: str, route: str = "default"):
        """
        Resets token bucket for a specific client and route.

        :param client_id: Client identifier.
        :param route: Route name.

        :visibility: public
        """
        clean_id = str(client_id).strip() if client_id else "default"
        clean_route = str(route).strip() if route else "default"
        bucket_key = f"{clean_id}:{clean_route}"
        with self._lock:
            if bucket_key in self.buckets:
                self.buckets[bucket_key].reset()

    def clear_all_buckets(self):
        """
        Clears all token buckets and client limits.

        :visibility: public
        """
        with self._lock:
            self.buckets.clear()
            self.client_limits.clear()
            self.client_tiers.clear()
            self.reset_analytics()


default_rate_limiter = APIRateLimiter()
