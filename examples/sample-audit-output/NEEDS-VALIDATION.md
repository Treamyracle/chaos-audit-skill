# Items Requiring Safe Environment Validation (`needs_validation`)

## `fp-store-nonatomic-crash-004` — Non-atomic `fs.writeFileSync` in `store.js:23-25`
- **Severity:** `null` (unverified execution)
- **Broken Invariant:** On-disk JSON state must remain valid and parseable if the process crashes mid-write.
- **Why Blocked:** Standard Node tests cannot inject deterministic mid-syscall kernel truncation on small files without OS-level fault injection.
- **Safe Verification Recipe:**
  1. Clone into an isolated scratch container with `dm-flakey` or `strace -e inject=write:error=EIO` fault injection.
  2. Call `writeState()` under simulated `ENOSPC`/`EIO` mid-buffer.
  3. Confirm `JSON.parse(fs.readFileSync(filePath))` throws, then switch callers to `writeStateAtomic()` (`store.js:30-40`) and re-verify.
