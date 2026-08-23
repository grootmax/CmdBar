/**
 * Enterprise API Rate Limiting Module for CmdBar.
 * Implements Token Bucket algorithm, burst handling, fair usage isolation,
 * custom limits, tier management, analytics, and middleware integration wrappers.
 *
 * @module rateLimiter
 */

/**
 * TokenBucket class representing a single rate limiting bucket.
 */
export class TokenBucket {
  /**
   * Constructs a TokenBucket instance.
   * @param {Object} options - Configuration options for the token bucket.
   * @param {number} [options.capacity=60] - Maximum capacity (burst limit) of the bucket.
   * @param {number} [options.refillRate=1] - Number of tokens refilled per interval.
   * @param {number} [options.refillIntervalMs=1000] - Interval in milliseconds for token refill.
   * @param {number} [options.initialTokens] - Initial tokens in bucket (defaults to capacity).
   * @param {Function} [options.timeProvider] - Function returning current timestamp in ms.
   */
  constructor(options = {}) {
    this.capacity = options.capacity !== undefined ? Math.max(1, options.capacity) : 60;
    this.refillRate = options.refillRate !== undefined ? Math.max(0, options.refillRate) : 1;
    this.refillIntervalMs = options.refillIntervalMs !== undefined ? Math.max(1, options.refillIntervalMs) : 1000;
    this.timeProvider = typeof options.timeProvider === "function" ? options.timeProvider : () => Date.now();

    this.tokens = options.initialTokens !== undefined ? Math.min(this.capacity, Math.max(0, options.initialTokens)) : this.capacity;
    this.lastRefillTime = this.timeProvider();
  }

  /**
   * Refills tokens based on elapsed time since last refill.
   */
  refill() {
    const now = this.timeProvider();
    const elapsedMs = Math.max(0, now - this.lastRefillTime);

    if (elapsedMs > 0) {
      const tokensToAdd = (elapsedMs / this.refillIntervalMs) * this.refillRate;
      this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
      this.lastRefillTime = now;
    }
  }

  /**
   * Attempts to consume tokens from the bucket.
   * @param {number} [tokensToConsume=1] - Number of tokens to consume.
   * @returns {Object} Consumption result containing allowed status, remaining tokens, reset time, and retry delay.
   */
  tryConsume(tokensToConsume = 1) {
    this.refill();

    const amount = Math.max(1, tokensToConsume);
    const now = this.timeProvider();

    if (this.tokens >= amount) {
      this.tokens -= amount;

      const missingForFull = this.capacity - this.tokens;
      const resetMs = this.refillRate > 0 ? Math.ceil((missingForFull / this.refillRate) * this.refillIntervalMs) : 0;

      return {
        allowed: true,
        remaining: Math.floor(this.tokens),
        limit: this.capacity,
        resetMs,
        retryAfterMs: 0,
        tokensConsumed: amount,
      };
    } else {
      const missingTokens = amount - this.tokens;
      const retryAfterMs = this.refillRate > 0 ? Math.ceil((missingTokens / this.refillRate) * this.refillIntervalMs) : 0;
      const missingForFull = this.capacity - this.tokens;
      const resetMs = this.refillRate > 0 ? Math.ceil((missingForFull / this.refillRate) * this.refillIntervalMs) : 0;

      return {
        allowed: false,
        remaining: Math.floor(this.tokens),
        limit: this.capacity,
        resetMs,
        retryAfterMs,
        tokensConsumed: 0,
      };
    }
  }

  /**
   * Returns current available token count after refill.
   * @returns {number} Current token count.
   */
  getTokens() {
    this.refill();
    return Math.floor(this.tokens);
  }

  /**
   * Resets the bucket to maximum capacity.
   */
  reset() {
    this.tokens = this.capacity;
    this.lastRefillTime = this.timeProvider();
  }
}

/**
 * Enterprise API Rate Limiter Manager.
 * Manages token buckets per client, tier, and endpoint with custom rules and analytics.
 */
export class ApiRateLimiter {
  /**
   * Constructs an ApiRateLimiter instance.
   * @param {Object} [options={}] - Configuration parameters.
   * @param {Object} [options.defaultLimit] - Default rate limit config ({ capacity, refillRate, refillIntervalMs }).
   * @param {Object} [options.tiers] - Preset tiers configuration map.
   * @param {Object} [options.customLimits] - Pre-configured custom rules map.
   * @param {Function} [options.timeProvider] - Custom time provider function.
   * @param {boolean} [options.enableAnalytics=true] - Whether to track request analytics.
   */
  constructor(options = {}) {
    this.timeProvider = typeof options.timeProvider === "function" ? options.timeProvider : () => Date.now();
    this.enableAnalytics = options.enableAnalytics !== false;

    this.defaultLimit = Object.assign(
      { capacity: 60, refillRate: 1, refillIntervalMs: 1000 },
      options.defaultLimit || {}
    );

    this.tiers = Object.assign(
      {
        enterprise: { capacity: 1000, refillRate: 50, refillIntervalMs: 1000 },
        pro: { capacity: 300, refillRate: 10, refillIntervalMs: 1000 },
        free: { capacity: 60, refillRate: 1, refillIntervalMs: 1000 },
      },
      options.tiers || {}
    );

    this.customLimits = new Map();
    if (options.customLimits) {
      for (const [key, config] of Object.entries(options.customLimits)) {
        this.customLimits.set(key, config);
      }
    }

    this.buckets = new Map();

    this.analytics = {
      totalRequests: 0,
      allowedRequests: 0,
      throttledRequests: 0,
      tokensConsumed: 0,
      clientStats: new Map(),
      endpointStats: new Map(),
      startTime: this.timeProvider(),
    };
  }

  /**
   * Registers or updates a custom rate limit rule for a client or endpoint.
   * @param {string} key - Client ID, route, or endpoint identifier.
   * @param {Object} limitConfig - Rate limit rule ({ capacity, refillRate, refillIntervalMs }).
   */
  setCustomLimit(key, limitConfig) {
    if (!key || typeof key !== "string") return;
    this.customLimits.set(key, limitConfig);
  }

  /**
   * Removes a custom rate limit rule.
   * @param {string} key - Custom rule key to remove.
   * @returns {boolean} True if removed, false otherwise.
   */
  removeCustomLimit(key) {
    return this.customLimits.delete(key);
  }

  /**
   * Resolves the limit configuration for a key or tier.
   * @param {string} [key] - Specific rule key or endpoint.
   * @param {string} [tier] - Service tier name.
   * @returns {Object} Limit configuration object.
   */
  getLimitConfig(key, tier = null) {
    if (key && this.customLimits.has(key)) {
      return this.customLimits.get(key);
    }
    if (tier && this.tiers[tier]) {
      return this.tiers[tier];
    }
    return this.defaultLimit;
  }

  /**
   * Retrieves or creates a TokenBucket for a bucket key.
   * @param {string} bucketKey - Bucket identifier.
   * @param {Object} limitConfig - Rate limit configuration.
   * @returns {TokenBucket} TokenBucket instance.
   */
  getBucket(bucketKey, limitConfig) {
    let bucket = this.buckets.get(bucketKey);
    if (!bucket) {
      bucket = new TokenBucket({
        capacity: limitConfig.capacity,
        refillRate: limitConfig.refillRate,
        refillIntervalMs: limitConfig.refillIntervalMs,
        timeProvider: this.timeProvider,
      });
      this.buckets.set(bucketKey, bucket);
    } else if (
      bucket.capacity !== limitConfig.capacity ||
      bucket.refillRate !== limitConfig.refillRate ||
      bucket.refillIntervalMs !== limitConfig.refillIntervalMs
    ) {
      // Re-configure existing bucket if config changed
      bucket.capacity = limitConfig.capacity;
      bucket.refillRate = limitConfig.refillRate;
      bucket.refillIntervalMs = limitConfig.refillIntervalMs;
    }
    return bucket;
  }

  /**
   * Checks rate limit for a client and endpoint request.
   * @param {string} [clientId='global'] - Unique client or IP identifier.
   * @param {Object} [options={}] - Request parameters.
   * @param {string} [options.endpoint] - Endpoint or action name.
   * @param {number} [options.tokensToConsume=1] - Number of tokens to consume.
   * @param {string} [options.tier='free'] - User or client tier.
   * @returns {Object} Rate limit check result with standard header metadata.
   */
  checkRateLimit(clientId = "global", options = {}) {
    const endpoint = options.endpoint || "default";
    const tier = options.tier || null;
    const tokensToConsume = options.tokensToConsume || options.cost || 1;

    const bucketKey = endpoint !== "default" ? `${clientId}:${endpoint}` : clientId;
    const limitConfig = this.getLimitConfig(endpoint, tier) || this.getLimitConfig(clientId, tier);

    const bucket = this.getBucket(bucketKey, limitConfig);
    const result = bucket.tryConsume(tokensToConsume);

    const headers = {
      "X-RateLimit-Limit": String(result.limit),
      "X-RateLimit-Remaining": String(result.remaining),
      "X-RateLimit-Reset": String(Math.ceil(result.resetMs / 1000)),
    };
    if (!result.allowed) {
      headers["Retry-After"] = String(Math.ceil(result.retryAfterMs / 1000));
    }

    if (this.enableAnalytics) {
      this._recordAnalytics(clientId, endpoint, result, tokensToConsume);
    }

    return {
      allowed: result.allowed,
      limit: result.limit,
      remaining: result.remaining,
      resetMs: result.resetMs,
      retryAfterMs: result.retryAfterMs,
      tokensConsumed: result.tokensConsumed,
      headers,
      client: clientId,
      endpoint,
      bucketKey,
    };
  }

  /**
   * Internal helper to record request analytics metrics.
   * @private
   */
  _recordAnalytics(clientId, endpoint, result, tokensRequested) {
    this.analytics.totalRequests++;
    if (result.allowed) {
      this.analytics.allowedRequests++;
      this.analytics.tokensConsumed += result.tokensConsumed;
    } else {
      this.analytics.throttledRequests++;
    }

    // Per-client metrics
    let cStats = this.analytics.clientStats.get(clientId);
    if (!cStats) {
      cStats = { total: 0, allowed: 0, throttled: 0, tokensConsumed: 0, lastRequest: 0 };
      this.analytics.clientStats.set(clientId, cStats);
    }
    cStats.total++;
    cStats.lastRequest = this.timeProvider();
    if (result.allowed) {
      cStats.allowed++;
      cStats.tokensConsumed += result.tokensConsumed;
    } else {
      cStats.throttled++;
    }

    // Per-endpoint metrics
    let eStats = this.analytics.endpointStats.get(endpoint);
    if (!eStats) {
      eStats = { total: 0, allowed: 0, throttled: 0, tokensConsumed: 0, lastRequest: 0 };
      this.analytics.endpointStats.set(endpoint, eStats);
    }
    eStats.total++;
    eStats.lastRequest = this.timeProvider();
    if (result.allowed) {
      eStats.allowed++;
      eStats.tokensConsumed += result.tokensConsumed;
    } else {
      eStats.throttled++;
    }
  }

  /**
   * Inspects current quota status without consuming tokens.
   * @param {string} [clientId='global'] - Client identifier.
   * @param {string} [endpoint] - Endpoint identifier.
   * @param {string} [tier='free'] - Service tier name.
   * @returns {Object} Quota status overview.
   */
  getQuotaStatus(clientId = "global", endpoint = null, tier = "free") {
    const epKey = endpoint || "default";
    const bucketKey = epKey !== "default" ? `${clientId}:${epKey}` : clientId;
    const limitConfig = this.getLimitConfig(epKey, tier) || this.getLimitConfig(clientId, tier);

    const bucket = this.getBucket(bucketKey, limitConfig);
    const tokens = bucket.getTokens();

    const missingForFull = bucket.capacity - tokens;
    const resetMs = bucket.refillRate > 0 ? Math.ceil((missingForFull / bucket.refillRate) * bucket.refillIntervalMs) : 0;

    return {
      client: clientId,
      endpoint: epKey,
      tokens,
      capacity: bucket.capacity,
      refillRate: bucket.refillRate,
      resetMs,
      isThrottled: tokens < 1,
    };
  }

  /**
   * Returns current analytics summary report.
   * @returns {Object} Overall analytics stats including client and endpoint breakdowns.
   */
  getAnalytics() {
    const clients = {};
    for (const [cId, stats] of this.analytics.clientStats.entries()) {
      clients[cId] = { ...stats };
    }

    const endpoints = {};
    for (const [eId, stats] of this.analytics.endpointStats.entries()) {
      endpoints[eId] = { ...stats };
    }

    return {
      totalRequests: this.analytics.totalRequests,
      allowedRequests: this.analytics.allowedRequests,
      throttledRequests: this.analytics.throttledRequests,
      tokensConsumed: this.analytics.tokensConsumed,
      activeBuckets: this.buckets.size,
      uptimeMs: this.timeProvider() - this.analytics.startTime,
      clientStats: clients,
      endpointStats: endpoints,
    };
  }

  /**
   * Returns detailed analytics stats for a specific client.
   * @param {string} clientId - Unique client identifier.
   * @returns {Object|null} Client statistics or null if not found.
   */
  getClientStats(clientId) {
    if (!this.analytics.clientStats.has(clientId)) return null;
    return { ...this.analytics.clientStats.get(clientId) };
  }

  /**
   * Resets all recorded analytics counters.
   */
  resetAnalytics() {
    this.analytics.totalRequests = 0;
    this.analytics.allowedRequests = 0;
    this.analytics.throttledRequests = 0;
    this.analytics.tokensConsumed = 0;
    this.analytics.clientStats.clear();
    this.analytics.endpointStats.clear();
    this.analytics.startTime = this.timeProvider();
  }

  /**
   * Resets all managed token buckets.
   */
  resetBuckets() {
    for (const bucket of this.buckets.values()) {
      bucket.reset();
    }
  }

  /**
   * Middleware wrapper to apply rate limiting to D-Bus methods or handlers.
   * @param {string} methodName - Name of the method being wrapped.
   * @param {Function} handler - Original method handler function.
   * @param {Object} [options={}] - Rate limit parameters (clientId, tier, tokensToConsume).
   * @returns {Function} Wrapped async handler.
   */
  wrapDBusMethod(methodName, handler, options = {}) {
    return async (...args) => {
      const clientId = options.clientId || "dbus-client";
      const checkResult = this.checkRateLimit(clientId, {
        endpoint: methodName,
        tier: options.tier || null,
        tokensToConsume: options.tokensToConsume || 1,
      });

      if (!checkResult.allowed) {
        if (options.rejectWithError) {
          throw new Error(`Rate limit exceeded for method ${methodName}. Retry after ${checkResult.retryAfterMs}ms.`);
        }
        return false;
      }

      return handler.apply(this, args);
    };
  }

  /**
   * Middleware wrapper for AI service calls with rate limiting.
   * @param {Function} translateFn - AI translate function.
   * @param {Object} [options={}] - Rate limit options.
   * @returns {Function} Wrapped async AI function.
   */
  wrapAIService(translateFn, options = {}) {
    return async (...args) => {
      const clientId = options.clientId || "ai-user";
      const checkResult = this.checkRateLimit(clientId, {
        endpoint: "ai-translate",
        tier: options.tier || "pro",
        tokensToConsume: options.tokensToConsume || 5, // AI requests cost 5 tokens
      });

      if (!checkResult.allowed) {
        throw new Error(`AI rate limit exceeded. Retry after ${Math.ceil(checkResult.retryAfterMs / 1000)} seconds.`);
      }

      return translateFn.apply(this, args);
    };
  }
}
