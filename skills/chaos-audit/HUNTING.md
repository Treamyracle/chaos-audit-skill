# Phase 2: Coverage-Led Chaos Hunting

Phase 2 assigns every `planned` unit in `fault-ledger.json` to isolated hunter subagents across structured waves, then verifies coverage completeness with a Coverage Critic.

---

## 1. Wave Assignment & Isolation Rules

1. Group `planned` units into small, cohesive slices (1–3 closely related units per hunter) so each hunter reads every relevant line in full.
2. Assign every hunter a unique lowercase `agent_id` (`^[a-z0-9][a-z0-9_-]{0,63}$`, never a Windows reserved name like `con`, `prn`, `aux`, `nul`, `com1`–`lpt9`).
3. Give each hunter:
   - Its exact assigned `fault-ledger.json` unit objects (`fault_unit_id`, `invariant`, `starting_paths`, `selected_playbooks`).
   - The core `FAILURE-CLASSES.md` checklist plus the specific companion playbook rules for those units.
   - A list of **peer-owned unit IDs** it must NOT duplicate.
4. Hunters are read-only during Phase 2 hunting (or run strictly dry static trace verification); **Phase 3 handles live reproducer execution with fresh adversarial eyes**.

---

## 2. Mandatory Hunter Prompt Template

Include this verbatim hunting methodology in every hunter prompt:

```text
## Defensive Chaos & Reliability Hunting Method

Your objective is to discover source-grounded reliability, concurrency, and failure-mode defects
that violate the assigned invariant — and propose concrete reproducer designs. Stay read-only on
target source files. Do not contact external APIs, deployed services, or shared infrastructure.

READ AT DEPTH:
Follow the assigned execution path from entrypoint -> parsing -> validation -> read -> async await /
external I/O -> state write -> derived cache/queue/response -> error/retry/cancellation/shutdown path.
Inspect sibling handlers, batch endpoints, retry loops, and fallback branches that touch the same store.

WORK FROM A CONCRETE BROKEN INVARIANT:
1. State the exact business or system invariant (e.g., "Wallet balance must never go negative under N concurrent debits").
2. Name the exact chaos/concurrency trigger (parallel requests, duplicate webhook redelivery, slow downstream hang, crash mid-write, retry after timeout, out-of-order async return).
3. Cite exact repository-relative `file:line_start-line_end` hops showing why mutual exclusion, idempotency, atomicity, or bounded timeouts fail.
4. Check for upstream/downstream guards (unique indexes, SQL transactions, mutexes, idempotency middleware). If a valid guard holds, record the unit `covered` with zero candidates (or propose `rejected` only if an obvious decoy trap exists).
5. Propose a concrete local deterministic reproducer strategy (`concurrent_test`, `fault_injection`, or `deterministic_trace`) that Phase 3 can execute in scratch.

Return strictly structured JSON:
- `unit_updates`: status (`covered` | `candidate` | `blocked`), `reviewed_paths`, `reproducer_checks`, `unresolved`, and `candidates[]`
- `uncovered_surfaces`: any newly discovered stateful paths outside your assigned units so the Parent can register new ledger units.
```

---

## 3. Updating `fault-ledger.json` & Coverage Critic Pass

After each wave returns:
1. Parent updates `fault-ledger.json` with each unit's `wave`, `status`, `agent_id`, `reviewed_paths`, `reproducer_checks`, `result_fingerprints` (for `candidate` units), `unresolved`, and `attempts[]` history.
2. Any `uncovered_surfaces` returned by hunters are minted as new `planned` units for Wave `N+1`.
3. Run:
   ```bash
   node <skill-dir>/validate-fault-ledger.cjs --repo-root <target> <output-dir>/fault-ledger.json
   ```
4. Once zero `planned` or `in_progress` units remain, launch one **Coverage Critic** (`research` agent) with `architecture.md` and `fault-ledger.json` to audit whether any critical state store, webhook, transaction, or retry loop was skipped or prematurely marked `not_applicable`. Resolve gaps before Phase 3.
