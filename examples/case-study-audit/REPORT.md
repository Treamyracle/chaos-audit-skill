# Chaos Audit Report: `msiemens/tinydb` (`v4.9.0`)

**Run ID:** `tinydb-case-study-001` | **Target:** `msiemens/tinydb` (`MIT`, commit `edff96aeb261`) | **Fault Ledger Coverage:** `80.0%` (`4/5` units terminal; `1` blocked on VM power-loss fault injection)

> **Scope Note:** TinyDB intentionally documents itself as a lightweight single-process file DB with zero dependencies (`100%` sequential test coverage). This local non-destructive audit measures what happens when applications use TinyDB concurrently across threads or hit mid-write disk exhaustion (`ENOSPC`).

## Executive Summary

| Verdict | Critical | High | Medium | Low | Unscored (`null`) | Total |
|---|---:|---:|---:|---:|---:|---:|
| **`confirmed`** | 1 | 2 | 0 | 0 | 0 | **3** |
| **`needs_validation`** | — | — | — | — | 1 | **1** |
| **`rejected`** | — | — | — | — | 1 | **1** |

### Key Takeaways
1. **Critical Lost Updates & File Corruption (`fp-tinydb-concurrent-write-001`)**: `4` concurrent threads calling `db.insert()` x5 violated `100.0%` (`50/50`) of trials, dropping `989` documents, raising `629` exceptions (`620x JSONDecodeError`, `9x ValueError`), and leaving `43/50` DB files unparseable on disk.
2. **High-Impact Upsert TOCTOU Race (`fp-tinydb-upsert-toctou-002`)**: Even with storage I/O wrapped in a lock, `Table.upsert()` (`update()` then `insert()`) still violated `76.0%` (`38/50`) of trials, creating `60` duplicate rows (up to `4x` copies on one natural key) plus `12` duplicate-ID `ValueError` exceptions.
3. **High-Impact Non-Atomic Write Corruption (`fp-tinydb-nonatomic-write-003`)**: In-place `seek(0)->write->truncate` destroyed all `20` previously committed documents in `100.0%` (`50/50`) of trials when simulated `ENOSPC` struck after writing `32` bytes.
4. **Validated Mitigating Guard (`fp-tinydb-remove-iter-005`, Rejected)**: Candidate `RuntimeError` during `Table.remove(cond=...)` was disproved (`0/50` errors) because `tinydb/table.py:683` snapshots `list(table.keys())`.
5. **Blocked Kernel Directory-Sync Check (`fp-tinydb-dir-fsync-004`, Needs Validation)**: `touch()` creates files without fsyncing parent directory descriptors; remains `needs_validation` (`severity: null`).

## Prioritized Remediation Order
1. Serialize `Table` operations (including compound `upsert`) with a per-table `threading.RLock`.
2. Wrap `JSONStorage.read/write/close` in a `threading.RLock` and switch `write()` to sibling temp file + `fsync()` + `os.replace()`.
