# Chaos Audit Report: `examples/vulnerable-checkout`

**Run ID:** `sample-run-001` | **Target:** `examples/vulnerable-checkout` | **Fault Ledger Coverage:** `80.0%` (`4/5` units terminal; `1` blocked on OS fault injection)

## Executive Summary

| Verdict | Critical | High | Medium | Low | Unscored (`null`) | Total |
|---|---:|---:|---:|---:|---:|---:|
| **`confirmed`** | 1 | 2 | 0 | 0 | 0 | **3** |
| **`needs_validation`** | — | — | — | — | 1 | **1** |
| **`rejected`** | — | — | — | — | 1 | **1** |

### Key Takeaways
1. **Critical Wallet Double-Spend (`fp-checkout-toctou-001`)**: `POST /checkout` allows two parallel `$80` checkouts against a `$100` balance, dropping the wallet to `-$60`.
2. **High-Impact Duplicate Webhook Credit (`fp-webhook-duplicate-002`)**: `POST /webhooks/payment` credits wallets twice when receiving duplicate `eventId` deliveries.
3. **High-Impact Upstream Hang (`fp-recommendations-timeout-003`)**: `GET /recommendations` invokes `http.get` without a timeout or `AbortSignal`, hanging indefinitely when the upstream stalls.
4. **Validated Mitigating Guard (`fp-refund-duplicate-005`, Rejected)**: `POST /refund` synchronously checks `store.inFlightRefunds` before yielding; concurrent reproducer testing confirmed `200`/`409` mutual exclusion.
5. **Blocked Crash-Safety Check (`fp-store-nonatomic-crash-004`, Needs Validation)**: `writeState` uses direct `fs.writeFileSync`; requires OS-level syscall fault injection to verify truncation behavior.

## Prioritized Remediation Order
1. Serialize `POST /checkout` per `userId` (see `fixed-server.js`).
2. Enforce synchronous + durable `eventId` deduplication on `POST /webhooks/payment`.
3. Add `AbortSignal.timeout` + degraded fallback on `GET /recommendations`.
4. Switch `store.js` callers from `writeState()` to `writeStateAtomic()`.
