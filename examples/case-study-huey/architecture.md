# Architecture Summary: `coleifer/huey` (`v3.5.4`)

- **Target:** [`coleifer/huey`](https://github.com/coleifer/huey) · **License:** MIT · **Pinned Commit:** `7ea73730b9b6d413effdd67880970eb3e674974c` · **Version:** `v3.5.4`
- **Stack:** Pure Python standard library (`threading`, `sqlite3`, `heapq`, `os`, `struct`, `hashlib`) for core, memory, SQLite, and file-system storage engines.
- **Explicit Concurrency Contract Analyzed (`huey/storage.py`):**
  - `MemoryStorage` (`huey/storage.py:335-440`): Initializes `self._lock = threading.RLock()` (`L343`) and wraps queue mutations (`enqueue`, `dequeue`, `put_if_empty`, `incr`, `delete_counter`), but omits `self._lock` on `put_data`, `peek_data`, `pop_data`, `enqueued_items`, `scheduled_items`, and `result_items`.
  - `SqliteStorage` (`huey/storage.py:791-951`): Extends `BaseSqlStorage` using `self.lock = threading.Lock()` (`L798`) around a `contextlib.contextmanager` transaction helper (`db()` at `L821-837`) issuing `begin exclusive` (`L852`).
  - `FileStorage` (`huey/storage.py:1380-1653`): Explicitly documents at `L1384-1386` that it *"utilizes exclusive locks around all file-system operations. This is done to prevent race-conditions when reading from the file-system"*, and provides `use_thread_lock=True` (`threading.Lock()` at `L1407`).
- **Core Reliability Invariants:**
  1. Concurrent `FileStorage` reads (`peek_data`, `enqueued_items`, `result_items`) must hold `self.lock` so concurrent `pop_data`/`dequeue` unlinks never cause `FileNotFoundError`/`PermissionError`.
  2. Persisted result files should flush/sync data to storage before `os.replace`.
  3. Concurrent `SqliteStorage.dequeue` consumers must dequeue each task at most once without duplicates.
  4. `MemoryStorage.result_items()` must not raise `RuntimeError: dictionary changed size during iteration` under concurrent result mutations.
- **Selected Playbooks:** `FAILURE-CLASSES.md`, `QUEUES-WEBHOOKS-AND-WORKERS.md`, `FILESYSTEM-IPC-AND-SHUTDOWN.md`.
