# Enterprise API Rate Limiting

CmdBar provides an **Enterprise API Rate Limiting** system for GNOME Shell top-bar interactions, D-Bus service methods, and AI Command Translation requests.

Built on the **Token Bucket** algorithm, it guarantees high fair-usage isolation across multiple clients, supports burst traffic handling, exposes custom tier configurations, and records comprehensive analytics metrics.

---

## Key Features

- **Token Bucket Algorithm**: Smooth refilling tokens over time intervals with strict burst limit boundaries.
- **Fair Usage & Client Isolation**: Isolated bucket tracking per client ID, user IP, API key, or D-Bus caller to prevent noisy-neighbor starvation.
- **Burst Handling**: Allows instant bursts up to capacity while throttling subsequent requests when tokens are depleted.
- **Tiered Service Limits**:
  - `enterprise`: 1000 tokens / min (burst capacity 1000, 50 tokens/sec refill)
  - `pro`: 300 tokens / min (burst capacity 300, 10 tokens/sec refill)
  - `free`: 60 tokens / min (burst capacity 60, 1 token/sec refill)
- **Custom Rule Registration**: Dynamic creation and removal of custom rate limit rules per client or route endpoint.
- **Standard Header Metadata**: Exposes standard API metadata (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`).
- **Analytics & Metrics**: Real-time request counts, allowed/throttled ratios, token consumption metrics, and per-client/per-endpoint stats.
- **Middleware Wrappers**: Clean integration wrappers for D-Bus methods and AI Command Translation requests in both JavaScript (GJS / Node) and Python companion modules.

---

## JavaScript Usage (`extension/rateLimiter.js`)

```javascript
import { ApiRateLimiter, TokenBucket } from "./rateLimiter.js";

// Initialize rate limiter
const limiter = new ApiRateLimiter({
  tiers: {
    enterprise: { capacity: 1000, refillRate: 50, refillIntervalMs: 1000 },
  },
  enableAnalytics: true,
});

// Register custom rule
limiter.setCustomLimit("heavy-action", { capacity: 10, refillRate: 1, refillIntervalMs: 1000 });

// Check rate limit
const result = limiter.checkRateLimit("client-123", {
  endpoint: "heavy-action",
  tokensToConsume: 1,
});

if (!result.allowed) {
  console.warn(`Rate limit exceeded! Retry after ${result.retryAfterMs}ms`);
} else {
  console.log(`Allowed. Remaining tokens: ${result.remaining}`);
}

// Wrap async D-Bus or service call
const wrappedExecute = limiter.wrapDBusMethod("ExecuteCommand", myExecuteHandler);
```

---

## Python Usage (`companion/rate_limiter.py`)

```python
from companion.rate_limiter import ApiRateLimiter, TokenBucket

# Initialize rate limiter
limiter = ApiRateLimiter(
    default_limit={"capacity": 60, "refill_rate": 1.0, "refill_interval_ms": 1000.0},
    enable_analytics=True,
)

# Register custom rate limit
limiter.set_custom_limit("deploy_command", {"capacity": 5, "refill_rate": 0.5, "refill_interval_ms": 1000.0})

# Check rate limit
res = limiter.check_rate_limit("client_456", endpoint="deploy_command")
if not res["allowed"]:
    print(f"Throttled! Retry after {res['retry_after_ms']}ms")
else:
    print(f"Allowed. Remaining: {res['remaining']}")

# Analytics
stats = limiter.get_analytics()
print("Total Requests:", stats["total_requests"])
```

---

## D-Bus & AI Translator Integration

Both `CmdBarDBusService` in JavaScript and Python accept an `ApiRateLimiter` instance to automatically throttle external D-Bus method invocations (`ExecuteCommand`, `AddCommand`, `RemoveCommand`, `GetCommands`).

For AI command translation requests, `wrapAIService` enforces custom rate limits (costing e.g. 5 tokens per translation) to prevent API key exhaustion and manage provider costs effectively.
