# Findings Detail: `coleifer/huey` (`v3.5.4`)

---

## [HIGH] `fp-huey-peek-toctou-001`: Unlocked `FileStorage.peek_data()` TOCTOU
- **Fault Unit:** `fu-huey-peek-toctou-001` | **Class:** `toctou_race`
- **Root Cause:** `huey/storage.py:1576-1585` checks `os.path.exists(filename)` and opens it without `self.lock`, violating `FileStorage`'s docstring (`huey/storage.py:1384-1386`) and racing `pop_data()` (`1587-1600`).
- **Before (`N=50`):** `50/50` (`100.0%`) trials crashed · `444` exceptions (`438x PermissionError`, `6x FileNotFoundError`).
- **After (`LockedFileStorage`):** `0/50` (`0.0%`) crashed · `0` exceptions.

---

## [HIGH] `fp-huey-enqueued-toctou-002`: Unlocked `FileStorage.enqueued_items()` TOCTOU
- **Fault Unit:** `fu-huey-enqueued-toctou-002` | **Class:** `toctou_race`
- **Root Cause:** `huey/storage.py:1465-1471` reads filenames returned by `_get_sorted_filenames` without `self.lock` while `dequeue()` (`1447-1460`) renames and unlinks them under `self.lock`.
- **Before (`N=50`):** `50/50` (`100.0%`) trials crashed · `1,468` exceptions (`990x PermissionError`, `478x FileNotFoundError`).
- **After (`LockedFileStorage`):** `0/50` (`0.0%`) crashed · `0` exceptions.

---

## [HIGH] `fp-huey-result-items-toctou-003`: Unlocked `FileStorage.result_items()` TOCTOU
- **Fault Unit:** `fu-huey-result-items-toctou-003` | **Class:** `toctou_race`
- **Root Cause:** `huey/storage.py:1631-1647` iterates `os.walk(self.result_path)` and opens files without `self.lock` while `put_data()`/`pop_data()` mutate/unlink files under `self.lock`.
- **Before (`N=50`):** `45/50` (`90.0%`) trials crashed · `127` exceptions (`86x PermissionError`, `41x FileNotFoundError`).
- **After (`LockedFileStorage`):** `0/50` (`0.0%`) crashed · `0` exceptions.

---

## Appendix: Rejected Candidates (Adversarial Disprover Verified)
- **`fp-huey-sqlite-dequeue-005` (`SqliteStorage.dequeue`)**: Protected by `BaseSqlStorage.db` `self.lock` + `begin exclusive` (`huey/storage.py:821-852`); `0/50` duplicate/lost tasks.
- **`fp-huey-memory-iter-006` (`MemoryStorage.result_items`)**: Unsynchronized `dict(self._results)` (`huey/storage.py:432-433`), but CPython 3.13 executes `PyDict_Copy` under the GIL without yielding; `0/50` `RuntimeError`s -> `rejected`.
