# Executable Reproducers: `coleifer/huey` Case Study

Run the zero-dependency, zero-mock, zero-sleep Python reproducer suite against an untouched clone of `coleifer/huey` at commit `7ea73730b9b6d413effdd67880970eb3e674974c`:

```bash
git clone --quiet https://github.com/coleifer/huey.git /tmp/huey-audit
git -C /tmp/huey-audit checkout --quiet 7ea73730b9b6d413effdd67880970eb3e674974c
python examples/case-study-huey/reproducers/huey_chaos_benchmark.py \
  --huey-path /tmp/huey-audit \
  --trials 50 \
  --assert
```

| Finding | Scenario | Untouched `huey v3.5.4` (Before) | `LockedFileStorage` (After) |
|---|---|---|---|
| `fp-huey-peek-toctou-001` | `FileStorage.peek_data()` vs. `pop_data()` (`N=50`) | `100.0%` (`50/50`) crashed · `444` exceptions | `0.0%` (`0/50`) · `0` exceptions |
| `fp-huey-enqueued-toctou-002` | `FileStorage.enqueued_items()` vs. `dequeue()` (`N=50`) | `100.0%` (`50/50`) crashed · `1,468` exceptions | `0.0%` (`0/50`) · `0` exceptions |
| `fp-huey-result-items-toctou-003` | `FileStorage.result_items()` vs. `pop_data()` (`N=50`) | `90.0%` (`45/50`) crashed · `127` exceptions | `0.0%` (`0/50`) · `0` exceptions |
| `fp-huey-sqlite-dequeue-005` | Disprover: `SqliteStorage.dequeue()` (`N=50`) | `0/50` duplicate trials (disproved -> `rejected`) | Verified safe |
| `fp-huey-memory-iter-006` | Disprover: `MemoryStorage.result_items()` (`N=50`) | `0/50` `RuntimeError`s on CPython 3.13 GIL -> `rejected` | Verified safe on CPython |
