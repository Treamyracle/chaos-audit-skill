#!/usr/bin/env node
"use strict";

/**
 * Zero-dependency Before vs. After chaos benchmark for examples/vulnerable-checkout.
 * Runs N real concurrent trials over loopback 127.0.0.1 comparing server.js (Before)
 * against fixed-server.js (After) across double-spend, duplicate-webhook, and upstream-hang.
 *
 * Usage:
 *   node examples/vulnerable-checkout/benchmark.cjs [--trials <N>] [--out <file>] [--json] [--assert] [--help]
 */

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const { FileCheckoutStore } = require("./store.js");
const { createVulnerableServer } = require("./server.js");
const { createFixedServer } = require("./fixed-server.js");

function parseArgs(argv) {
  let trials = 50;
  let outPath = null;
  let jsonOnly = false;
  let assertPass = false;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--json") {
      jsonOnly = true;
    } else if (arg === "--assert") {
      assertPass = true;
    } else if (arg === "--trials") {
      if (i + 1 >= argv.length) throw new Error("--trials requires an integer");
      trials = Number.parseInt(argv[i + 1], 10);
      if (!Number.isInteger(trials) || trials < 1 || trials > 500) {
        throw new Error("--trials must be an integer between 1 and 500");
      }
      i += 1;
    } else if (arg === "--out") {
      if (i + 1 >= argv.length) throw new Error("--out requires a file path");
      outPath = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { trials, outPath, jsonOnly, assertPass, help };
}

function listenEphemeral(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const addr = server.address();
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }
    server.close(() => resolve());
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function computePercentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return round2(sorted[idx]);
}

function summarizeLatencies(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p50: computePercentile(sorted, 50),
    p95: computePercentile(sorted, 95),
    p99: computePercentile(sorted, 99),
    max: sorted.length ? round2(sorted[sorted.length - 1]) : 0,
  };
}

function bumpCount(map, key) {
  const k = String(key);
  map[k] = (map[k] || 0) + 1;
}

async function timedFetch(url, options) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    const ms = performance.now() - t0;
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { ok: true, status: res.status, body, ms };
  } catch (err) {
    return {
      ok: false,
      status: null,
      errorName: err.name || "Error",
      errorMessage: err.message,
      ms: performance.now() - t0,
    };
  }
}

async function runDoubleSpendSide(mode, trials, tmpDir) {
  const statePath = path.join(tmpDir, `double-spend-${mode}.json`);
  const store = new FileCheckoutStore(statePath, {
    wallets: {},
    orders: [],
    webhooks: [],
    refunds: [],
  });
  const server =
    mode === "before"
      ? createVulnerableServer({ store, upstreamRecommendationsUrl: "" })
      : createFixedServer({ store, upstreamRecommendationsUrl: "" });
  const baseUrl = await listenEphemeral(server);

  const latencies = [];
  const statusCounts = {};
  let invariantViolations = 0;
  let unauthorizedSpendUsd = 0;
  let overdraftDebtUsd = 0;
  let minWalletBalanceUsd = 100;

  try {
    const batchSize = 5;
    for (let offset = 0; offset < trials; offset += batchSize) {
      const batchLen = Math.min(batchSize, trials - offset);
      const userIds = [];
      for (let i = 0; i < batchLen; i += 1) {
        const uid = `ds-user-${offset + i}`;
        store.state.wallets[uid] = 100;
        userIds.push(uid);
      }

      const requests = [];
      for (const uid of userIds) {
        for (let k = 0; k < 2; k += 1) {
          requests.push(
            timedFetch(`${baseUrl}/checkout`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ userId: uid, amount: 80 }),
              signal: AbortSignal.timeout(3000),
            })
          );
        }
      }

      const results = await Promise.all(requests);
      for (const r of results) {
        latencies.push(r.ms);
        bumpCount(statusCounts, r.ok ? r.status : r.errorName);
      }

      for (const uid of userIds) {
        const balance = store.getBalance(uid);
        const ordersForUser = store.state.orders.filter((o) => o.userId === uid).length;
        if (balance < minWalletBalanceUsd) minWalletBalanceUsd = balance;
        if (balance < 0 || ordersForUser !== 1 || balance !== 20) {
          invariantViolations += 1;
        }
        unauthorizedSpendUsd += Math.max(0, ordersForUser - 1) * 80;
        overdraftDebtUsd += Math.max(0, -balance);
      }
    }
  } finally {
    await closeServer(server);
  }

  return {
    trials,
    invariant_violations: invariantViolations,
    violation_rate_pct: round2((invariantViolations / trials) * 100),
    unauthorized_spend_usd: unauthorizedSpendUsd,
    overdraft_debt_usd: overdraftDebtUsd,
    min_wallet_balance_usd: minWalletBalanceUsd,
    status_counts: statusCounts,
    latency_ms: summarizeLatencies(latencies),
  };
}

async function runDuplicateWebhookSide(mode, trials, tmpDir) {
  const statePath = path.join(tmpDir, `webhook-${mode}.json`);
  const store = new FileCheckoutStore(statePath, {
    wallets: {},
    orders: [],
    webhooks: [],
    refunds: [],
  });
  const server =
    mode === "before"
      ? createVulnerableServer({ store, upstreamRecommendationsUrl: "" })
      : createFixedServer({ store, upstreamRecommendationsUrl: "" });
  const baseUrl = await listenEphemeral(server);

  const latencies = [];
  const statusCounts = {};
  let invariantViolations = 0;
  let duplicateCreditDriftUsd = 0;
  let maxWalletBalanceUsd = 0;

  try {
    const batchSize = 5;
    for (let offset = 0; offset < trials; offset += batchSize) {
      const batchLen = Math.min(batchSize, trials - offset);
      const pairs = [];
      for (let i = 0; i < batchLen; i += 1) {
        const uid = `wh-user-${offset + i}`;
        const eventId = `evt_bench_${offset + i}`;
        store.state.wallets[uid] = 0;
        pairs.push({ uid, eventId });
      }

      const requests = [];
      for (const { uid, eventId } of pairs) {
        for (let k = 0; k < 2; k += 1) {
          requests.push(
            timedFetch(`${baseUrl}/webhooks/payment`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ eventId, userId: uid, amount: 50 }),
              signal: AbortSignal.timeout(3000),
            })
          );
        }
      }

      const results = await Promise.all(requests);
      for (const r of results) {
        latencies.push(r.ms);
        bumpCount(statusCounts, r.ok ? r.status : r.errorName);
      }

      for (const { uid, eventId } of pairs) {
        const balance = store.getBalance(uid);
        const eventRecords = store.state.webhooks.filter((w) => w.eventId === eventId).length;
        if (balance > maxWalletBalanceUsd) maxWalletBalanceUsd = balance;
        if (balance !== 50 || eventRecords !== 1) {
          invariantViolations += 1;
        }
        duplicateCreditDriftUsd += Math.max(0, balance - 50);
      }
    }
  } finally {
    await closeServer(server);
  }

  return {
    trials,
    invariant_violations: invariantViolations,
    violation_rate_pct: round2((invariantViolations / trials) * 100),
    duplicate_credit_drift_usd: duplicateCreditDriftUsd,
    max_wallet_balance_usd: maxWalletBalanceUsd,
    status_counts: statusCounts,
    latency_ms: summarizeLatencies(latencies),
  };
}

async function runUpstreamHangSide(mode, trials, tmpDir) {
  const openSockets = new Set();
  const blackhole = http.createServer((_req, _res) => {
    // Intentionally hold connection open without sending response headers or body.
  });
  blackhole.on("connection", (socket) => {
    openSockets.add(socket);
    socket.on("end", () => socket.destroy());
    socket.on("close", () => openSockets.delete(socket));
  });
  const blackholeUrl = await listenEphemeral(blackhole);

  const statePath = path.join(tmpDir, `hang-${mode}.json`);
  const store = new FileCheckoutStore(statePath);
  const server =
    mode === "before"
      ? createVulnerableServer({ store, upstreamRecommendationsUrl: `${blackholeUrl}/items` })
      : createFixedServer({
          store,
          upstreamRecommendationsUrl: `${blackholeUrl}/items`,
          upstreamTimeoutMs: 120,
        });
  const baseUrl = await listenEphemeral(server);

  const latencies = [];
  const statusCounts = {};
  let hangCount = 0;
  let gracefulFallbackCount = 0;
  let leakedUpstreamSockets = 0;

  try {
    const clientTimeoutMs = mode === "before" ? 300 : 1000;
    const batchSize = 10;
    for (let offset = 0; offset < trials; offset += batchSize) {
      const batchLen = Math.min(batchSize, trials - offset);
      const batchReqs = [];
      for (let i = 0; i < batchLen; i += 1) {
        batchReqs.push(
          timedFetch(`${baseUrl}/recommendations`, {
            signal: AbortSignal.timeout(clientTimeoutMs),
          })
        );
      }

      const results = await Promise.all(batchReqs);
      // Allow loopback close frames to propagate before sampling leaked sockets.
      await delay(50);

      for (const r of results) {
        latencies.push(r.ms);
        bumpCount(statusCounts, r.ok ? r.status : r.errorName);
        if (!r.ok) {
          hangCount += 1;
        } else if (
          r.status === 504 &&
          r.body &&
          r.body.ok === false &&
          Array.isArray(r.body.fallback_items)
        ) {
          gracefulFallbackCount += 1;
        } else {
          hangCount += 1;
        }
      }

      leakedUpstreamSockets += openSockets.size;
      for (const sock of openSockets) {
        sock.destroy();
      }
      openSockets.clear();
    }
  } finally {
    for (const sock of openSockets) {
      sock.destroy();
    }
    openSockets.clear();
    await Promise.all([closeServer(server), closeServer(blackhole)]);
  }

  return {
    trials,
    hang_count: hangCount,
    hang_rate_pct: round2((hangCount / trials) * 100),
    graceful_fallback_count: gracefulFallbackCount,
    graceful_fallback_rate_pct: round2((gracefulFallbackCount / trials) * 100),
    leaked_upstream_sockets: leakedUpstreamSockets,
    status_counts: statusCounts,
    latency_ms: summarizeLatencies(latencies),
  };
}

function evaluateAssertions(report) {
  const failures = [];
  const { double_spend, duplicate_webhook, upstream_hang } = report.scenarios;

  if (double_spend.before.violation_rate_pct < 95) {
    failures.push(`double_spend.before violation_rate_pct expected >= 95%, got ${double_spend.before.violation_rate_pct}%`);
  }
  if (double_spend.after.violation_rate_pct !== 0 || double_spend.after.unauthorized_spend_usd !== 0) {
    failures.push(`double_spend.after expected 0% violations & $0 drift`);
  }

  if (duplicate_webhook.before.violation_rate_pct < 95) {
    failures.push(`duplicate_webhook.before violation_rate_pct expected >= 95%, got ${duplicate_webhook.before.violation_rate_pct}%`);
  }
  if (duplicate_webhook.after.violation_rate_pct !== 0 || duplicate_webhook.after.duplicate_credit_drift_usd !== 0) {
    failures.push(`duplicate_webhook.after expected 0% violations & $0 drift`);
  }

  if (upstream_hang.before.hang_rate_pct < 95) {
    failures.push(`upstream_hang.before hang_rate_pct expected >= 95%, got ${upstream_hang.before.hang_rate_pct}%`);
  }
  if (
    upstream_hang.after.hang_rate_pct !== 0 ||
    upstream_hang.after.graceful_fallback_rate_pct !== 100 ||
    upstream_hang.after.leaked_upstream_sockets !== 0
  ) {
    failures.push(
      `upstream_hang.after expected 0% hang, 100% fallback, 0 leaked sockets; got hang=${upstream_hang.after.hang_rate_pct}%, fallback=${upstream_hang.after.graceful_fallback_rate_pct}%, leaked=${upstream_hang.after.leaked_upstream_sockets}`
    );
  }

  return failures;
}

function formatSummaryTable(report) {
  const ds = report.scenarios.double_spend;
  const dw = report.scenarios.duplicate_webhook;
  const uh = report.scenarios.upstream_hang;
  return [
    `Chaos Benchmark (examples/vulnerable-checkout, N=${report.trials_per_scenario} trials/scenario, Node ${report.environment.node_version}, ${report.environment.platform}/${report.environment.arch})`,
    `1. POST /checkout (double-spend):`,
    `   Before: ${ds.before.violation_rate_pct}% invariant violation (${ds.before.invariant_violations}/${ds.before.trials}), -$${ds.before.unauthorized_spend_usd} unauthorized spend (min balance $${ds.before.min_wallet_balance_usd}), p95=${ds.before.latency_ms.p95}ms`,
    `   After:  ${ds.after.violation_rate_pct}% invariant violation (${ds.after.invariant_violations}/${ds.after.trials}), $0 spend drift (min balance $${ds.after.min_wallet_balance_usd}), p95=${ds.after.latency_ms.p95}ms`,
    `2. POST /webhooks/payment (duplicate retry):`,
    `   Before: ${dw.before.violation_rate_pct}% invariant violation (${dw.before.invariant_violations}/${dw.before.trials}), +$${dw.before.duplicate_credit_drift_usd} duplicate credit drift, p95=${dw.before.latency_ms.p95}ms`,
    `   After:  ${dw.after.violation_rate_pct}% invariant violation (${dw.after.invariant_violations}/${dw.after.trials}), $0 credit drift, p95=${dw.after.latency_ms.p95}ms`,
    `3. GET /recommendations (upstream blackhole):`,
    `   Before: ${uh.before.hang_rate_pct}% hang rate (${uh.before.hang_count}/${uh.before.trials}), ${uh.before.leaked_upstream_sockets} leaked upstream sockets, p95=${uh.before.latency_ms.p95}ms (client 300ms watchdog)`,
    `   After:  ${uh.after.hang_rate_pct}% hang rate, ${uh.after.graceful_fallback_rate_pct}% HTTP 504 fallback, ${uh.after.leaked_upstream_sockets} leaked sockets, p95=${uh.after.latency_ms.p95}ms`,
    `Total elapsed: ${report.duration_ms}ms`,
  ].join("\n");
}

async function main() {
  const { trials, outPath, jsonOnly, assertPass, help } = parseArgs(process.argv.slice(2));
  if (help) {
    console.log(
      "Usage: node examples/vulnerable-checkout/benchmark.cjs [--trials <N>] [--out <file>] [--json] [--assert] [--help]"
    );
    process.exit(0);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chaos-bench-"));
  const tStart = performance.now();

  try {
    const doubleSpendBefore = await runDoubleSpendSide("before", trials, tmpDir);
    const doubleSpendAfter = await runDoubleSpendSide("after", trials, tmpDir);

    const dupWebhookBefore = await runDuplicateWebhookSide("before", trials, tmpDir);
    const dupWebhookAfter = await runDuplicateWebhookSide("after", trials, tmpDir);

    const upstreamHangBefore = await runUpstreamHangSide("before", trials, tmpDir);
    const upstreamHangAfter = await runUpstreamHangSide("after", trials, tmpDir);

    const report = {
      schema_version: "1.0",
      benchmark: "vulnerable-checkout",
      generated_at: new Date().toISOString(),
      environment: {
        node_version: process.version,
        platform: process.platform,
        arch: process.arch,
        cpus: os.cpus().length,
      },
      trials_per_scenario: trials,
      total_trials: trials * 3,
      duration_ms: Math.round(performance.now() - tStart),
      scenarios: {
        double_spend: {
          endpoint: "POST /checkout",
          failure_class: "toctou_race",
          before: doubleSpendBefore,
          after: doubleSpendAfter,
        },
        duplicate_webhook: {
          endpoint: "POST /webhooks/payment",
          failure_class: "non_idempotent_retry",
          before: dupWebhookBefore,
          after: dupWebhookAfter,
        },
        upstream_hang: {
          endpoint: "GET /recommendations",
          failure_class: "missing_timeout",
          before: upstreamHangBefore,
          after: upstreamHangAfter,
        },
      },
    };

    if (outPath) {
      const resolvedOut = path.resolve(outPath);
      fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
      fs.writeFileSync(resolvedOut, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
    }

    if (jsonOnly) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatSummaryTable(report));
    }

    if (assertPass) {
      const failures = evaluateAssertions(report);
      if (failures.length > 0) {
        console.error(`Benchmark assertions FAILED:\n  - ${failures.join("\n  - ")}`);
        process.exit(1);
      }
      if (!jsonOnly) {
        console.log("Benchmark assertions PASSED.");
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
