# Status & Verification Ledger

What works today in `chaos-audit-skill` and the exact checks observed locally and in CI.

## Verified Components

| Component | State | Verified By |
|---|---|---|
| 6-Phase Orchestration (`SKILL.md`, `RECONNAISSANCE.md`, `HUNTING.md`, `VALIDATION-AND-REPORTING.md`) | ✅ Works | Structure, schema references, Blind A/B Eval, and three validated audit bundles |
| 7 Domain Failure-Class Playbooks | ✅ Works | Authored for DB/Tx, Queues/Webhooks, HTTP/Caching, Frontend Concurrency, AI/LLM Pipelines, Filesystem/IPC |
| `validate-fault-ledger.cjs` & `fault-ledger-schema.json` | ✅ Works | `node --test skills/chaos-audit/validate-fault-ledger.test.cjs` (**23/23 tests passing** on Node v26.13.1; supports `--repo-root`, `--json`, `--help`) |
| `validate-findings.cjs` & `report-schema.json` | ✅ Works | `node --test skills/chaos-audit/validate-findings.test.cjs` (**25/25 tests passing** on Node v26.13.1; supports `--repo-root`, `--artifacts-root`, `--ledger`, `--json`, `--help`) |
| Controlled Blind A/B Skill Eval (`docs/EVAL.md`) | ✅ Works | Same underlying model evaluated on unseen [`examples/eval-suite/order-worker/`](../examples/eval-suite/order-worker/server.js): `10` -> `17` confirmed bugs (`+70%`), `0` -> `20` repeatable `node --test` suites (`60` runs), `0%` -> `100%` (`16/16`) ledger coverage & validator gate |
| Concurrent-By-Design MIT Case Study (`coleifer/huey v3.5.4` @ `7ea73730b9b6`) | ✅ Works | Zero-mock, zero-sleep Python harness ([`huey_chaos_benchmark.py`](../examples/case-study-huey/reproducers/huey_chaos_benchmark.py)) verified **`100%` / `100%` / `90%` -> `0.0%`** `FileStorage` TOCTOU crashes (`2,039` -> `0` exceptions) + `2` disproved `rejected` records; validated via `--repo-root` & `--artifacts-root` |
| Single-Process MIT Case Study (`msiemens/tinydb v4.9.0` @ `edff96aeb261`) | ✅ Works | Simulated mid-write `ENOSPC` (`PartialWriteEnospcHandle` fault injection) verified `100%` -> `0%` DB corruption (`100%` data preserved); multi-threaded stress showed `100%` / `76%` -> `0.0%` loss/duplicates |
| Synthetic CI Fixture & 50-Trial Benchmark (`benchmark.cjs`) | ✅ Works | `node examples/vulnerable-checkout/benchmark.cjs --trials 50 --assert` (**`100%` -> `0%`** violation rate across `150` live loopback trials in `~5.1s`, verified on Linux/macOS/Windows × Node `20`/`22`/`24`) |
| Visual Assets & Editorial SVG Suite | ✅ Works | All 9 SVGs (`assets/logo.svg`, `hero-banner.svg`, `architecture-flow.svg`, `reproducer-proof.svg`, `before-after-benchmark.svg`, and 4 self-hosted `docs/assets/badges/*.svg` badges) + `assets/icon.png` checked by `scripts/check-repo.cjs` |
| OS-Level Block/Syscall Crash Injection (`dm-flakey` / kernel power loss) | ⚠️ Requires External Sandbox | Documented honestly as `needs_validation` (`severity: null`) with `safe_verification_recipe` across sample, `tinydb`, and `huey` audits |
| Live Multi-Agent Runs Inside Every Third-Party IDE | ⚠️ Harness-Dependent | Validated live in Antigravity subagent eval; third-party harnesses rely on standard subagent + shell tool support |
