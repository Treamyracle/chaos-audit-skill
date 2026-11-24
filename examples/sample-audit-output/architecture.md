# Architecture Summary: `examples/vulnerable-checkout`

- **Stack:** Node.js (`>=20`), zero external dependencies (`node:http`, `node:fs`, `node:crypto`).
- **Entrypoints:**
  - `POST /checkout` (`server.js:39-53`) — Wallet debit + order creation.
  - `POST /webhooks/payment` (`server.js:56-65`) — Async payment credit webhook.
  - `GET /recommendations` (`server.js:68-79`) — Outbound HTTP proxy to recommendation service.
  - `POST /refund` (`server.js:83-99`) — Order refund endpoint guarded by `inFlightRefunds`.
- **State Store:** `FileCheckoutStore` (`store.js:6-74`) backed by a local JSON file (`wallets`, `orders`, `webhooks`, `refunds`) plus in-memory `inFlightRefunds` set.
- **Core Invariants:**
  1. Wallet balance must never fall below zero under concurrent `POST /checkout` requests.
  2. Duplicate payment webhook deliveries with the same `eventId` must credit at most once.
  3. Outbound recommendation fetches must fail fast within bounded latency when upstream stalls.
  4. State file persistence must survive process termination without partial-write JSON truncation.
  5. At most one refund may execute per `orderId` under concurrent `POST /refund` calls.
- **Selected Playbooks:** `FAILURE-CLASSES.md`, `QUEUES-WEBHOOKS-AND-WORKERS.md`, `HTTP-CACHING-AND-DISTRIBUTED.md`, `FILESYSTEM-IPC-AND-SHUTDOWN.md`.
