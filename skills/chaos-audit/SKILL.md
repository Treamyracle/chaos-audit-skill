---
name: chaos-audit
description: Six-phase adversarial reliability, concurrency, and chaos engineering audit for codebases, APIs, databases, workers, frontends, and AI agent pipelines. Use for race-condition reviews, idempotency checks, timeout/deadlock hunting, or full codebase chaos audits. Run the complete six-phase workflow only when the user explicitly requests a full chaos/reliability audit, comprehensive failure-mode review, or report artifacts.
---

# Chaos Audit

Find reliability, concurrency, and failure-mode bugs that corrupt state, double-bill users, deadlock workers, or hang production requests — then prove every `confirmed` finding with an executed deterministic reproducer test and the smallest effective fix.

This is a defensive, invariant-first, source-grounded engineering workflow. A suspected bug without an identified broken invariant, complete source trace, and executed reproducer (or explicit safe-verification blocker) is never a confirmed finding.

---

## Operating Modes

Loading this skill defaults to **Guidance mode**. It does not authorize creating an output directory or launching the six-phase pipeline unless explicitly requested.

- **Guidance mode** (default): For targeted questions ("Is this webhook handler idempotent?", "Could these two transactions deadlock?", "How should we bound retries here?"). Read the relevant code and playbooks directly and answer concisely. Do not create persistent audit artifacts unless asked.
- **Full audit mode**: Triggered only when the user explicitly requests a full chaos audit, comprehensive reliability/concurrency review, or report artifacts (e.g., `"chaos audit this codebase"`, `"hunt race conditions across ./src"`, `"run a reliability audit and output to ~/audits/app"`). Execute Phases 1–6 in order and gate every phase on the zero-dependency validators.

If the user's intent could reasonably be either mode, ask one short clarifying question before launching subagents or creating files.

---

## Agent-Neutral Platform Terminology

This skill runs across Claude Code, OpenAI Codex, Cursor, Google Antigravity, OpenCode, and DeepSeek Harness:

- **Parent**: The coordinating agent that owns `run-metadata.json`, `fault-ledger.json`, `findings.json`, validator gates, and final reports.
- **Task tool**: Your platform's subagent invocation mechanism.
- **`research` agent**: Read-only delegated agent for fast source exploration and trace verification (no file writes, no execution).
- **`general` agent**: Delegated agent for deep investigation, reproducer authoring, and bounded local execution inside an isolated scratch path.
- **Never self-verify**: A hunter that proposes a candidate finding MUST NOT act as its Phase 3 adversarial disprover or Phase 5 independent record verifier.

---

## Universal Execution Safety

These rules govern both Guidance mode and Full audit mode:

1. **Source inspection is read-only.** Never modify tracked repository source files during an audit unless the user separately asks you to patch them after reviewing the report.
2. **Never touch live or shared infrastructure.** Never send concurrent load, duplicate webhooks, or fault probes to deployed URLs, third-party APIs, payment gateways, cloud queues, or shared staging databases.
3. **Run reproducers only against local loopback/in-memory/disposable scratch targets** with explicit low wall-clock timeouts (`<= 15s` per reproducer), bounded concurrency, sanitized environment variables, and temporary scratch state inside `<output-dir>/agents/<agent-id>/scratch/`.
4. **If safe local execution is blocked** (e.g., proprietary external dependency, missing database binary, or no sandbox), do NOT improvise against real services and do NOT fabricate a `confirmed` verdict. Record the candidate as `needs_validation` with `severity: null` and write an exact `safe_verification_recipe`.

---

## Output Directory & Write Isolation

In **Full audit mode**, if the user does not specify an output path, default to:

```text
~/chaos-audit-skill/<repo-name>/run-<N>/
```

Inside `<output-dir>`:
- `run-metadata.json` — target path, commit SHA, timestamp, selected playbooks, run budget status.
- `architecture.md` — synthesized state stores, invariants, async boundaries, and dependency map.
- `fault-ledger.json` — canonical unit ledger validated by `validate-fault-ledger.cjs`.
- `findings.json` — verified findings (`confirmed`, `needs_validation`, `rejected`) validated by `validate-findings.cjs`.
- `REPORT.md`, `FINDINGS-DETAIL.md`, `REPRODUCERS.md`, `NEEDS-VALIDATION.md` — final target-neutral reports.
- `agents/<agent-id>/scratch/` — isolated workspace where a specific verifier writes and executes reproducer scripts.

Never write audit artifacts inside a tracked project directory unless the user explicitly chooses a `.gitignore`-d directory.

---

## Six-Phase Overview

1. **Phase 1 — Reliability Reconnaissance ([`RECONNAISSANCE.md`](RECONNAISSANCE.md)):** Run 4 parallel `research` agents to map stacks, state stores, locks, async entrypoints, retries, timeouts, and shutdown hooks. Write `architecture.md` and `fault-ledger.json`, then run:
   ```bash
   node <skill-dir>/validate-fault-ledger.cjs --repo-root <target> <output-dir>/fault-ledger.json
   ```
2. **Phase 2 — Coverage-Led Chaos Hunting ([`HUNTING.md`](HUNTING.md)):** Assign `fault-ledger.json` units to isolated hunter subagents alongside relevant domain playbooks (`FAILURE-CLASSES.md` plus selected companion playbooks). Run a Coverage Critic pass to catch blind spots. Re-validate `fault-ledger.json` after every wave.
3. **Phase 3 — Adversarial Disprover & Reproducer Proof ([`VALIDATION-AND-REPORTING.md`](VALIDATION-AND-REPORTING.md)):** Deduplicate candidate bugs by root cause and send each unique candidate to a **fresh** `general` verifier whose primary job is to *disprove* it. If unrefuted, the verifier writes and executes a deterministic reproducer test in scratch (`concurrent_test`, `fault_injection`, or `deterministic_trace`) and records exact observed failure output.
4. **Phase 4 — Structured Output & Cross-Check ([`VALIDATION-AND-REPORTING.md`](VALIDATION-AND-REPORTING.md)):** Write `findings.json` matching `report-schema.json` and run:
   ```bash
   node <skill-dir>/validate-findings.cjs --repo-root <target> --artifacts-root <output-dir> --ledger <output-dir>/fault-ledger.json <output-dir>/findings.json
   ```
   (Pass `--json` for machine-readable CI/orchestrator output.)
5. **Phase 5 — Independent Record Verification ([`VALIDATION-AND-REPORTING.md`](VALIDATION-AND-REPORTING.md)):** Fresh verifiers confirm every cited `file:line`, symbol name, mitigating guard, and reproducer exit output against actual files. Any material edit triggers another independent check and re-validation with `validate-findings.cjs`.
6. **Phase 6 — Target-Neutral Reporting ([`VALIDATION-AND-REPORTING.md`](VALIDATION-AND-REPORTING.md)):** Derive `REPORT.md`, `FINDINGS-DETAIL.md`, `REPRODUCERS.md`, and `NEEDS-VALIDATION.md` strictly from verified records.

---

## Pre-Reconnaissance Gate & Additive Multi-Run Protocol

Before launching Phase 1 agents, inspect target size and complexity:
- Record `target_commit` and local toolchain availability in `run-metadata.json`.
- If the repository is massive (monorepo > 2,000 source files), ask the user whether to scope to specific packages/services or run on the prioritized critical state paths first; do not silently truncate coverage.

When an earlier `<output-dir>/../run-<N-1>/` exists for the same repository:
- Read prior `fault-ledger.json` and `findings.json` alongside `git diff <prior-commit>..HEAD`.
- Carry forward unchanged `covered` / `rejected` units as `prior_covered_same_source` / `prior_rejected_same_source` only when none of their `reviewed_paths` or upstream dependencies changed.
- Force re-validation on any `prior_confirmed_*` or `prior_needs_validation` unit and any file touched since `prior-commit`.

---

## Audit Anti-Patterns (Strictly Forbidden)

1. **No theoretical hand-waving marked `confirmed`.** If you did not run a deterministic reproducer test (or reproducible execution trace) showing the invariant actually fails, it MUST be `needs_validation` (`severity: null`).
2. **No severity inflation.** Severity requires `blast_radius × trigger_likelihood` based on real corrupted state or outage impact.
3. **No defense-in-depth false positives.** If an upstream DB unique constraint, serializable transaction, or middleware lock guarantees mutual exclusion, do NOT claim a downstream helper is a `confirmed` race bug — mark it `rejected` with the exact guard citation.
4. **No unverified line numbers.** Every `file`, `line_start`, `line_end`, and `symbol` must come from directly reading the file in the current session.
5. **Never skip the `.cjs` validators.** Both `validate-fault-ledger.cjs` and `validate-findings.cjs` are mandatory mechanical gates.
