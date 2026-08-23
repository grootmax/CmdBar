import { TokenBucket, APIRateLimiter, defaultRateLimiter } from '../extension/rateLimiter.js';
import { CmdBarDBusService } from '../extension/dbusService.js';

describe('Enterprise API Rate Limiter Unit & Integration Tests', () => {

  describe('TokenBucket Core Logic', () => {
    test('initializes with default capacity and refill rate', () => {
      const bucket = new TokenBucket();
      expect(bucket.capacity).toBe(60);
      expect(bucket.refillRate).toBe(1.0);
      expect(bucket.tokens).toBe(60);
    });

    test('initializes with custom parameters and initial tokens', () => {
      const bucket = new TokenBucket({ capacity: 10, refillRate: 2.0, initialTokens: 5 });
      expect(bucket.capacity).toBe(10);
      expect(bucket.refillRate).toBe(2.0);
      expect(bucket.tokens).toBe(5);
    });

    test('allows token consumption within capacity (burst handling)', () => {
      const bucket = new TokenBucket({ capacity: 5, refillRate: 1.0 });
      const now = 1000000;
      bucket.lastRefill = now;

      const res1 = bucket.tryConsume(3, now);
      expect(res1.allowed).toBe(true);
      expect(res1.remaining).toBe(2);
      expect(res1.capacity).toBe(5);

      const res2 = bucket.tryConsume(2, now);
      expect(res2.allowed).toBe(true);
      expect(res2.remaining).toBe(0);
    });

    test('rejects token consumption when bucket is depleted', () => {
      const bucket = new TokenBucket({ capacity: 2, refillRate: 1.0 });
      const now = 1000000;
      bucket.lastRefill = now;

      bucket.tryConsume(2, now);
      const res = bucket.tryConsume(1, now);

      expect(res.allowed).toBe(false);
      expect(res.remaining).toBe(0);
      expect(res.resetInMs).toBe(1000); // 1 token needed at 1.0 token/sec = 1000ms
      expect(res.retryAfterSec).toBe(1);
    });

    test('refills tokens accurately over time', () => {
      const bucket = new TokenBucket({ capacity: 10, refillRate: 2.0, initialTokens: 0 });
      let now = 1000000;
      bucket.lastRefill = now;

      expect(bucket.getTokens(now)).toBe(0);

      // Advance time by 2.5 seconds => 2.5 * 2.0 = 5 tokens
      now += 2500;
      expect(bucket.getTokens(now)).toBe(5);

      // Try consuming 4 tokens
      const res = bucket.tryConsume(4, now);
      expect(res.allowed).toBe(true);
      expect(res.remaining).toBe(1);

      // Advance time by 10 seconds => tokens capped at capacity (10)
      now += 10000;
      expect(bucket.getTokens(now)).toBe(10);
    });

    test('calculates correct time to refill for target token amounts', () => {
      const bucket = new TokenBucket({ capacity: 10, refillRate: 2.0, initialTokens: 2 });
      const now = 1000000;
      bucket.lastRefill = now;

      // 2 tokens available, need 6 -> missing 4 tokens @ 2 tokens/sec = 2000 ms
      expect(bucket.getTimeToRefill(6, now)).toBe(2000);
      // need 1 token -> already have 2 -> 0 ms
      expect(bucket.getTimeToRefill(1, now)).toBe(0);
    });

    test('resets bucket to full capacity', () => {
      const bucket = new TokenBucket({ capacity: 10, refillRate: 1.0, initialTokens: 0 });
      const now = 1000000;

      bucket.reset(now);
      expect(bucket.getTokens(now)).toBe(10);
    });
  });

  describe('APIRateLimiter Tier & Multi-Tenant Isolation', () => {
    let limiter;

    beforeEach(() => {
      limiter = new APIRateLimiter({
        defaultCapacity: 20,
        defaultRefillRate: 1.0,
        defaultTier: 'pro'
      });
    });

    test('provides isolated rate limiting for separate clients', () => {
      const now = 1000000;
      limiter.setClientTier('client_A', 'free'); // capacity 10, refill 0.1667
      limiter.setClientTier('client_B', 'enterprise'); // capacity 300, refill 5.0

      const resA = limiter.consume('client_A', { cost: 10, now });
      expect(resA.allowed).toBe(true);
      expect(resA.remaining).toBe(0);

      // client_A is now empty
      const resA2 = limiter.consume('client_A', { cost: 1, now });
      expect(resA2.allowed).toBe(false);

      // client_B remains completely unaffected by client_A's usage
      const resB = limiter.consume('client_B', { cost: 50, now });
      expect(resB.allowed).toBe(true);
      expect(resB.remaining).toBe(250);
    });

    test('allows setting dynamic custom tiers and client limits', () => {
      limiter.setTier('gold', { capacity: 500, refillRate: 10.0 });
      limiter.setClientTier('vip_user', 'gold');

      const params = limiter.resolveClientParams('vip_user');
      expect(params.capacity).toBe(500);
      expect(params.refillRate).toBe(10.0);
      expect(params.tier).toBe('gold');

      limiter.setClientLimit('vip_user', { capacity: 1000 });
      const updatedParams = limiter.resolveClientParams('vip_user');
      expect(updatedParams.capacity).toBe(1000);
      expect(updatedParams.refillRate).toBe(10.0);
    });

    test('supports route-level isolation per client', () => {
      const now = 1000000;
      limiter.setClientLimit('tenant1', { capacity: 5, refillRate: 1.0 });

      // Consume tokens on "ai_translator" route
      for (let i = 0; i < 5; i++) {
        expect(limiter.consume('tenant1', { route: 'ai_translator', now }).allowed).toBe(true);
      }
      expect(limiter.consume('tenant1', { route: 'ai_translator', now }).allowed).toBe(false);

      // "command_execution" route for tenant1 has its own separate bucket
      expect(limiter.consume('tenant1', { route: 'command_execution', now }).allowed).toBe(true);
    });

    test('checkLimit evaluates rate limit without consuming tokens', () => {
      const now = 1000000;
      limiter.setClientLimit('client_peek', { capacity: 2, refillRate: 1.0 });

      const check1 = limiter.checkLimit('client_peek', { now });
      expect(check1.allowed).toBe(true);
      expect(check1.remaining).toBe(2);

      // Consume 2 tokens
      limiter.consume('client_peek', { cost: 2, now });

      const check2 = limiter.checkLimit('client_peek', { now });
      expect(check2.allowed).toBe(false);
      expect(check2.remaining).toBe(0);
      expect(check2.retryAfterSec).toBe(1);
    });

    test('enforceFairUsage enforces fair usage token consumption', () => {
      const now = 1000000;
      limiter.setClientLimit('user_fair', { capacity: 3, refillRate: 1.0 });

      const res = limiter.enforceFairUsage('user_fair', 'search', { cost: 2, now });
      expect(res.allowed).toBe(true);
      expect(res.remaining).toBe(1);
      expect(res.route).toBe('search');
    });

    test('getUsagePercentage returns accurate capacity consumption percentage', () => {
      const now = 1000000;
      limiter.setClientLimit('user_usage', { capacity: 10, refillRate: 1.0 });

      expect(limiter.getUsagePercentage('user_usage', 'default', now)).toBe(0);

      limiter.consume('user_usage', { cost: 5, now });
      expect(limiter.getUsagePercentage('user_usage', 'default', now)).toBe(50);

      limiter.consume('user_usage', { cost: 5, now });
      expect(limiter.getUsagePercentage('user_usage', 'default', now)).toBe(100);
    });
  });

  describe('APIRateLimiter Analytics & Metrics', () => {
    let limiter;

    beforeEach(() => {
      limiter = new APIRateLimiter({ defaultCapacity: 5, defaultRefillRate: 1.0 });
    });

    test('tracks global and per-client request analytics', () => {
      const now = 1000000;
      limiter.setClientLimit('client_A', { capacity: 5, refillRate: 1.0 });
      limiter.setClientLimit('client_B', { capacity: 5, refillRate: 1.0 });

      // Client A: 3 allowed requests
      limiter.consume('client_A', { cost: 1, now });
      limiter.consume('client_A', { cost: 1, now });
      limiter.consume('client_A', { cost: 1, now });

      // Client B: 5 allowed, 2 throttled requests
      for (let i = 0; i < 5; i++) {
        limiter.consume('client_B', { cost: 1, now });
      }
      limiter.consume('client_B', { cost: 1, now }); // throttled
      limiter.consume('client_B', { cost: 1, now }); // throttled

      const globalStats = limiter.getAnalytics();
      expect(globalStats.totalRequests).toBe(10);
      expect(globalStats.allowedRequests).toBe(8);
      expect(globalStats.throttledRequests).toBe(2);
      expect(globalStats.throttleRatePercentage).toBe(20.0);
      expect(globalStats.activeClientsCount).toBe(2);
      expect(globalStats.peakUsageClient).toBe('client_B');

      const clientBStats = limiter.getAnalytics('client_B');
      expect(clientBStats.clientId).toBe('client_B');
      expect(clientBStats.totalRequests).toBe(7);
      expect(clientBStats.allowedRequests).toBe(5);
      expect(clientBStats.throttledRequests).toBe(2);
      expect(clientBStats.throttleRatePercentage).toBe(28.57);
    });

    test('resets analytics and bucket instances', () => {
      const now = 1000000;
      limiter.setClientLimit('client_X', { capacity: 5, refillRate: 1.0 });
      limiter.consume('client_X', { cost: 1, now });
      expect(limiter.getAnalytics().totalRequests).toBe(1);

      limiter.resetAnalytics();
      expect(limiter.getAnalytics().totalRequests).toBe(0);

      limiter.resetClientBucket('client_X');
      expect(limiter.getBucket('client_X').getTokens(now)).toBe(5);

      limiter.clearAllBuckets();
      expect(limiter.getAnalytics().activeClientsCount).toBe(0);
    });
  });

  describe('D-Bus API Rate Limiting Integration', () => {
    test('CmdBarDBusService rate limit methods respond as expected', async () => {
      const dbusService = new CmdBarDBusService(null);
      
      const checkRaw = await dbusService.CheckRateLimit('dbus_client_1', 'ExecuteCommand');
      const checkRes = JSON.parse(checkRaw);
      expect(checkRes.allowed).toBe(true);
      expect(checkRes.clientId).toBe('dbus_client_1');

      const consumeRaw = await dbusService.ConsumeRateLimit('dbus_client_1', 'ExecuteCommand', 1);
      const consumeRes = JSON.parse(consumeRaw);
      expect(consumeRes.allowed).toBe(true);

      const analyticsRaw = await dbusService.GetRateLimitAnalytics('dbus_client_1');
      const analyticsRes = JSON.parse(analyticsRaw);
      expect(analyticsRes.clientId).toBe('dbus_client_1');
      expect(analyticsRes.totalRequests).toBe(1);
    });
  });

});
