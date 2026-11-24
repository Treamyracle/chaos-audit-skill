# Architecture Summary: `msiemens/tinydb` (`v4.9.0`)

- **Target:** [`msiemens/tinydb`](https://github.com/msiemens/tinydb) · **License:** MIT · **Pinned Commit:** `edff96aeb2616402e9489d46e90a592c05565621` · **Version:** `v4.9.0`
- **Stack:** Pure Python standard library (`json`, `os`, `io`, `warnings`, `collections.abc`) — zero runtime dependencies.
- **Entrypoints & Write Paths:**
  - `TinyDB.__init__` (`tinydb/database.py:87-98`) — Instantiates shared `Storage` instance (`JSONStorage` by default).
  - `Table.insert` / `insert_multiple` / `update` / `upsert` / `remove` / `truncate` (`tinydb/table.py:139-708`) — Read-modify-write table operations converging on `Table._update_table` (`tinydb/table.py:804-854`).
  - `Table.upsert` (`tinydb/table.py:591-623`) — Compound `self.update(...)` -> fallback `self.insert(...)` check-then-insert sequence.
- **State Store:** `JSONStorage` (`tinydb/storages.py:79-162`) keeps one open un-locked `self._handle` (`open(path, mode='r+')`) and rewrites the entire DB via `seek(0)` -> `write(serialized)` -> `flush()` -> `os.fsync()` -> `truncate()`.
- **Core Reliability Invariants:**
  1. Concurrent `insert()` calls on a shared `TinyDB` instance must neither lose committed documents nor corrupt `self._handle` cursor/JSON structure.
  2. Concurrent `upsert()` calls targeting the same natural key must yield at most one document per key (no check-then-insert duplicate rows).
  3. A failed mid-write disk error (`ENOSPC` / `EIO`) during `JSONStorage.write()` must leave previously committed data parseable and intact.
  4. Parent directory metadata must survive filesystem crash after file creation/rename.
  5. `Table.remove(cond=...)` deleting matching documents while iterating table keys must not raise `RuntimeError: dictionary changed size during iteration`.
- **Selected Playbooks:** `FAILURE-CLASSES.md`, `FILESYSTEM-IPC-AND-SHUTDOWN.md`.
