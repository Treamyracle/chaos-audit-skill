# Filesystem, Local IPC & Graceful Shutdown Playbook

Load when Phase 1 identifies local JSON/SQLite file persistence, PID/lock files, Unix/named-pipe IPC, subprocess wrappers, or server lifecycle code.

---

## 1. Non-Atomic File Overwrite (`non_atomic_file_write`)
- **Signature:** Direct `fs.writeFileSync(path, JSON.stringify(data))` / `open(path, "w")` overwriting critical state/config in place.
- **What Breaks:** Process crash, OOM kill, or disk-full error mid-write truncates the file to 0 bytes or leaves invalid half-written JSON, permanently corrupting state.
- **Required Fix Pattern:** Write to sibling temp file (`path + "." + pid + "." + rand + ".tmp"`), flush/`fsync`, and atomically `rename(tmp, path)`.

## 2. Check-Then-Create Lockfile Races (`lockfile_race`)
- **Signature:** `if (!fs.existsSync(lockPath)) fs.writeFileSync(lockPath, pid)` instead of exclusive atomic creation (`O_CREAT | O_EXCL` / `flag: "wx"`).

## 3. Missing Graceful `SIGTERM` Drain (`unclean_shutdown`)
- **Signature:** HTTP/worker server lacks `SIGTERM`/`SIGINT` listener, or closes the DB pool immediately before `server.close()` finishes draining in-flight transactions/requests.

## 4. Unbounded Temp / Scratch Accumulation (`temp_disk_exhaustion`)
- **Signature:** Uploads, PDF renders, browser profiles, or scratch build folders created in `os.tmpdir()` without `try / finally` cleanup on error paths.
