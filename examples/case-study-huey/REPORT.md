# Chaos Audit Report: `coleifer/huey` (`v3.5.4`)

**Run ID:** `huey-case-study-001` | **Target:** `coleifer/huey` (`MIT`, commit `7ea73730b9b6`) | **Fault Ledger Coverage:** `83.3%` (`5/6` units terminal; `1` blocked on VM power-loss fault injection)

> **Methodology:** Zero mocks and zero artificial sleeps. Every confirmed finding was executed directly against untouched [`coleifer/huey`](https://github.com/coleifer/huey) (`v3.5.4`) using multi-threaded `threading.Barrier` synchronization, testing Huey's own explicit `FileStorage` exclusive-lock contract (`huey/storage.py:1384-1386`).

## Executive Summary

| Verdict | Critical | High | Medium | Low | Unscored (`null`) | Total |
|---|---:|---:|---:|---:|---:|---:|
| **`confirmed`** | 0 | 3 | 0 | 0 | 0 | **3** |
| **`needs_validation`** | — | — | — | — | 1 | **1** |
| **`rejected`** | — | — | — | — | 2 | **2** |

### Key Takeaways
1. **Confirmed `FileStorage.peek_data()` TOCTOU (`fp-huey-peek-toctou-001`, High):** Crashed in **`100.0%` (`50/50`)** of trials (`444` exceptions: `438 PermissionError`, `6 FileNotFoundError`) when racing `pop_data()`. Adding `with self.lock:` -> **`0.0%` (`0/50`)**.
2. **Confirmed `FileStorage.enqueued_items()` TOCTOU (`fp-huey-enqueued-toctou-002`, High):** Crashed in **`100.0%` (`50/50`)** of trials (`1,468` exceptions: `990 PermissionError`, `478 FileNotFoundError`) when racing `dequeue()`. Adding `with self.lock:` -> **`0.0%` (`0/50`)**.
3. **Confirmed `FileStorage.result_items()` TOCTOU (`fp-huey-result-items-toctou-003`, High):** Crashed in **`90.0%` (`45/50`)** of trials (`127` exceptions: `86 PermissionError`, `41 FileNotFoundError`) when racing `put_data()`/`pop_data()`. Adding `with self.lock:` -> **`0.0%` (`0/50`)**.
4. **Disproved Safe Paths (`rejected`):** Both `SqliteStorage.dequeue()` (`0/50` duplicate/lost tasks) and `MemoryStorage.result_items()` (`0/50` `RuntimeError`s under CPython 3.13 GIL) were rejected after failing to reproduce failure.
5. **Blocked Power-Loss Check (`needs_validation`):** `FileStorage._put_data()` calls `os.replace(tmp, filename)` without `os.fsync`; left unscored (`severity: null`).
