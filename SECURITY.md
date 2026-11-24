# Security & Safe Execution Policy

`chaos-audit-skill` is a defensive reliability, concurrency, and failure-mode auditing harness.

## Execution Boundaries
- Always run target builds, reproducer tests, and fault-injection suites inside an isolated scratch sandbox (`<output-dir>/agents/<agent-id>/scratch/`) using local loopback fixtures and dummy data only.
- Never execute chaos probes or concurrent load tests against live production endpoints, external third-party APIs, billing gateways, or shared staging databases.
- When safe local execution is unavailable, keep the candidate verdict as `needs_validation` with `severity: null` and a precise `safe_verification_recipe`.

## Reporting Vulnerabilities in This Repository
If you discover a validator bypass, path-traversal bug, or diagnostic-injection issue in `validate-fault-ledger.cjs` or `validate-findings.cjs`, please open a GitHub Security Advisory on `Treamyracle/chaos-audit-skill` rather than filing a public issue with exploit details first.
