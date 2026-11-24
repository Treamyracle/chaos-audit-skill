# Phases 3–6: Adversarial Validation, Structured Output, Verification & Reporting

---

## Phase 3: Independent Adversarial Disprover & Reproducer Proof

Consolidate all `candidate` proposals from Phase 2 (plus carried-forward `prior_confirmed_*` / `prior_needs_validation` items) by root cause so duplicates are merged.

Assign **each unique candidate** to a **fresh `general` verifier** that did NOT hunt that unit. Provide it an isolated scratch directory: `<output-dir>/agents/<verifier-id>/scratch/`.

### Adversarial Verifier Mandate
```text
You are an ADVERSARIAL DISPROVER. Your first job is to prove this candidate bug CANNOT happen.
1. Re-read every cited file and line range directly in <target>. Never trust the hunter's summary blindly.
2. Check every layer around the target path for mitigating guards:
   - Database schema: UNIQUE constraints, CHECK constraints, SERIALIZABLE isolation, SELECT FOR UPDATE, optimistic version columns.
   - Code/middleware: mutex/semaphore queues, distributed locks, idempotency-key stores, AbortController timeouts, atomic temp+rename writes.
3. If a real guard prevents the failure in all reachable paths -> verdict = "rejected", citing exact `mitigating_guard_location` (`file`, `line_start`, `line_end`, `symbol`).
4. If NO guard prevents it AND safe local scratch execution is available -> write a self-contained deterministic reproducer test in `<scratch>/` targeting a disposable/loopback copy of the code, run it multiple times, and capture:
   - `command`, `test_file` (copied cleanly if retained in artifacts), `runs_executed`, `runs_failed`, and exact `observed_failure_output`.
   - If `runs_failed >= 1` and the broken invariant is directly demonstrated -> verdict = "confirmed".
   - If your test FAILS to trigger the bug after thorough attempts -> analyze why and either refine the race timing or mark `rejected` / `needs_validation`.
5. If local execution is blocked (missing DB/broker, requires non-mockable external service, or lacks sandbox safety) -> verdict = "needs_validation" with `severity: null`, exact `unresolved_fact`, `why_blocked`, and `safe_verification_recipe`.
```

---

## Phase 4: Structured Output & Deterministic Schema Gate

Parent assembles `<output-dir>/findings.json` strictly conforming to [`report-schema.json`](report-schema.json), updates `fault-ledger.json` status (`candidate` → `covered` if `rejected`, or keeps linked `result_fingerprints`), and runs BOTH validators:

```bash
node <skill-dir>/validate-fault-ledger.cjs --repo-root <target> <output-dir>/fault-ledger.json
node <skill-dir>/validate-findings.cjs --repo-root <target> --artifacts-root <output-dir> --ledger <output-dir>/fault-ledger.json <output-dir>/findings.json
```

Pass `--json` to either script for structured `{ valid, errors, stats }` output. `validate-findings.cjs` mechanically blocks:
- Any `confirmed` finding lacking `runs_failed >= 1`, `observed_failure_output`, or a minimum 2-hop `source_trace`.
- Any `needs_validation` or `rejected` finding with a non-null `severity`.
- Any cited `file` or `line_end` that does not exist in `<target>`.
- Any finding fingerprint missing from `fault-ledger.json`.

---

## Phase 5: Independent Record Verification

Launch a fresh `research` (or `general` when re-running reproducer commands) verifier for final QA over `findings.json`:
1. Confirm every `source_trace` and `mitigating_guard_location` line range actually contains the claimed symbols and control flow.
2. Confirm `confirmed` reproducer outputs match actual test execution results.
3. Confirm severity ratings match `blast_radius × trigger_likelihood` without exaggeration.

If any record is materially modified, send the modified record to another independent verifier and re-run `validate-findings.cjs`.

---

## Phase 6: Target-Neutral Reporting

Generate 4 clean, owner-ready Markdown reports strictly from verified `findings.json` and `fault-ledger.json`:

1. **`REPORT.md`**: Executive reliability summary (counts by verdict and severity, ledger coverage percentage, top systemic failure patterns, prioritized remediation order).
2. **`FINDINGS-DETAIL.md`**: Full technical write-up per `confirmed` finding (`broken_invariant`, `root_cause`, `source_trace`, `disprover_notes`, `minimal_fix`, `regression_test_strategy`) plus concise appendix of `rejected` leads.
3. **`REPRODUCERS.md`**: Self-contained guide with exact commands and standalone regression test snippets so owners can add CI chaos gates immediately.
4. **`NEEDS-VALIDATION.md`**: Unverified leads (`severity: null`), exact `unresolved_fact`, `why_blocked`, and step-by-step `safe_verification_recipe` for the engineering team to test in staging.
