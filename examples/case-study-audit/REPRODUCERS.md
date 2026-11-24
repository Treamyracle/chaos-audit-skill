# Executable Reproducers: `msiemens/tinydb` Case Study

Run the zero-dependency Python reproducer suite locally against an untouched clone of `msiemens/tinydb` at commit `edff96aeb2616402e9489d46e90a592c05565621`:

```bash
git clone --quiet https://github.com/msiemens/tinydb.git /tmp/tinydb-audit
git -C /tmp/tinydb-audit checkout --quiet edff96aeb2616402e9489d46e90a592c05565621
python examples/case-study-audit/reproducers/tinydb_chaos_benchmark.py \
  --tinydb-path /tmp/tinydb-audit \
  --trials 50 \
  --assert
```

| Finding | Scenario | Untouched `tinydb v4.9.0` (Before) | Fixed Wrappers (After) |
|---|---|---|---|
| `fp-tinydb-concurrent-write-001` | 4-thread `insert()` x5 (`N=50`) | `100.0%` (`50/50`) failed; `989` lost docs; `43` corrupt files | `0.0%` (`0/50`); `0` lost docs; `0` exceptions |
| `fp-tinydb-upsert-toctou-002` | 4-thread `upsert()` TOCTOU (`N=50`) | `76.0%` (`38/50`) failed; `60` duplicate rows (max `4x`/key) | `0.0%` (`0/50`); `0` duplicate rows |
| `fp-tinydb-nonatomic-write-003` | Mid-write `ENOSPC` fault (`N=50`) | `100.0%` (`50/50`) DB corruption; `0.0%` preserved | `0.0%` corruption; `100.0%` preserved |
| `fp-tinydb-remove-iter-005` | Disprover check on `Table.remove` | `0/50` `RuntimeError`s (disproved -> `rejected`) | Verified safe |
