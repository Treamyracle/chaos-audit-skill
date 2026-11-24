# HTTP, Caching & Distributed Systems Playbook

Load when Phase 1 identifies outbound HTTP clients, Redis/Memcached caches, rate limiters, or distributed coordination.

---

## 1. Cache Stampede / Thundering Herd (`cache_stampede`)
- **Signature:** Expensive query cached with fixed TTL; on expiry under concurrent traffic, 100 requests simultaneously miss cache and hammer the origin DB (`singleflight` / request coalescing missing).

## 2. Negative / Error Caching & Stale Write-Back (`stale_cache_corruption`)
- **Signature:** Caching transient `null` / `500` responses with full TTL, or write-through paths reading DB → updating DB → writing stale pre-read cache entry concurrently.

## 3. Unbounded Retry Storms & Missing Circuit Breakers (`retry_storm`)
- **Signature:** Immediate fixed retries (`for (let i = 0; i < 5; i++) await callUpstream()`) without **exponential backoff + full jitter**, retrying non-retryable `4xx` responses, or stacking client retries × gateway retries × worker retries (`4 × 4 × 4 = 64x` amplification).
- **What to Check:** Verify retries skip `400`/`401`/`403`/`404`/`422`, honor `Retry-After`, include jitter, and respect total request budget.

## 4. Distributed Lock Without Fencing Tokens (`missing_fencing_token`)
- **Signature:** `SET lock:key token NX PX 5000` followed by `DEL lock:key` in `finally` (not checking token ownership via Lua compare-and-delete!), OR writing to downstream storage without passing a monotonic fencing token.
- **What Breaks:** A GC pause / slow step exceeding 5s causes Worker A to delete Worker B's newly acquired lock or perform stale writes after lease expiry.

## 5. Clock-Skew & Non-Monotonic Timeouts (`clock_skew_bug`)
- **Signature:** Measuring elapsed durations or lock expirations using wall-clock `Date.now()` across distributed nodes (or `time.time()` instead of `performance.now()` / monotonic clocks locally).
