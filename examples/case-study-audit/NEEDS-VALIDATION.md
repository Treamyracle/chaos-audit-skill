# Items Requiring Safe Environment Validation (`needs_validation`)

## `fp-tinydb-dir-fsync-004` — Missing parent directory `os.fsync` in `touch()` (`tinydb/storages.py:16-33`)
- **Severity:** `null` (unverified execution)
- **Broken Invariant:** Newly created database files and parent directories must survive sudden OS power loss without losing directory entries.
- **Why Blocked:** Userland Python cannot simulate kernel directory-entry journal loss between `open(..., 'a')` and directory metadata writeback without VM or block-device fault injection.
- **Safe Verification Recipe:**
  1. Run inside an isolated Linux QEMU / `dm-flakey` environment with dirty writeback disabled.
  2. Call `TinyDB("/mnt/flakey/new_dir/db.json", create_dirs=True)` and cut virtual power immediately after `touch()`.
  3. Remount and check whether the directory entry persisted; compare against adding `os.fsync(dir_fd)` after file creation/rename on POSIX.
