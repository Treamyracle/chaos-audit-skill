# Contributing to `chaos-audit-skill`

Contributions that improve failure-class coverage, validator accuracy, cross-agent compatibility, or reproducer clarity are welcome.

## Design Principles
1. **Zero external runtime dependencies** in `skills/chaos-audit/*.cjs` and `examples/vulnerable-checkout/`.
2. **Proof over vibes**: New failure-class playbooks must include concrete invariant breakdowns, minimal fix shapes, and deterministic reproducer patterns.
3. **Adversarial verification**: Never add checks or schemas that allow `confirmed` verdicts without an executed failing reproducer and complete `source_trace`.
4. **Honest documentation**: Update `docs/STATUS.md` only with commands and test counts you directly ran and observed.

## Local Checks
Run all automated tests and validators with Node.js (>= 20):

```bash
node --test skills/chaos-audit/validate-fault-ledger.test.cjs skills/chaos-audit/validate-findings.test.cjs
node --test examples/vulnerable-checkout/reproducers/double-spend.repro.test.cjs examples/vulnerable-checkout/reproducers/webhook-duplicate.repro.test.cjs examples/vulnerable-checkout/reproducers/timeout-hang.repro.test.cjs
node skills/chaos-audit/validate-fault-ledger.cjs --repo-root examples/vulnerable-checkout examples/sample-audit-output/fault-ledger.json
node skills/chaos-audit/validate-findings.cjs --repo-root examples/vulnerable-checkout --ledger examples/sample-audit-output/fault-ledger.json examples/sample-audit-output/findings.json
node scripts/check-repo.cjs
```
