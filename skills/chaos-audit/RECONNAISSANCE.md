# Phase 1: Reliability Reconnaissance

Phase 1 maps the target's stateful architecture, concurrency primitives, async boundaries, and failure-handling controls before any chaos hunting begins. Reconnaissance is strictly **read-only**: do not execute tests or modify files during Phase 1.

---

## 1. Launch 4 Parallel `research` Agents

Invoke all four `research` agents in parallel so reconnaissance completes in one round without polluting parent context.

### Agent 1a: Stack, Test Runners, and Local Sandboxability
```text
Read the target repository at <target>. Do not execute code or make network calls. Return strictly source-grounded facts with repository-relative file:line references:
1. Languages, frameworks, runtime versions, and dependency managers.
2. Exact local test commands (e.g., node --test, vitest, pytest, go test, cargo test) and whether unit/integration tests can run offline using in-memory or local loopback stubs.
3. Entry points (HTTP servers, RPC handlers, CLI commands, worker processes, cron schedulers, browser apps).
4. Any missing external binaries (e.g., Postgres, Redis, Kafka) that constrain full local execution.
```

### Agent 1b: State Stores, Transactions, Locks, and Business Invariants
```text
Read all database schemas, migrations, ORM models, file/cache stores, and business-logic mutation handlers in <target>. Map with file:line references:
1. Every persistent or shared state store (SQL/NoSQL tables, Redis keys, in-memory Maps/Sets, local JSON/SQLite files, object storage).
2. Critical invariants that must never break (e.g., wallet balance >= 0, coupon redeemed <= limit, inventory >= 0, unique order per idempotency key, monotonic state machine transitions).
3. Every read-modify-write sequence, transaction boundary, isolation level, SELECT FOR UPDATE / optimistic version check, mutex, or unique constraint.
4. Multi-store writes (e.g., DB commit + Redis cache update + external HTTP call or queue publish).
```

### Agent 1c: Async Boundaries, Webhooks, Queues, Retries, and Cron Jobs
```text
Inventory every asynchronous, retried, or event-driven path in <target> with file:line references:
1. Inbound webhooks and event consumers (payment, auth, third-party SaaS callbacks) and whether deduplication/idempotency keys exist before side effects.
2. Background job producers/consumers, dead-letter queues, visibility timeouts, and retry backoff policies.
3. Scheduled cron jobs, leader election, or singleton locks preventing overlapping cron ticks.
4. Frontend/client async flows: optimistic updates, double-submit handlers, AbortController usage on stale fetches, and WebSocket reconnection listeners.
```

### Agent 1d: Timeouts, Pools, LLM Agent Loops, and Shutdown Lifecycle
```text
Inspect all outbound I/O, resource pools, LLM/agent tool loops, and lifecycle hooks in <target> with file:line references:
1. Outbound HTTP/gRPC/DB/SDK calls — list explicit timeout/AbortSignal settings vs. unbounded calls that can hang forever.
2. Connection pools, worker queues, rate limiters, circuit breakers, and unbounded in-memory caches/arrays.
3. LLM / coding-agent pipelines: tool-call retry safety, streaming partial-JSON parsing, max-iteration bounds, child-process / MCP stdio cleanup, parallel subagent write conflicts.
4. Process shutdown (SIGINT / SIGTERM) handlers, in-flight request draining, and atomic vs. direct filesystem writes.
```

---

## 2. Synthesize `architecture.md` and Select Companion Playbooks

Combine the 4 reconnaissance outputs into `<output-dir>/architecture.md`:
- Summarize the stack, critical invariants, state stores, and local execution boundaries.
- Select **only** the companion playbooks relevant to the codebase (always include `FAILURE-CLASSES.md`):
  - `DATABASE-AND-TRANSACTIONS.md` — SQL/ORM/NoSQL/KV transactions and migrations
  - `QUEUES-WEBHOOKS-AND-WORKERS.md` — webhooks, queues, cron, background workers
  - `HTTP-CACHING-AND-DISTRIBUTED.md` — outbound HTTP retries, caches, distributed locks
  - `STATE-AND-FRONTEND-CONCURRENCY.md` — React/Vue/Svelte/browser async state & UI races
  - `AI-AGENTS-AND-LLM-PIPELINES.md` — LLM streaming, tool retries, MCP/subagent orchestration
  - `FILESYSTEM-IPC-AND-SHUTDOWN.md` — atomic file I/O, lockfiles, `SIGTERM` draining

Record selected and excluded playbooks in `run-metadata.json`.

---

## 3. Initialize Deterministic `fault-ledger.json`

Create `<output-dir>/fault-ledger.json` matching `fault-ledger-schema.json`. Decompose the target into discrete, non-overlapping **fault units** — one unit per `(surface, state_store, subsystem, failure_class)` combination — so hunters cannot skim only the easiest files.

Every unit starts with:
- Unique `fault_unit_id` (e.g., `fu-checkout-wallet-toctou-001`)
- Concrete `invariant` statement (what must never break)
- Explicit `starting_paths` (repository-relative paths)
- `wave: 0`, `status: "planned"`, `agent_id: null`, empty `reviewed_paths`, `reproducer_checks`, `result_fingerprints`, `unresolved`

Immediately run the deterministic gate:
```bash
node <skill-dir>/validate-fault-ledger.cjs --repo-root <target> <output-dir>/fault-ledger.json
```
Do not launch Phase 2 hunters until exit code is `0`.
