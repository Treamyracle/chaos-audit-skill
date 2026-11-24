"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");

class FileCheckoutStore {
  constructor(filePath, initialState = null) {
    this.filePath = filePath;
    this.state = initialState || {
      wallets: { "user-1": 100 },
      orders: [],
      webhooks: [],
      refunds: [],
    };
    this.inFlightRefunds = new Set();
    this.writeState();
  }

  /**
   * Intentional reliability bug (#4): direct fs.writeFileSync overwrites the state file
   * in place instead of writing to a sibling temp file and atomically renaming.
   */
  writeState() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf-8");
  }

  /**
   * Fixed atomic persistence helper used by fixed-server.js.
   */
  writeStateAtomic() {
    const tmpPath = `${this.filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    const fd = fs.openSync(tmpPath, "w");
    try {
      fs.writeSync(fd, JSON.stringify(this.state, null, 2), null, "utf-8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, this.filePath);
  }

  getBalance(userId) {
    return this.state.wallets[userId] ?? 0;
  }

  setBalance(userId, newBalance) {
    this.state.wallets[userId] = newBalance;
    this.writeState();
  }

  recordOrder(order) {
    this.state.orders.push(order);
    this.writeState();
  }

  recordWebhookCredit(eventId, userId, amount) {
    this.state.webhooks.push({ eventId, userId, amount });
    this.state.wallets[userId] = (this.state.wallets[userId] ?? 0) + amount;
    this.writeState();
  }

  hasProcessedWebhook(eventId) {
    return this.state.webhooks.some((w) => w.eventId === eventId);
  }

  hasRefund(orderId) {
    return this.state.refunds.some((r) => r.orderId === orderId);
  }

  recordRefund(orderId, amount) {
    this.state.refunds.push({ orderId, amount });
    this.writeState();
  }
}

module.exports = { FileCheckoutStore };
