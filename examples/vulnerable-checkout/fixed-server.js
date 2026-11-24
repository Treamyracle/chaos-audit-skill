"use strict";

const http = require("node:http");

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf-8")) : {});
      } catch (err) {
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createKeyedMutex() {
  const tails = new Map();
  return async function withLock(key, fn) {
    const prev = tails.get(key) || Promise.resolve();
    let release;
    const next = new Promise((r) => {
      release = r;
    });
    tails.set(key, next);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (tails.get(key) === next) {
        tails.delete(key);
      }
    }
  };
}

function createFixedServer({ store, upstreamRecommendationsUrl, upstreamTimeoutMs = 200 }) {
  const withUserLock = createKeyedMutex();
  const inFlightWebhooks = new Set();

  return http.createServer(async (req, res) => {
    try {
      // FIX 1: Per-user serialized mutex + atomic inside-lock check-and-debit + atomic persist.
      if (req.method === "POST" && req.url === "/checkout") {
        const { userId = "user-1", amount = 80 } = await readJsonBody(req);
        const result = await withUserLock(userId, async () => {
          const currentBalance = store.getBalance(userId);
          if (currentBalance < amount) {
            return { status: 409, body: { error: "Insufficient funds", balance: currentBalance } };
          }
          await delay(40);
          const nextBalance = currentBalance - amount;
          store.state.wallets[userId] = nextBalance;
          store.state.orders.push({ id: `ord-${store.state.orders.length + 1}`, userId, amount });
          store.writeStateAtomic();
          return { status: 200, body: { ok: true, balance: nextBalance } };
        });
        return sendJson(res, result.status, result.body);
      }

      // FIX 2: Synchronous in-flight & processed eventId idempotency gate before side effects.
      if (req.method === "POST" && req.url === "/webhooks/payment") {
        const { eventId, userId = "user-1", amount = 50 } = await readJsonBody(req);
        if (!eventId) {
          return sendJson(res, 400, { error: "eventId required" });
        }
        if (store.hasProcessedWebhook(eventId) || inFlightWebhooks.has(eventId)) {
          return sendJson(res, 200, {
            ok: true,
            duplicate: true,
            balance: store.getBalance(userId),
          });
        }
        inFlightWebhooks.add(eventId);
        try {
          await delay(15);
          store.state.webhooks.push({ eventId, userId, amount });
          store.state.wallets[userId] = (store.state.wallets[userId] ?? 0) + amount;
          store.writeStateAtomic();
          return sendJson(res, 200, {
            ok: true,
            duplicate: false,
            credited: amount,
            balance: store.getBalance(userId),
          });
        } finally {
          inFlightWebhooks.delete(eventId);
        }
      }

      // FIX 3: Bounded AbortController timeout + unpooled upstream socket cleanup with graceful fallback.
      if (req.method === "GET" && req.url === "/recommendations") {
        try {
          const items = await new Promise((resolve, reject) => {
            const ac = new AbortController();
            let settled = false;
            let timer;
            const settle = (err, value) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              if (err) reject(err);
              else resolve(value);
            };

            const upstreamReq = http.get(
              upstreamRecommendationsUrl,
              { signal: ac.signal, agent: false },
              (upstreamRes) => {
                const parts = [];
                upstreamRes.on("data", (d) => parts.push(d));
                upstreamRes.on("end", () => {
                  try {
                    settle(null, JSON.parse(Buffer.concat(parts).toString("utf-8")));
                  } catch (parseErr) {
                    settle(parseErr);
                  }
                });
                upstreamRes.on("error", (err) => settle(err));
              }
            );
            upstreamReq.on("error", (err) => settle(err));

            timer = setTimeout(() => {
              const timeoutErr = new Error("Upstream recommendations timed out");
              ac.abort(timeoutErr);
              upstreamReq.destroy(timeoutErr);
              settle(timeoutErr);
            }, upstreamTimeoutMs);
          });
          return sendJson(res, 200, { ok: true, items });
        } catch (err) {
          return sendJson(res, 504, {
            ok: false,
            error: "Upstream recommendations timed out",
            fallback_items: [],
          });
        }
      }

      if (req.method === "POST" && req.url === "/refund") {
        const { orderId, amount = 25 } = await readJsonBody(req);
        if (!orderId) {
          return sendJson(res, 400, { error: "orderId required" });
        }
        if (store.inFlightRefunds.has(orderId) || store.hasRefund(orderId)) {
          return sendJson(res, 409, { error: "Refund already processed or in progress" });
        }
        store.inFlightRefunds.add(orderId);
        try {
          await delay(30);
          store.state.refunds.push({ orderId, amount });
          store.writeStateAtomic();
          return sendJson(res, 200, { ok: true, orderId, refunded: amount });
        } finally {
          store.inFlightRefunds.delete(orderId);
        }
      }

      return sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      return sendJson(res, err.statusCode || 500, { error: err.message });
    }
  });
}

module.exports = { createFixedServer };
