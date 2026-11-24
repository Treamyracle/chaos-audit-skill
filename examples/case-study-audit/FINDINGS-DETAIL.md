# Findings Detail: `msiemens/tinydb` (`v4.9.0`)

---

## [CRITICAL] `fp-tinydb-concurrent-write-001`: Unsynchronized `Table._update_table` & shared `JSONStorage._handle`
- **Fault Unit:** `fu-tinydb-concurrent-write-001` | **Class:** `lost_update`
- **Broken Invariant:** Concurrent inserts on a TinyDB instance must preserve all committed documents and never corrupt `JSONStorage._handle`.
- **Root Cause:** `tinydb/table.py:139-177` allocates IDs outside `_update_table()`, while `tinydb/storages.py:125-161` lets threads interleave `seek()` / `json.load()` / `write()` / `truncate()` on a single shared file descriptor.
- **Disprover Notes:** Zero `threading.Lock`, `RLock`, or file locks exist in TinyDB.
- **Reproducer Result (`N=50`):** `50/50` failed (`100.0%`) — `989` lost docs, `629` exceptions (`620x JSONDecodeError`, `9x ValueError`), `43` corrupt DB files. Fixed wrapper (`ThreadSafeTable` + `ThreadSafeAtomicJSONStorage`): `0/50` failures (`0.0%`).

---

## [HIGH] `fp-tinydb-upsert-toctou-002`: Compound TOCTOU race in `Table.upsert()`
- **Fault Unit:** `fu-tinydb-upsert-toctou-002` | **Class:** `toctou_race`
- **Broken Invariant:** Concurrent `Table.upsert()` calls matching the same query key must produce exactly one document.
- **Root Cause:** `tinydb/table.py:615-623` runs `self.update(...)` followed by `self.insert(...)` as two independent storage calls with no table-level mutex.
- **Disprover Notes:** Re-tested on top of serialized `ThreadSafeAtomicJSONStorage`; compound check-then-insert still raced naturally under Windows thread scheduling.
- **Reproducer Result (`N=50`):** `38/50` failed (`76.0%`) — `60` duplicate rows (up to `4x` copies per key) and `12` `ValueError` exceptions. Fixed wrapper (`ThreadSafeTable`): `0/50` failures (`0.0%`).

---

## [HIGH] `fp-tinydb-nonatomic-write-003`: Non-atomic in-place `JSONStorage.write()`
- **Fault Unit:** `fu-tinydb-nonatomic-write-003` | **Class:** `non_atomic_file_write`
- **Broken Invariant:** Previously committed DB records on disk must remain valid if `JSONStorage.write()` hits `ENOSPC`/`EIO`.
- **Root Cause:** `tinydb/storages.py:142-162` seeks `self._handle` to offset `0` and overwrites live bytes in place before truncating.
- **Reproducer Result (`N=50`):** `50/50` corrupted (`100.0%`, `0.0%` preserved). Fixed atomic temp-file + `os.fsync` + `os.replace`: `0/50` corrupted (`100.0%` preserved, `0` stray `.tmp` files).

---

## Appendix: Rejected Candidate
- **`fp-tinydb-remove-iter-005` (`Table.remove`)**: Disproved by adversarial verifier — `tinydb/table.py:683-690` snapshots `list(table.keys())` before calling `table.pop(doc_id)`. `50/50` trials removing `100/200` matching rows exited with `0` `RuntimeError`s.
