# Executable Reproducers

Run all standalone deterministic chaos reproducers (proving both the failure against `server.js` and the pass against `fixed-server.js`):

```bash
node --test examples/vulnerable-checkout/reproducers/double-spend.repro.test.cjs \
            examples/vulnerable-checkout/reproducers/webhook-duplicate.repro.test.cjs \
            examples/vulnerable-checkout/reproducers/timeout-hang.repro.test.cjs
```

| Finding | Reproducer File | Failure Triggered on `server.js` | Fix Verified on `fixed-server.js` |
|---|---|---|---|
| `fp-checkout-toctou-001` | `reproducers/double-spend.repro.test.cjs` | 2x `$80` checkouts return `200`, `balance = -60` | `1x 200`, `1x 409`, `balance = 20` |
| `fp-webhook-duplicate-002` | `reproducers/webhook-duplicate.repro.test.cjs` | Duplicate `evt_stripe_991` credits `$100` | Deduplicated, `balance = 50` |
| `fp-recommendations-timeout-003` | `reproducers/timeout-hang.repro.test.cjs` | Hangs past 300ms watchdog | Fast `504` fallback `< 500ms` |
