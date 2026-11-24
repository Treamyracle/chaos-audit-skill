# Real Public MIT Case Study: Auditing `msiemens/tinydb` (`v4.9.0`)

To validate `chaos-audit` outside synthetic fixtures, we ran the full 6-phase audit workflow locally in an isolated scratch clone against **[`msiemens/tinydb`](https://github.com/msiemens/tinydb)** (`7.5k+` stars, **MIT License**, pinned commit [`edff96aeb2616402e9489d46e90a592c05565621`](https://github.com/msiemens/tinydb/commit/edff96aeb2616402e9489d46e90a592c05565621)), a popular pure-Python embedded JSON database that advertises **100% unit test coverage**.

> **Respectful Attribution & Scope Note:** `tinydb` explicitly targets lightweight single-process apps where zero external dependencies matter more than concurrent write arbitration. Running its normal sequential test suite shows zero failures. This case study demonstrates how `chaos-audit` uncovers **concurrency, check-then-insert TOCTOU, and mid-write disk-exhaustion failures** when single-process assumptions break under multi-threaded handlers or `ENOSPC` faults—tested strictly offline with zero live traffic or unsolicited upstream issues.

## Audit Outcome & Artifacts

- **Findings Breakdown:** `3 confirmed` (`1 critical`, `2 high`), `1 needs_validation` (`severity: null`), `1 rejected` (candidate `Table.remove` iterator-invalidation bug disproved with `0/50` `RuntimeError`s).
- **Schema-Validated Audit Bundle:** [`examples/case-study-audit/REPORT.md`](../examples/case-study-audit/REPORT.md) · [`fault-ledger.json`](../examples/case-study-audit/fault-ledger.json) · [`findings.json`](../examples/case-study-audit/findings.json)
- **Live Python Harness & Telemetry:** [`tinydb_chaos_benchmark.py`](../examples/case-study-audit/reproducers/tinydb_chaos_benchmark.py) · [`tinydb-case-study.json`](../examples/benchmark-results/tinydb-case-study.json)

---

## Real Before & After Telemetry (`N = 50` Trials / Scenario)

Measured on untouched `tinydb v4.9.0` (**Before**) vs. surgical locking + atomic write wrappers (**After**) on Python `3.13.0` (`win32`/`AMD64`, total runtime `24,566 ms`):

| Scenario | Failure Class | Before (`tinydb v4.9.0`) | After (Fixed Wrappers) |
|---|---|---:|---:|
| **4-thread `db.insert()` x5** (`20` expected docs/trial) | `lost_update` | **`100.0%` (`50/50`) violated** · `989` lost docs · `629` exceptions (`620x JSONDecodeError`, `9x ValueError`) · `43` corrupt DB files | **`0.0%` (`0/50`)** · `0` lost docs · `0` exceptions · `0` corrupt DB files |
| **4-thread `db.upsert()` TOCTOU** (`3` natural keys/trial, *even with serialized storage*) | `toctou_race` | **`76.0%` (`38/50`) violated** · `60` duplicate rows created (up to `4x` copies/key) · `12` `ValueError` exceptions | **`0.0%` (`0/50`)** · `0` duplicate rows (`1x`/key) · `0` exceptions |
| **Mid-write `ENOSPC` fault** (partial `32`-byte overwrite after `20` committed docs) | `non_atomic_file_write` | **`100.0%` (`50/50`) DB corruption** · `0.0%` (`0/50`) committed data preserved | **`0.0%` (`0/50`) corruption** · **`100.0%` (`50/50`) preserved** · `0` stray `.tmp` files |
| **Disprover check: `Table.remove(cond)`** (`100` of `200` docs removed/trial) | `iterator_invalidation` | `0/50` `RuntimeError`s (`tinydb/table.py:683` snapshots `list(table.keys())`) | Verdict: **`rejected`** |

### Detailed Latency & Anomaly Notes

| Scenario | Before Latency (`p50` / `p95` / `p99`) | After Latency (`p50` / `p95` / `p99`) | Why Latency Shifted |
|---|---:|---:|---|
| **4-thread `insert()`** | `15.18` / `27.81` / `32.64 ms` | `204.86` / `278.36` / `290.03 ms` | Before crashed early (`629` uncaught exceptions) and skipped durable `fsync` writes; After cleanly serialized and persisted all `20` docs/trial via `os.fsync` + `os.replace`. |
| **4-thread `upsert()`** | `167.47` / `199.68` / `226.47 ms` | `67.65` / `95.19` / `125.81 ms` | After was **2.5x faster at `p50`** because table locking prevented duplicate fallback `insert()` writes and `ValueError` collisions. |
| **Mid-write `ENOSPC`** | `0.23` / `0.37` / `0.44 ms` | `1.02` / `1.46` / `1.54 ms` | Sub-millisecond overhead to stage to a sibling `.tmp` file instead of corrupting offset `0` of the live DB. |

---

## Surgical Fix Verified Against All 150 Trials

Without modifying upstream files on disk, wrapping `JSONStorage` and `Table` with two minimal extensions (`~55` lines in [`tinydb_chaos_benchmark.py`](../examples/case-study-audit/reproducers/tinydb_chaos_benchmark.py)) eliminates every confirmed defect:

1. **`ThreadSafeAtomicJSONStorage(JSONStorage)`**: Guards `read`/`write`/`close` with `threading.RLock()` and writes serialized JSON to a sibling temporary file (`flush()` + `os.fsync()`), closes `self._handle` safely for Windows `os.replace()`, swaps the temp file into place atomically, and cleans up `.tmp` files on error.
2. **`ThreadSafeTable(Table)`**: Guards all `Table` read/write methods—crucially spanning the compound `self.update()` -> `self.insert()` window in `Table.upsert()` (`tinydb/table.py:615-623`) with a per-table `threading.RLock()`.

---

## Reproduce Against Untouched `tinydb` Locally

```bash
git clone --quiet https://github.com/msiemens/tinydb.git /tmp/tinydb-audit
git -C /tmp/tinydb-audit checkout --quiet edff96aeb2616402e9489d46e90a592c05565621

# 1. Run all 150 chaos trials + 50 disprover checks (pure Python stdlib, zero pip installs)
python examples/case-study-audit/reproducers/tinydb_chaos_benchmark.py \
  --tinydb-path /tmp/tinydb-audit \
  --trials 50 \
  --assert

# 2. Cross-validate the case-study ledger & findings against real TinyDB source lines
node skills/chaos-audit/validate-fault-ledger.cjs --repo-root /tmp/tinydb-audit examples/case-study-audit/fault-ledger.json
node skills/chaos-audit/validate-findings.cjs \
  --repo-root /tmp/tinydb-audit \
  --artifacts-root examples/case-study-audit \
  --ledger examples/case-study-audit/fault-ledger.json \
  examples/case-study-audit/findings.json
```
