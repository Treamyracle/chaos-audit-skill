# Database & Transactions Playbook

Load when Phase 1 identifies SQL, ORM (Prisma, Drizzle, TypeORM, SQLAlchemy, ActiveRecord, GORM, Diesel/SQLx), NoSQL, or transactional KV state.

---

## 1. Missing Row Locks Under `READ COMMITTED` (`missing_row_lock`)
- **Signature:** `BEGIN` → `SELECT balance FROM wallets WHERE id = $1` → app-level `if (balance < amount) throw` → `UPDATE wallets SET balance = balance - $2`.
- **Why It Fails:** Under default `READ COMMITTED` isolation (Postgres, MySQL InnoDB unless `REPEATABLE READ`/`SERIALIZABLE` or locking reads), concurrent transactions read the same committed snapshot before either commits.
- **Required Fix Pattern:** `UPDATE wallets SET balance = balance - $2 WHERE id = $1 AND balance >= $2 RETURNING balance` (single atomic statement), `SELECT ... FOR UPDATE`, or optimistic CAS `WHERE version = $expected`.

## 2. Write Skew in Multi-Row Invariants (`write_skew`)
- **Signature:** Overlapping rows read inside a transaction where each worker inserts/updates a *different* row (e.g., ensuring at least 1 on-call doctor stays active, or enforcing per-org quota `COUNT(*) < limit` before `INSERT`).
- **Why It Fails:** Row-level locks on updated rows do not block concurrent inserts into a gap unless using `SERIALIZABLE`, predicate/parent-row locking (`SELECT ... FOR UPDATE` on the parent `org`), or DB-enforced exclusion constraints.

## 3. Lock-Ordering Deadlocks (`lock_ordering_deadlock`)
- **Signature:** Transfer/swap transactions locking account `A` then `B` in one request while a concurrent request locks `B` then `A` (e.g., `transfer(alice, bob)` vs. `transfer(bob, alice)`).
- **What to Check:** Verify deterministic canonical lock ordering (e.g., `sort([fromId, toId])`) and bounded deadlock retry loops.

## 4. Split-Brain Multi-Store Writes (`missing_outbox`)
- **Signature:** `await db.tx(...)` followed by `await queue.publish(...)`, `await stripe.charges.create(...)`, or `await redis.set(...)`.
- **Why It Fails:** Process crash or network error after DB commit leaves queue/cache permanently out of sync; conversely, calling Stripe *inside* a DB transaction holds locks across slow HTTP calls and causes phantom charges if the DB rolls back.

## 5. Connection Pool Starvation & Transaction Pinning (`pool_starvation`)
- **Signature:** Holding a DB transaction open across outbound HTTP/LLM API calls, or spawning nested queries on a second pool connection while holding the first connection inside a small pool (`max: 5`–`10`).
- **What Breaks:** Two concurrent requests exhaust the pool and self-deadlock waiting on a connection from the same pool.

## 6. Non-Atomic Schema Migrations & Unindexed Hot Paths (`unsafe_migration`)
- **Signature:** `CREATE INDEX` without `CONCURRENTLY` on hot tables, `ALTER TABLE ADD COLUMN ... DEFAULT` locking tables on older engines, or unindexed foreign keys causing full-table locks during `DELETE`/`UPDATE`.
