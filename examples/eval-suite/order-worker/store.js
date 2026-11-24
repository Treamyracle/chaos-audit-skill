"use strict";

class InventoryStore {
  constructor(initial = null) {
    const seed = initial || {};
    this.stock = { ...(seed.stock || { "sku-pro": 5 }) };
    this.loyaltyPoints = { ...(seed.loyaltyPoints || {}) };
    this.reservations = [...(seed.reservations || [])];
    this.fulfillments = [...(seed.fulfillments || [])];
    this.cancellations = [...(seed.cancellations || [])];
    this.payouts = [...(seed.payouts || [])];
    this.inFlightCancels = new Set();
  }

  getStock(sku) {
    return this.stock[sku] ?? 0;
  }

  setStock(sku, qty) {
    this.stock[sku] = qty;
  }

  addReservation(entry) {
    this.reservations.push(entry);
  }

  getLoyaltyPoints(userId) {
    return this.loyaltyPoints[userId] ?? 0;
  }

  hasFulfillment(deliveryId) {
    return this.fulfillments.some((f) => f.deliveryId === deliveryId);
  }

  recordFulfillment(deliveryId, userId, points) {
    this.fulfillments.push({ deliveryId, userId, points });
    this.loyaltyPoints[userId] = (this.loyaltyPoints[userId] ?? 0) + points;
  }

  isCancelled(orderId) {
    return this.cancellations.some((c) => c.orderId === orderId);
  }

  recordCancellation(orderId, reason) {
    this.cancellations.push({ orderId, reason: reason || "requested" });
  }

  getPendingPayouts() {
    return this.payouts.filter((p) => p.status === "pending");
  }

  markPayoutSent(id, txRef) {
    const target = this.payouts.find((p) => p.id === id);
    if (target) {
      target.status = "sent";
      target.txRef = txRef;
    }
  }
}

module.exports = { InventoryStore };
