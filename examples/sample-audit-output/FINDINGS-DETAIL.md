# Findings Detail

---

## [CRITICAL] `fp-checkout-toctou-001`: TOCTOU double-spend race in `POST /checkout`
- **Fault Unit:** `fu-checkout-wallet-001` | **Class:** `toctou_race`
- **Broken Invariant:** Wallet balance must never become negative and total debited orders must never exceed initial balance under concurrent requests.
- **Root Cause:** `server.js:39-52` reads `store.getBalance(userId)`, checks `currentBalance < amount`, yields at `await delay(40)`, and then overwrites `store.setBalance` without a lock.
- **Disprover Notes:** No mutex or optimistic CAS version check protects `/checkout`.
- **Reproducer Result:** `node --test examples/vulnerable-checkout/reproducers/double-spend.repro.test.cjs` — `3/3` failed; both concurrent `$80` requests returned `200 OK` on a `$100` wallet (`balance = -60`).
- **Minimal Fix:** Use a per-`userId` serialized async mutex (`fixed-server.js`) or an atomic conditional SQL update.

---

## [HIGH] `fp-webhook-duplicate-002`: Non-idempotent `POST /webhooks/payment`
- **Fault Unit:** `fu-webhook-payment-002` | **Class:** `non_idempotent_retry`
- **Broken Invariant:** Duplicate delivery of the same `eventId` must credit the wallet at most once.
- **Root Cause:** `server.js:56-65` and `store.js:56-60` never invoke `store.hasProcessedWebhook(eventId)` or guard in-flight keys.
- **Reproducer Result:** `node --test examples/vulnerable-checkout/reproducers/webhook-duplicate.repro.test.cjs` — `3/3` failed; wallet credited to `100` on two deliveries of `$50`.
- **Minimal Fix:** Check processed + in-flight `eventId` synchronously before awaiting.

---

## [HIGH] `fp-recommendations-timeout-003`: Unbounded `http.get` in `GET /recommendations`
- **Fault Unit:** `fu-recommendations-outbound-003` | **Class:** `missing_timeout`
- **Broken Invariant:** Outbound HTTP requests must complete or fail within bounded latency.
- **Root Cause:** `server.js:68-79` awaits `http.get` with no timeout or `AbortSignal`.
- **Reproducer Result:** `node --test examples/vulnerable-checkout/reproducers/timeout-hang.repro.test.cjs` — `3/3` failed; hung until client `AbortSignal.timeout(300)` aborted.
- **Minimal Fix:** Pass `AbortSignal.timeout(upstreamTimeoutMs)` to `fetch` and degrade gracefully (`504` + empty fallback).

---

## Appendix: Rejected Candidate
- **`fp-refund-duplicate-005` (`POST /refund`)**: Disproved by adversarial verifier — `server.js:88-98` checks `store.inFlightRefunds.has(orderId) || store.hasRefund(orderId)` synchronously before `await delay(30)`. Concurrent test yielded `[200, 409]`.
