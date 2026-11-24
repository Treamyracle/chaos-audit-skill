# Items Requiring Safe Environment Validation (`needs_validation`)

## `fp-huey-file-fsync-004` — `FileStorage._put_data` calls `os.replace` without `os.fsync` (`huey/storage.py:1552-1558`)
- **Severity:** `null` (unverified execution)
- **Broken Invariant:** Newly written temp result files must have data blocks flushed via `os.fsync` before `os.replace` so a power loss never produces an empty replacement file.
- **Why Blocked:** Userland Python cannot simulate storage writeback reordering between `close()` and `os.replace()` without kernel block-layer fault injection.
- **Safe Verification Recipe:**
  1. Boot an isolated QEMU/dm-flakey Linux VM with delayed allocation (`ext4`/`xfs`).
  2. Call `FileStorage.put_data()`, cut virtual power immediately after `os.replace()`, remount, and verify payload bytes exist.
