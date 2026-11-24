# Queues, Webhooks & Background Workers Playbook

Load when Phase 1 identifies webhooks, message brokers (SQS, RabbitMQ, Kafka, BullMQ, Redis Streams), background workers, or scheduled cron jobs.

---

## 1. Duplicate Webhook / At-Least-Once Delivery (`duplicate_webhook`)
- **Signature:** Webhook endpoint verifies signature, parses payload, and immediately executes `grantCredits()`, `sendEmail()`, or `fulfillOrder()` without atomically inserting `event_id` into a unique deduplication table *in the same transaction*.
- **Sibling Trap:** Checking `if (await seen(eventId)) return 200` before doing work and marking `seen(eventId)` *after* — two simultaneous retries both pass `seen()` (TOCTOU).

## 2. Out-of-Order Event State Regression (`out_of_order_event`)
- **Signature:** Webhook updates `order.status = event.status` blindly without verifying monotonic state transitions or event timestamps/sequence numbers.
- **What Breaks:** Delayed `payment.pending` webhook arrives after `payment.succeeded` (or `subscription.canceled` arrives before `invoice.paid`) and silently downgrades or reactivates state.

## 3. Visibility Timeout / Lease Expiry Mid-Job (`lease_expiry_overlap`)
- **Signature:** Worker pulls job with 30s visibility timeout, takes 45s to process, broker redelivers job to Worker B, and both Worker A and Worker B commit side effects without fencing tokens or conditional state checks.

## 4. Poison-Pill Infinite Redelivery Loop (`poison_pill_loop`)
- **Signature:** Worker throws on malformed JSON or missing DB record without moving the message to a Dead-Letter Queue (DLQ) after bounded retries (`maxReceiveCount`).
- **What Breaks:** Poison message pins 100% of worker capacity in a tight error-retry loop, starving valid jobs.

## 5. Overlapping Cron Ticks (`cron_overlap`)
- **Signature:** Interval timer / k8s CronJob / serverless cron runs every 1 minute without a distributed singleton lock or `concurrencyPolicy: Forbid`, and the batch takes >60s.
- **What Breaks:** Parallel cron instances process the same due rows twice (duplicate invoices, duplicate notifications).

## 6. Ack-Before-Commit / Unclean Shutdown Drop (`premature_ack`)
- **Signature:** Acknowledging queue message upon receipt rather than after durable commit, or exiting immediately on `SIGTERM` before finishing/nacking in-flight jobs.
