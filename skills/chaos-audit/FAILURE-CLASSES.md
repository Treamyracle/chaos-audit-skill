# Core Failure Classes (Universal Reliability Checklist)

Always load this playbook during Phase 2 hunting regardless of language or framework.

---

## 1. TOCTOU / Check-Then-Act Races (`toctou_race`)
- **Pattern:** Handler reads state (`balance`, `stock`, `seats_remaining`, `coupon_uses`), performs an `await` (network call, LLM call, async validation, separate DB query), and then writes the updated value without holding a lock or checking an atomic precondition.
- **What Breaks:** Two concurrent requests both observe the pre-mutation state and both pass the guard, causing double-spend, over-booking, or duplicate redemption.
- **Reproducer Strategy:** Fire `N >= 2` parallel requests via `Promise.all` / `asyncio.gather` / goroutines against the exact same target key; assert final balance/stock remains non-negative and fulfilled count `<= 1`.

## 2. Non-Idempotent Retries & Duplicate Delivery (`non_idempotent_retry`)
- **Pattern:** Side-effecting handlers (`POST /orders`, `POST /webhooks/*`, job workers, RPC mutations) lack an atomic `idempotency_key` / `event_id` uniqueness gate before charging cards, incrementing counters, or dispatching downstream writes.
- **What Breaks:** Network timeouts, client double-clicks, or webhook provider retries apply the mutation twice or more.
- **Reproducer Strategy:** Send identical payload + `event_id` sequentially and concurrently (`Promise.all`); verify side effects occur at most once.

## 3. Lost Updates (`lost_update`)
- **Pattern:** Read whole JSON blob / ORM entity into memory (`user = await db.get(id)`), mutate one field in app memory, and overwrite the whole object (`await db.put(user)`) without Compare-And-Swap (`WHERE version = ?`).
- **What Breaks:** Concurrent updates to unrelated fields silently clobber each other.

## 4. Missing Timeouts & Cancellation (`missing_timeout`)
- **Pattern:** Outbound HTTP (`fetch`, `axios`, `http.get`, `requests`), database queries, or lock waits without an explicit deadline (`AbortSignal.timeout`, context deadline, `statement_timeout`).
- **What Breaks:** One slow upstream endpoint exhausts every server socket, thread, or worker slot, taking down healthy routes.
- **Reproducer Strategy:** Point outbound client URL to a local loopback blackhole server that accepts TCP connections and never replies; assert request fails fast (`< 1s` or configured SLA) rather than hanging indefinitely.

## 5. Unbounded Queues, Loops & Memory Growth (`unbounded_resource`)
- **Pattern:** In-memory `Map`/`Set`/array caches without LRU/TTL eviction, retry `while` loops without `maxAttempts`, or `Promise.all(items.map(...))` over unbounded user/DB lists without concurrency limits.
- **What Breaks:** Traffic spikes or malformed payloads cause OOM crashes, event-loop starvation, or infinite billing loops.

## 6. Silent Error Swallowing & Partial Failure (`silent_partial_failure`)
- **Pattern:** `catch (err) {}` returning `200 OK`, `.catch(() => null)` hiding DB/payment failures, or writing Store A (Postgres) then failing before Store B (Redis/S3/queue) with no compensation or outbox.
- **What Breaks:** Silent data divergence between billing, auth, and user-facing state.

## 7. Resource, Handle & Connection Leaks (`resource_leak`)
- **Pattern:** Database connections, file descriptors, streams, timers, or spawned child processes opened outside `try / finally` (or `using` / context managers) so error paths leak handles until `EMFILE` or pool exhaustion.
