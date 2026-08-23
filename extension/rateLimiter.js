/**
 * Enterprise API Rate Limiter using Token Bucket Algorithm.
 * Implements token buckets, burst handling, fair usage policy across client tiers,
 * custom limit overrides, and usage analytics tracking for CmdBar.
 *
 * @module extension/rateLimiter
 */

/**
 * TokenBucket represents a single token bucket instance for rate limiting.
 * Handles token refills based on elapsed time and burst consumption.
 *
 * @public
 */
export class TokenBucket {
  /**
   * Constructs a new TokenBucket instance.
   *
   * @param {object} [options={}] - Bucket configuration options.
   * @param {number} [options.capacity=60] - Maximum capacity (burst size).
   * @param {number} [options.refillRate=1.0] - Refill rate in tokens per second.
   * @param {number} [options.initialTokens=null] - Initial tokens (defaults to capacity).
   * @public
   */
  constructor(options = {}) {
    const { capacity = 60, refillRate = 1.0, initialTokens = null } = options;
    this.capacity = Math.max(1, Number(capacity) || 60);
    this.refillRate = Math.max(0.0001, Number(refillRate) || 1.0);
    this.tokens = initialTokens !== null && initialTokens !== undefined
      ? Math.min(this.capacity, Math.max(0, Number(initialTokens)))
      : this.capacity;
    this.lastRefill = Date.now();
  }

  /**
   * Internal method to calculate elapsed time and refill tokens.
   *
   * @param {number} [now=Date.now()] - Current timestamp in milliseconds.
   * @returns {number} Current token count after refill.
   * @private
   */
  _refill(now = Date.now()) {
    const elapsedSec = Math.max(0, (now - this.lastRefill) / 1000);
    if (elapsedSec > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillRate);
      this.lastRefill = now;
    }
    return this.tokens;
  }

  /**
   * Attempts to consume the specified number of tokens from the bucket.
   *
   * @param {number} [cost=1] - Number of tokens to consume.
   * @param {number} [now=Date.now()] - Current timestamp in milliseconds.
   * @returns {object} Result object containing `allowed`, `remaining`, `capacity`, `resetInMs`, and `retryAfterSec`.
   * @public
   */
  tryConsume(cost = 1, now = Date.now()) {
    this._refill(now);
    const reqCost = Math.max(1, Number(cost) || 1);

    if (this.tokens >= reqCost) {
      this.tokens -= reqCost;
      return {
        allowed: true,
        remaining: this.tokens,
        capacity: this.capacity,
        resetInMs: this.getTimeToRefill(reqCost, now),
        retryAfterSec: 0
      };
    } else {
      const needed = reqCost - this.tokens;
      const resetMs = Math.ceil((needed / this.refillRate) * 1000);
      const retrySec = Math.ceil(needed / this.refillRate);

      return {
        allowed: false,
        remaining: this.tokens,
        capacity: this.capacity,
        resetInMs: resetMs,
        retryAfterSec: retrySec
      };
    }
  }

  /**
   * Retrieves the current available tokens in the bucket after refilling.
   *
   * @param {number} [now=Date.now()] - Current timestamp in milliseconds.
   * @returns {number} Available tokens.
   * @public
   */
  getTokens(now = Date.now()) {
    return this._refill(now);
  }

  /**
   * Calculates time in milliseconds required to refill up to the needed token count.
   *
   * @param {number} [neededTokens=1] - Target number of tokens needed.
   * @param {number} [now=Date.now()] - Current timestamp in milliseconds.
   * @returns {number} Time to refill in milliseconds.
   * @public
   */
  getTimeToRefill(neededTokens = 1, now = Date.now()) {
    this._refill(now);
    const target = Math.max(1, Number(neededTokens) || 1);
    if (this.tokens >= target) {
      return 0;
    }
    const needed = target - this.tokens;
    return Math.ceil((needed / this.refillRate) * 1000);
  }

  /**
   * Resets the bucket to full capacity.
   *
   * @param {number} [now=Date.now()] - Current timestamp in milliseconds.
   * @public
   */
  reset(now = Date.now()) {
    this.tokens = this.capacity;
    this.lastRefill = now;
  }
}

/**
 * APIRateLimiter provides centralized multi-tenant rate limiting with token buckets,
 * fair usage isolation, custom limits per client, tier management, and analytics.
 *
 * @public
 */
export class APIRateLimiter {
  /**
   * Constructs an APIRateLimiter instance.
   *
   * @param {object} [options={}] - Configuration options.
   * @param {number} [options.defaultCapacity=60] - Default capacity for unclassified clients.
   * @param {number} [options.defaultRefillRate=1.0] - Default refill rate (tokens/sec).
   * @param {string} [options.defaultTier="pro"] - Default tier for unclassified clients.
   * @param {object} [options.tiers={}] - Custom tier definitions map.
   * @public
   */
  constructor(options = {}) {
    this.defaultCapacity = Math.max(1, Number(options.defaultCapacity) || 60);
    this.defaultRefillRate = Math.max(0.0001, Number(options.defaultRefillRate) || 1.0);
    this.defaultTier = options.defaultTier || "pro";

    this.tiers = {
      free: { capacity: 10, refillRate: 0.1667 }, // ~10 req/min
      pro: { capacity: 60, refillRate: 1.0 },      // ~60 req/min
      enterprise: { capacity: 300, refillRate: 5.0 }, // ~300 req/min
      ...(options.tiers || {})
    };

    /** @type {Map<string, TokenBucket>} */
    this.buckets = new Map();

    /** @type {Map<string, { capacity?: number, refillRate?: number, tier?: string }>} */
    this.clientLimits = new Map();

    /** @type {Map<string, string>} */
    this.clientTiers = new Map();

    // Analytics metrics
    this.metrics = {
      totalRequests: 0,
      allowedRequests: 0,
      throttledRequests: 0,
      clientMetrics: {}
    };
  }

  /**
   * Defines or updates a subscription tier.
   *
   * @param {string} tierName - Name of the tier (e.g. "free", "pro", "enterprise").
   * @param {object} config - Tier configuration `{ capacity, refillRate }`.
   * @public
   */
  setTier(tierName, config = {}) {
    if (!tierName || typeof tierName !== "string") return;
    this.tiers[tierName] = {
      capacity: Math.max(1, Number(config.capacity) || 60),
      refillRate: Math.max(0.0001, Number(config.refillRate) || 1.0)
    };
  }

  /**
   * Retrieves configuration for a given tier.
   *
   * @param {string} tierName - Name of the tier.
   * @returns {object} Tier configuration.
   * @public
   */
  getTier(tierName) {
    if (tierName && this.tiers[tierName]) {
      return { ...this.tiers[tierName] };
    }
    return {
      capacity: this.defaultCapacity,
      refillRate: this.defaultRefillRate
    };
  }

  /**
   * Sets custom rate limits or assigned tier for a specific client.
   *
   * @param {string} clientId - Unique identifier for client, user, or IP.
   * @param {object} limitOptions - `{ capacity, refillRate, tier }`.
   * @public
   */
  setClientLimit(clientId, limitOptions = {}) {
    if (!clientId) return;
    const cleanId = String(clientId).trim();
    const existing = this.clientLimits.get(cleanId) || {};
    const updated = { ...existing };

    if (limitOptions.capacity !== undefined && limitOptions.capacity !== null) {
      updated.capacity = Math.max(1, Number(limitOptions.capacity));
    }
    if (limitOptions.refillRate !== undefined && limitOptions.refillRate !== null) {
      updated.refillRate = Math.max(0.0001, Number(limitOptions.refillRate));
    }
    if (limitOptions.tier) {
      updated.tier = String(limitOptions.tier);
      this.clientTiers.set(cleanId, updated.tier);
    }

    this.clientLimits.set(cleanId, updated);

    // If bucket already exists and limits changed, recreate or adjust bucket
    const keyPrefix = `${cleanId}:`;
    for (const [key, bucket] of this.buckets.entries()) {
      if (key.startsWith(keyPrefix) || key === cleanId) {
        if (updated.capacity !== undefined) bucket.capacity = updated.capacity;
        if (updated.refillRate !== undefined) bucket.refillRate = updated.refillRate;
      }
    }
  }

  /**
   * Assigns a client to a specific tier.
   *
   * @param {string} clientId - Unique identifier for client.
   * @param {string} tierName - Tier name.
   * @public
   */
  setClientTier(clientId, tierName) {
    if (!clientId) return;
    const cleanId = String(clientId).trim();
    const cleanTier = String(tierName).trim();
    this.clientTiers.set(cleanId, cleanTier);

    const tierCfg = this.getTier(cleanTier);
    this.setClientLimit(cleanId, {
      capacity: tierCfg.capacity,
      refillRate: tierCfg.refillRate,
      tier: cleanTier
    });
  }

  /**
   * Resolves rate limit parameters for a client ID.
   *
   * @param {string} clientId - Client identifier.
   * @returns {object} Limit params `{ capacity, refillRate, tier }`.
   * @public
   */
  resolveClientParams(clientId) {
    const cleanId = clientId ? String(clientId).trim() : "default";
    const custom = this.clientLimits.get(cleanId) || {};
    const assignedTier = custom.tier || this.clientTiers.get(cleanId) || this.defaultTier;
    const tierCfg = this.getTier(assignedTier);

    return {
      capacity: custom.capacity !== undefined ? custom.capacity : tierCfg.capacity,
      refillRate: custom.refillRate !== undefined ? custom.refillRate : tierCfg.refillRate,
      tier: assignedTier
    };
  }

  /**
   * Gets or creates a TokenBucket instance for a client and route.
   *
   * @param {string} clientId - Client identifier.
   * @param {string} [route="default"] - API route or command category name.
   * @param {number} [now=Date.now()] - Timestamp in milliseconds.
   * @returns {TokenBucket} TokenBucket instance.
   * @public
   */
  getBucket(clientId, route = "default", now = Date.now()) {
    const cleanId = clientId ? String(clientId).trim() : "default";
    const cleanRoute = route ? String(route).trim() : "default";
    const bucketKey = `${cleanId}:${cleanRoute}`;

    if (!this.buckets.has(bucketKey)) {
      const params = this.resolveClientParams(cleanId);
      const bucket = new TokenBucket({
        capacity: params.capacity,
        refillRate: params.refillRate
      });
      bucket.lastRefill = now;
      this.buckets.set(bucketKey, bucket);
    }

    return this.buckets.get(bucketKey);
  }

  /**
   * Evaluates rate limit status for a client without consuming tokens (peek).
   *
   * @param {string} clientId - Client identifier.
   * @param {object} [options={}] - Options `{ route, cost, now }`.
   * @returns {object} Rate limit evaluation result.
   * @public
   */
  checkLimit(clientId, options = {}) {
    const cleanId = clientId ? String(clientId).trim() : "default";
    const route = options.route || "default";
    const cost = Math.max(1, Number(options.cost) || 1);
    const now = options.now || Date.now();

    const params = this.resolveClientParams(cleanId);
    const bucket = this.getBucket(cleanId, route, now);
    const currentTokens = bucket.getTokens(now);

    const allowed = currentTokens >= cost;
    const resetMs = bucket.getTimeToRefill(cost, now);
    const retrySec = allowed ? 0 : Math.ceil((cost - currentTokens) / bucket.refillRate);

    return {
      allowed,
      remaining: currentTokens,
      capacity: bucket.capacity,
      resetInMs: resetMs,
      retryAfterSec: retrySec,
      clientId: cleanId,
      route,
      tier: params.tier
    };
  }

  /**
   * Consumes tokens for a request from a given client and route.
   * Updates analytics and metrics upon consumption.
   *
   * @param {string} clientId - Client identifier.
   * @param {object} [options={}] - Options `{ route, cost, now }`.
   * @returns {object} Result object `{ allowed, remaining, capacity, resetInMs, retryAfterSec, clientId, route, tier }`.
   * @public
   */
  consume(clientId, options = {}) {
    const cleanId = clientId ? String(clientId).trim() : "default";
    const route = options.route || "default";
    const cost = Math.max(1, Number(options.cost) || 1);
    const now = options.now || Date.now();

    const params = this.resolveClientParams(cleanId);
    const bucket = this.getBucket(cleanId, route, now);
    const result = bucket.tryConsume(cost, now);

    // Update global analytics
    this.metrics.totalRequests++;
    if (result.allowed) {
      this.metrics.allowedRequests++;
    } else {
      this.metrics.throttledRequests++;
    }

    // Update client-specific analytics
    if (!this.metrics.clientMetrics[cleanId]) {
      this.metrics.clientMetrics[cleanId] = {
        totalRequests: 0,
        allowedRequests: 0,
        throttledRequests: 0,
        lastRequestTime: now,
        tier: params.tier,
        routes: {}
      };
    }

    const cm = this.metrics.clientMetrics[cleanId];
    cm.totalRequests++;
    cm.lastRequestTime = now;
    cm.tier = params.tier;

    if (result.allowed) {
      cm.allowedRequests++;
    } else {
      cm.throttledRequests++;
    }

    if (!cm.routes[route]) {
      cm.routes[route] = { total: 0, allowed: 0, throttled: 0 };
    }
    cm.routes[route].total++;
    if (result.allowed) cm.routes[route].allowed++;
    else cm.routes[route].throttled++;

    return {
      allowed: result.allowed,
      remaining: result.remaining,
      capacity: result.capacity,
      resetInMs: result.resetInMs,
      retryAfterSec: result.retryAfterSec,
      clientId: cleanId,
      route,
      tier: params.tier
    };
  }

  /**
   * Enforces fair usage policy for a request.
   * Alias for `consume` with explicit fair usage semantics.
   *
   * @param {string} clientId - Client identifier.
   * @param {string} [route="default"] - Route or feature identifier.
   * @param {object} [options={}] - Additional options `{ cost, now }`.
   * @returns {object} Result object.
   * @public
   */
  enforceFairUsage(clientId, route = "default", options = {}) {
    return this.consume(clientId, { route, ...options });
  }

  /**
   * Calculates usage percentage for a client's bucket (0% = full bucket, 100% = empty bucket).
   *
   * @param {string} clientId - Client identifier.
   * @param {string} [route="default"] - Route name.
   * @param {number} [now=Date.now()] - Timestamp in milliseconds.
   * @returns {number} Usage percentage (0.0 to 100.0).
   * @public
   */
  getUsagePercentage(clientId, route = "default", now = Date.now()) {
    const bucket = this.getBucket(clientId, route, now);
    const currentTokens = bucket.getTokens(now);
    const used = Math.max(0, bucket.capacity - currentTokens);
    return Math.min(100, (used / bucket.capacity) * 100);
  }

  /**
   * Retrieves analytics and metric statistics.
   *
   * @param {string} [clientId=null] - Optional client ID to filter metrics.
   * @returns {object} Analytics statistics summary object.
   * @public
   */
  getAnalytics(clientId = null) {
    if (clientId) {
      const cleanId = String(clientId).trim();
      const cm = this.metrics.clientMetrics[cleanId] || {
        totalRequests: 0,
        allowedRequests: 0,
        throttledRequests: 0,
        lastRequestTime: null,
        tier: this.resolveClientParams(cleanId).tier,
        routes: {}
      };
      const usagePct = this.getUsagePercentage(cleanId);
      const throttleRatePct = cm.totalRequests > 0
        ? (cm.throttledRequests / cm.totalRequests) * 100
        : 0;

      return {
        clientId: cleanId,
        ...cm,
        throttleRatePercentage: Number(throttleRatePct.toFixed(2)),
        usagePercentage: Number(usagePct.toFixed(2))
      };
    }

    const total = this.metrics.totalRequests;
    const throttled = this.metrics.throttledRequests;
    const throttleRatePct = total > 0 ? (throttled / total) * 100 : 0;
    const activeClients = Object.keys(this.metrics.clientMetrics);

    let peakUsageClient = null;
    let maxRequests = 0;
    for (const [id, cm] of Object.entries(this.metrics.clientMetrics)) {
      if (cm.totalRequests > maxRequests) {
        maxRequests = cm.totalRequests;
        peakUsageClient = id;
      }
    }

    const clientDetails = {};
    for (const [id, cm] of Object.entries(this.metrics.clientMetrics)) {
      const params = this.resolveClientParams(id);
      const bucket = this.getBucket(id);
      clientDetails[id] = {
        totalRequests: cm.totalRequests,
        allowedRequests: cm.allowedRequests,
        throttledRequests: cm.throttledRequests,
        tier: cm.tier,
        currentTokens: bucket.getTokens(),
        capacity: bucket.capacity,
        usagePercentage: Number(this.getUsagePercentage(id).toFixed(2))
      };
    }

    return {
      totalRequests: total,
      allowedRequests: this.metrics.allowedRequests,
      throttledRequests: throttled,
      throttleRatePercentage: Number(throttleRatePct.toFixed(2)),
      activeClientsCount: activeClients.length,
      peakUsageClient,
      clientDetails
    };
  }

  /**
   * Resets all analytics and metrics counters.
   *
   * @public
   */
  resetAnalytics() {
    this.metrics = {
      totalRequests: 0,
      allowedRequests: 0,
      throttledRequests: 0,
      clientMetrics: {}
    };
  }

  /**
   * Resets the token bucket for a specific client and route.
   *
   * @param {string} clientId - Client identifier.
   * @param {string} [route="default"] - Route name.
   * @public
   */
  resetClientBucket(clientId, route = "default") {
    const cleanId = clientId ? String(clientId).trim() : "default";
    const cleanRoute = route ? String(route).trim() : "default";
    const bucketKey = `${cleanId}:${cleanRoute}`;
    if (this.buckets.has(bucketKey)) {
      this.buckets.get(bucketKey).reset();
    }
  }

  /**
   * Clears all token buckets and client limits.
   *
   * @public
   */
  clearAllBuckets() {
    this.buckets.clear();
    this.clientLimits.clear();
    this.clientTiers.clear();
    this.resetAnalytics();
  }
}

/**
 * Creates a default singleton instance of APIRateLimiter.
 *
 * @type {APIRateLimiter}
 * @public
 */
export const defaultRateLimiter = new APIRateLimiter();
