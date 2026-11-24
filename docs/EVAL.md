# Controlled Blind A/B Skill Evaluation (`Without` vs. `With chaos-audit`)

Code-fix benchmarks show what happens when bugs are patched—not what the **skill itself** adds on top of a strong underlying coding model. To isolate the exact value of `chaos-audit`, we ran a controlled **blind A/B evaluation** using two fresh isolated agents running the **identical underlying model** against a brand-new, unseen zero-dependency Node.js service ([`examples/eval-suite/order-worker/`](../examples/eval-suite/order-worker/server.js)).

## Blind Target Architecture (`order-worker`)

- **3 Clean Modules (`0` hint comments):** [`store.js`](../examples/eval-suite/order-worker/store.js), [`server.js`](../examples/eval-suite/order-worker/server.js), [`reconciler.js`](../examples/eval-suite/order-worker/reconciler.js).
- **4 Primary Reliability Bugs + 2 Guarded Safe Paths** ([`ground-truth.json`](../examples/eval-suite/ground-truth.json), authored only *after* both A/B runs completed):
  - **Primary Bugs:** `POST /reserve` TOCTOU oversell (`server.js:47-63`), `POST /webhooks/fulfillment` duplicate delivery (`server.js:66-78`), `GET /shipping-quote` missing HTTP timeout (`server.js:80-91`), and `startReconciler` overlapping `setInterval` ticks (`reconciler.js:3-11`).
  - **Guarded Safe Decoys:** `POST /cancel` synchronous `inFlightCancels` Set guard (`server.js:93-109`) and `GET /carrier-health` `AbortSignal.timeout` + `503` degradation (`server.js:111-125`).
- **Isolation Controls:**
  - **Control Arm A (Without Skill):** Restricted to reading only `examples/eval-suite/order-worker/`; prohibited from reading any skill/example files.
  - **Treatment Arm B (With `chaos-audit`):** Followed [`skills/chaos-audit/SKILL.md`](../skills/chaos-audit/SKILL.md), prohibited from reading `examples/sample-audit-output/`, `examples/vulnerable-checkout/`, or case studies.

---

## Honest Observed A/B Scoreboard ([`skill-eval-ab.json`](../examples/benchmark-results/skill-eval-ab.json))

| Metric | Control (`Without Skill`) | Treatment (`With chaos-audit`) | Observed Delta |
|---|---:|---:|---:|
| **Primary 4-Bug Recall** | `4 / 4` (`100.0%`) | `4 / 4` (`100.0%`) | `+0.0%` *(parity on core obvious bugs)* |
| **Safe Guard False Positives (`POST /cancel`, `/carrier-health`)** | `0 / 2` (`0.0%`) | `0 / 2` (`0.0%`) | `+0.0%` |
| **Total Confirmed Reliability Defects Proven** | **`10`** | **`17`** | **`+7` (`+70.0%` deeper fault discovery)** |
| **Formal `rejected` Guard / Hypothesis Records** | `0` *(informal notes only)* | **`3`** *(+ `3` false sub-claims disproved)* | **`+3` disproved records** |
| **Permanent `node --test` Reproducer Suites (`3x` runs)** | `0` *(2 ad-hoc scripts; 1 hung & killed)* | **`20` suites (`60` clean runs, `0` hangs)** | **`+20` CI-ready reproducer suites** |
| **Fault-Ledger Coverage & Mechanical Validator Gate** | `0%` *(no ledger or line check)* | **`100%` (`16/16` units) · `VALID` (`20/20`)** | **`+100.0%` mechanical verification** |

---

## What the Evaluation Honestly Proves

1. **Both arms catch obvious textbook bugs — we do not pretend otherwise.** On a clean 130-line HTTP handler, a frontier model without a skill already achieves `4/4` recall on primary races/retries and avoids flagging synchronous Set guards.
2. **Where `chaos-audit` wins cleanly is depth, falsification rigor, and CI-ready proof:**
   - **+70% More Verified Bugs (`10` -> `17`):** Coverage-led hunting found real production defects the single-pass review missed completely:
     - Never-settling `dispatchPayout` permanently starving subsequent healthy payouts (`hungCalls=28, healthyCalls=0`).
     - Non-scalar object/array `orderId` bypassing `Set.has`/`===` deduplication in `POST /cancel` (`5x` duplicate cancellations).
     - Unbounded `4 MiB` response & request buffering across `readJsonBody`, `GET /shipping-quote`, and `GET /carrier-health`.
     - Negative / float / `NaN` / string-concatenation corruption in `POST /webhooks/fulfillment`.
     - Post-client-disconnect `InventoryStore` mutations in `POST /reserve` and `POST /cancel`.
     - `ECONNREFUSED` / `ECONNRESET` socket leaks and HTTP `500` leak modes separated with distinct failing assertions.
   - **Live Empirical Falsification:** Phase 3 disproved non-existent crash claims (`IncomingMessage` uncaught crash and `ERR_HTTP_HEADERS_SENT` in Node `v26.13.1`) *before* reporting, plus formally verified all 3 safe guards (`3/3` runs exiting `0`).
   - **100% Schema & Line-Bound Traceability:** Treatment output passed both zero-dep validators (`validate-fault-ledger.cjs` & `validate-findings.cjs --repo-root --ledger`) with Phase 5 QA verifying `0` line/symbol mismatches across `20` findings.
