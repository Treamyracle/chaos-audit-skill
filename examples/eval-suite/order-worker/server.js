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

async function verifyPaymentAuth() {
  await delay(25);
  return true;
}

function createOrderServer({
  store,
  carrierQuoteUrl,
  carrierHealthUrl,
  healthTimeoutMs = 150,
}) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "POST" && req.url === "/reserve") {
        const { sku = "sku-pro", userId = "acct-1", qty = 4 } = await readJsonBody(req);
        if (!Number.isInteger(qty) || qty <= 0) {
          return sendJson(res, 400, { error: "Positive integer qty required" });
        }
        const available = store.getStock(sku);
        if (available < qty) {
          return sendJson(res, 409, { error: "Out of stock", available });
        }

        await verifyPaymentAuth(userId, qty);

        const nextStock = store.getStock(sku) - qty;
        store.setStock(sku, nextStock);
        const reservationId = `res-${store.reservations.length + 1}`;
        store.addReservation({ id: reservationId, sku, userId, qty });
        return sendJson(res, 200, { ok: true, reservationId, remainingStock: nextStock });
      }

      if (req.method === "POST" && req.url === "/webhooks/fulfillment") {
        const { deliveryId, userId = "acct-1", points = 100 } = await readJsonBody(req);
        if (!deliveryId) {
          return sendJson(res, 400, { error: "deliveryId required" });
        }
        await delay(15);
        store.recordFulfillment(deliveryId, userId, points);
        return sendJson(res, 200, {
          ok: true,
          deliveryId,
          loyaltyPoints: store.getLoyaltyPoints(userId),
        });
      }

      if (req.method === "GET" && req.url === "/shipping-quote") {
        const raw = await new Promise((resolve, reject) => {
          http
            .get(carrierQuoteUrl, (upstreamRes) => {
              const parts = [];
              upstreamRes.on("data", (d) => parts.push(d));
              upstreamRes.on("end", () => resolve(Buffer.concat(parts).toString("utf-8")));
            })
            .on("error", reject);
        });
        return sendJson(res, 200, { ok: true, quote: JSON.parse(raw) });
      }

      if (req.method === "POST" && req.url === "/cancel") {
        const { orderId, reason } = await readJsonBody(req);
        if (!orderId) {
          return sendJson(res, 400, { error: "orderId required" });
        }
        if (store.inFlightCancels.has(orderId) || store.isCancelled(orderId)) {
          return sendJson(res, 409, { error: "Cancellation already processed or active" });
        }
        store.inFlightCancels.add(orderId);
        try {
          await delay(25);
          store.recordCancellation(orderId, reason);
          return sendJson(res, 200, { ok: true, orderId, cancelled: true });
        } finally {
          store.inFlightCancels.delete(orderId);
        }
      }

      if (req.method === "GET" && req.url === "/carrier-health") {
        try {
          const resp = await fetch(carrierHealthUrl, {
            signal: AbortSignal.timeout(healthTimeoutMs),
          });
          const data = await resp.json();
          return sendJson(res, 200, { ok: true, carrier: data });
        } catch (_err) {
          return sendJson(res, 503, {
            ok: false,
            degraded: true,
            error: "Carrier health check timed out or failed",
          });
        }
      }

      return sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      return sendJson(res, err.statusCode || 500, { error: err.message });
    }
  });
}

module.exports = { createOrderServer };
