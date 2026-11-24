# Concurrent-By-Design MIT Case Study: Auditing `coleifer/huey` (`v3.5.4`)

Unlike single-process embedded stores, **[`coleifer/huey`](https://github.com/coleifer/huey)** (`6,066+` ★, **MIT License**, pinned commit [`7ea73730b9b6d413effdd67880970eb3e674974c`](https://github.com/coleifer/huey/commit/7ea73730b9b6d413effdd67880970eb3e674974c)) is a concurrent multi-threaded/multi-worker task queue whose `FileStorage` class explicitly states at [`huey/storage.py:1384-1386`](https://github.com/coleifer/huey/blob/7ea73730b9b6d413effdd67880970eb3e674974c/huey/storage.py#L1384-L1386):

> *"utilizes exclusive locks around all file-system operations. This is done to prevent race-conditions when reading from the file-system."*

We ran the full 6-phase `chaos-audit` workflow against an untouched scratch clone with **zero mocks and zero artificial sleeps** (`use_thread_lock=True`, 4 real threads coordinated with `threading.Barrier`), exposing **3 real unlocked-reader TOCTOU crashes** that violate Huey's own documented lock guarantee while cleanly disproving 2 candidate bugs (`SqliteStorage.dequeue` and `MemoryStorage.result_items`).

- **Schema-Validated Audit Bundle:** [`examples/case-study-huey/REPORT.md`](../examples/case-study-huey/REPORT.md) · [`fault-ledger.json`](../examples/case-study-huey/fault-ledger.json) · [`findings.json`](../examples/case-study-huey/findings.json)
- **Live Python Harness & Telemetry:** [`huey_chaos_benchmark.py`](../examples/case-study-huey/reproducers/huey_chaos_benchmark.py) · [`huey-case-study.json`](../examples/benchmark-results/huey-case-study.json)

---

## Real Before & After Telemetry (`N = 50` Trials / Scenario)

Measured directly against untouched `huey v3.5.4` (**Before**) vs. a minimal `15`-line `LockedFileStorage` subclass (**After**) on Python `3.13.0` (`win32`/`AMD64`, `139,421 ms` total):

| Scenario | Failure Class | Before (`huey v3.5.4`) | After (`LockedFileStorage`) |
|---|---|---:|---:|
| **`FileStorage.peek_data()` vs. `pop_data()`** (`huey/storage.py:1576-1600`) | `toctou_race` | **`100.0%` (`50/50`) crashed** · `444` exceptions (`438 PermissionError`, `6 FileNotFoundError`) | **`0.0%` (`0/50`)** · `0` exceptions |
| **`FileStorage.enqueued_items()` vs. `dequeue()`** (`huey/storage.py:1447-1471`) | `toctou_race` | **`100.0%` (`50/50`) crashed** · `1,468` exceptions (`990 PermissionError`, `478 FileNotFoundError`) | **`0.0%` (`0/50`)** · `0` exceptions |
| **`FileStorage.result_items()` vs. `put_data()/pop_data()`** (`huey/storage.py:1631-1647`) | `toctou_race` | **`90.0%` (`45/50`) crashed** · `127` exceptions (`86 PermissionError`, `41 FileNotFoundError`) | **`0.0%` (`0/50`)** · `0` exceptions |
| **Disprover A: `SqliteStorage.dequeue()`** (`huey/storage.py:821-852, 936-950`) | `concurrent_double_delivery` | `0/50` duplicate/lost tasks (guarded by `self.lock` + `begin exclusive`) | Verdict: **`rejected`** |
| **Disprover B: `MemoryStorage.result_items()`** (`huey/storage.py:432-433`) | `iterator_invalidation` | `0/50` `RuntimeError`s on CPython 3.13 (`PyDict_Copy` atomic under GIL) | Verdict: **`rejected`** |

### Observed Latency (`p50` / `p95` / `p99` / `max`)

| Scenario | Before Latency (ms) | After Latency (ms) |
|---|---:|---:|
| **`FileStorage.peek_data()` vs. `pop_data()`** | `637.93` / `680.12` / `713.72` / `713.72` | `675.22` / `844.40` / `863.76` / `863.76` |
| **`FileStorage.enqueued_items()` vs. `dequeue()`** | `295.61` / `368.17` / `394.68` / `394.68` | `509.56` / `605.93` / `655.46` / `655.46` |
| **`FileStorage.result_items()` vs. `put_data()/pop_data()`** | `248.80` / `295.27` / `398.05` / `398.05` | `260.45` / `292.77` / `369.52` / `369.52` |

---

## Minimal Fix Verified (`LockedFileStorage`)

```python
class LockedFileStorage(FileStorage):
    def peek_data(self, key):
        with self.lock:
            return super().peek_data(key)

    def enqueued_items(self, limit=None):
        with self.lock:
            return super().enqueued_items(limit=limit)

    def scheduled_items(self, limit=None):
        with self.lock:
            return super().scheduled_items(limit=limit)

    def result_items(self):
        with self.lock:
            return super().result_items()
```

---

## Reproduce Locally Against Untouched `coleifer/huey`

```bash
git clone --quiet https://github.com/coleifer/huey.git /tmp/huey-audit
git -C /tmp/huey-audit checkout --quiet 7ea73730b9b6d413effdd67880970eb3e674974c

# 1. Execute all 150 FileStorage chaos trials + 100 Disprover trials (zero external Python packages)
python examples/case-study-huey/reproducers/huey_chaos_benchmark.py \
  --huey-path /tmp/huey-audit \
  --trials 50 \
  --assert

# 2. Cross-validate fault-ledger & findings against real Huey source lines
node skills/chaos-audit/validate-fault-ledger.cjs --repo-root /tmp/huey-audit examples/case-study-huey/fault-ledger.json
node skills/chaos-audit/validate-findings.cjs \
  --repo-root /tmp/huey-audit \
  --artifacts-root examples/case-study-huey \
  --ledger examples/case-study-huey/fault-ledger.json \
  examples/case-study-huey/findings.json
```
