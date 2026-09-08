import { TokenBucket, ApiRateLimiter } from "../extension/rateLimiter.js";
import { CmdBarDBusService } from "../extension/dbusService.js";

describe("API Rate Limiting Unit & Integration Tests", () => {
  let mockTime;
  let timeProvider;

  beforeEach(() => {
    mockTime = 1000000;
    timeProvider = () => mockTime;
  });

  describe("TokenBucket Class Unit Tests", () => {
    test("initializes with default capacity and full tokens", () => {
      const bucket = new TokenBucket({ timeProvider });
      expect(bucket.capacity).toBe(60);
      expect(bucket.getTokens()).toBe(60);
    });

    test("consumes tokens and decrements remaining count", () => {
      const bucket = new TokenBucket({ capacity: 10, refillRate: 1, refillIntervalMs: 1000, timeProvider });
      const res1 = bucket.tryConsume(1);
      expect(res1.allowed).toBe(true);
      expect(res1.remaining).toBe(9);
      expect(bucket.getTokens()).toBe(9);

      const res2 = bucket.tryConsume(3);
      expect(res2.allowed).toBe(true);
      expect(res2.remaining).toBe(6);
      expect(bucket.getTokens()).toBe(6);
    });

    test("burst handling: allows burst up to capacity then throttles", () => {
      const bucket = new TokenBucket({ capacity: 5, refillRate: 1, refillIntervalMs: 1000, timeProvider });

      for (let i = 0; i < 5; i++) {
        const res = bucket.tryConsume(1);
        expect(res.allowed).toBe(true);
      }

      const throttled = bucket.tryConsume(1);
      expect(throttled.allowed).toBe(false);
      expect(throttled.remaining).toBe(0);
      expect(throttled.retryAfterMs).toBeGreaterThan(0);
    });

    test("refills tokens accurately as time passes", () => {
      const bucket = new TokenBucket({ capacity: 10, refillRate: 2, refillIntervalMs: 1000, timeProvider });

      // Consume all 10 tokens
      bucket.tryConsume(10);
      expect(bucket.getTokens()).toBe(0);

      // Advance time by 2 seconds (2000 ms -> 4 tokens refilled)
      mockTime += 2000;
      expect(bucket.getTokens()).toBe(4);

      const res = bucket.tryConsume(3);
      expect(res.allowed).toBe(true);
      expect(res.remaining).toBe(1);
    });

    test("resets bucket to full capacity", () => {
      const bucket = new TokenBucket({ capacity: 10, timeProvider });
      bucket.tryConsume(8);
      expect(bucket.getTokens()).toBe(2);

      bucket.reset();
      expect(bucket.getTokens()).toBe(10);
    });
  });

  describe("ApiRateLimiter Unit Tests", () => {
    test("supports tier limits (enterprise, pro, free)", () => {
      const limiter = new ApiRateLimiter({ timeProvider });

      const ent = limiter.checkRateLimit("client-ent", { tier: "enterprise" });
      expect(ent.limit).toBe(1000);

      const pro = limiter.checkRateLimit("client-pro", { tier: "pro" });
      expect(pro.limit).toBe(300);

      const free = limiter.checkRateLimit("client-free", { tier: "free" });
      expect(free.limit).toBe(60);
    });

    test("supports custom per-client and per-endpoint rules", () => {
      const limiter = new ApiRateLimiter({ timeProvider });
      limiter.setCustomLimit("heavy-endpoint", { capacity: 5, refillRate: 1, refillIntervalMs: 1000 });

      const res = limiter.checkRateLimit("user1", { endpoint: "heavy-endpoint" });
      expect(res.limit).toBe(5);

      // Verify custom limit removal
      limiter.removeCustomLimit("heavy-endpoint");
      const resAfter = limiter.checkRateLimit("user1", { endpoint: "heavy-endpoint" });
      expect(resAfter.limit).toBe(60);
    });

    test("fair usage isolation: clients do not interfere with each other's buckets", () => {
      const limiter = new ApiRateLimiter({
        defaultLimit: { capacity: 2, refillRate: 1, refillIntervalMs: 1000 },
        timeProvider,
      });

      // Client A consumes all tokens
      expect(limiter.checkRateLimit("clientA").allowed).toBe(true);
      expect(limiter.checkRateLimit("clientA").allowed).toBe(true);
      expect(limiter.checkRateLimit("clientA").allowed).toBe(false);

      // Client B should still have full quota
      expect(limiter.checkRateLimit("clientB").allowed).toBe(true);
      expect(limiter.checkRateLimit("clientB").allowed).toBe(true);
    });

    test("formats standard rate limit headers", () => {
      const limiter = new ApiRateLimiter({
        defaultLimit: { capacity: 5, refillRate: 1, refillIntervalMs: 1000 },
        timeProvider,
      });

      const res = limiter.checkRateLimit("client1");
      expect(res.headers).toBeDefined();
      expect(res.headers["X-RateLimit-Limit"]).toBe("5");
      expect(res.headers["X-RateLimit-Remaining"]).toBe("4");
      expect(res.headers["X-RateLimit-Reset"]).toBeDefined();
    });

    test("getQuotaStatus inspects quota without consuming tokens", () => {
      const limiter = new ApiRateLimiter({ timeProvider });
      const status = limiter.getQuotaStatus("client1", "endpoint1", "pro");

      expect(status.tokens).toBe(300);
      expect(status.capacity).toBe(300);
      expect(status.isThrottled).toBe(false);

      // Quota status check should not consume tokens
      const check = limiter.checkRateLimit("client1", { endpoint: "endpoint1", tier: "pro" });
      expect(check.remaining).toBe(299);
    });

    test("records and reports analytics", () => {
      const limiter = new ApiRateLimiter({
        defaultLimit: { capacity: 2, refillRate: 1, refillIntervalMs: 1000 },
        timeProvider,
      });

      limiter.checkRateLimit("client1", { endpoint: "execute" });
      limiter.checkRateLimit("client1", { endpoint: "execute" });
      limiter.checkRateLimit("client1", { endpoint: "execute" }); // throttled

      const analytics = limiter.getAnalytics();
      expect(analytics.totalRequests).toBe(3);
      expect(analytics.allowedRequests).toBe(2);
      expect(analytics.throttledRequests).toBe(1);
      expect(analytics.tokensConsumed).toBe(2);

      const clientStats = limiter.getClientStats("client1");
      expect(clientStats.total).toBe(3);
      expect(clientStats.allowed).toBe(2);
      expect(clientStats.throttled).toBe(1);

      // Reset analytics
      limiter.resetAnalytics();
      expect(limiter.getAnalytics().totalRequests).toBe(0);
    });
  });

  describe("Integration & Middleware Wrappers", () => {
    test("wrapDBusMethod rate limits method calls", async () => {
      const limiter = new ApiRateLimiter({
        defaultLimit: { capacity: 2, refillRate: 1, refillIntervalMs: 1000 },
        timeProvider,
      });

      let callCount = 0;
      const fn = async () => {
        callCount++;
        return true;
      };

      const wrapped = limiter.wrapDBusMethod("testMethod", fn, { clientId: "test-client" });

      expect(await wrapped()).toBe(true);
      expect(await wrapped()).toBe(true);
      expect(await wrapped()).toBe(false); // Throttled
      expect(callCount).toBe(2);
    });

    test("wrapAIService applies rate limiting and throws when exceeded", async () => {
      const limiter = new ApiRateLimiter({
        tiers: { pro: { capacity: 10, refillRate: 1, refillIntervalMs: 1000 } },
        timeProvider,
      });

      const aiFn = async (prompt) => `Command for ${prompt}`;
      const wrapped = limiter.wrapAIService(aiFn, { clientId: "ai-user", tier: "pro", tokensToConsume: 5 });

      expect(await wrapped("deploy app")).toBe("Command for deploy app");
      expect(await wrapped("build container")).toBe("Command for build container");

      // Third request requires 5 tokens, but bucket is empty (10 consumed)
      await expect(wrapped("run tests")).rejects.toThrow("AI rate limit exceeded");
    });

    test("CmdBarDBusService respects attached rate limiter", async () => {
      const limiter = new ApiRateLimiter({
        defaultLimit: { capacity: 1, refillRate: 1, refillIntervalMs: 1000 },
        timeProvider,
      });

      const service = new CmdBarDBusService(null, limiter);

      // First call allowed
      expect(await service.ExecuteCommand("echo 1")).toBe(true);

      // Second call throttled by rate limiter
      expect(await service.ExecuteCommand("echo 2")).toBe(false);
    });
  });

  describe("Performance Benchmarks", () => {
    test("meets performance requirement: evaluates 10,000 rate limit checks efficiently", () => {
      const limiter = new ApiRateLimiter();
      const startTime = performance.now();

      for (let i = 0; i < 10000; i++) {
        limiter.checkRateLimit(`client-${i % 100}`, { endpoint: `endpoint-${i % 10}` });
      }

      const durationMs = performance.now() - startTime;
      expect(durationMs).toBeLessThan(500); // Sub-millisecond execution overhead per check
    });
  });
});
