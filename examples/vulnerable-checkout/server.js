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

function createVulnerableServer({ store, upstreamRecommendationsUrl }) {
  return http.createServer(async (req, res) => {
    try {
      // BUG 1: TOCTOU double-spend race — reads balance before async gateway await
      // and commits deduction later without holding a lock or CAS precondition.
      if (req.method === "POST" && req.url === "/checkout") {
        const { userId = "user-1", amount = 80 } = await readJsonBody(req);
        const currentBalance = store.getBalance(userId);
        if (currentBalance < amount) {
          return sendJson(res, 409, { error: "Insufficient funds", balance: currentBalance });
        }

        // Simulated async payment gateway check yields event loop to concurrent requests.
        await delay(40);

        const nextBalance = store.getBalance(userId) - amount;
        store.setBalance(userId, nextBalance);
        store.recordOrder({ id: `ord-${store.state.orders.length + 1}`, userId, amount });
        return sendJson(res, 200, { ok: true, balance: nextBalance });
      }

      // BUG 2: Non-idempotent payment webhook retry — lacks eventId deduplication.
      if (req.method === "POST" && req.url === "/webhooks/payment") {
        const { eventId, userId = "user-1", amount = 50 } = await readJsonBody(req);
        await delay(15);
        store.recordWebhookCredit(eventId, userId, amount);
        return sendJson(res, 200, {
          ok: true,
          credited: amount,
          balance: store.getBalance(userId),
        });
      }

      // BUG 3: Outbound HTTP request without timeout or AbortSignal hangs indefinitely.
      if (req.method === "GET" && req.url === "/recommendations") {
        const data = await new Promise((resolve, reject) => {
          http
            .get(upstreamRecommendationsUrl, (upstreamRes) => {
              const parts = [];
              upstreamRes.on("data", (d) => parts.push(d));
              upstreamRes.on("end", () => resolve(Buffer.concat(parts).toString("utf-8")));
            })
            .on("error", reject);
        });
        return sendJson(res, 200, { ok: true, items: JSON.parse(data) });
      }

      // GUARDED ROUTE (for disprover/rejected demonstration):
      // Synchronous lock set check happens BEFORE any await.
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
          store.recordRefund(orderId, amount);
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

module.exports = { createVulnerableServer };
