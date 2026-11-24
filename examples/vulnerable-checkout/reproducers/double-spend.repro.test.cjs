"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { FileCheckoutStore } = require("../store.js");
const { createVulnerableServer } = require("../server.js");
const { createFixedServer } = require("../fixed-server.js");

function listenEphemeral(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

describe("reproducer: TOCTOU double-spend on POST /checkout & guarded POST /refund", () => {
  it("demonstrates TOCTOU double-spend on vulnerable server and verifies fixed server blocks it", async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "repro-ds-"));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    // 1. Trigger bug on vulnerable server ($100 wallet, two concurrent $80 checkouts)
    const vulnStore = new FileCheckoutStore(path.join(tmpDir, "vuln.json"), {
      wallets: { "user-1": 100 },
      orders: [],
      webhooks: [],
      refunds: [],
    });
    const vulnServer = createVulnerableServer({ store: vulnStore, upstreamRecommendationsUrl: "" });
    const vulnUrl = await listenEphemeral(vulnServer);
    t.after(() => vulnServer.close());

    const [r1, r2] = await Promise.all([
      fetch(`${vulnUrl}/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "user-1", amount: 80 }),
      }),
      fetch(`${vulnUrl}/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "user-1", amount: 80 }),
      }),
    ]);

    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(vulnStore.state.orders.length, 2, "Vulnerable server created 2 orders");
    assert.equal(vulnStore.getBalance("user-1"), -60, "Wallet dropped to -60!");

    // 2. Verify guarded /refund route blocks concurrent duplicate refund (rejected finding)
    const [ref1, ref2] = await Promise.all([
      fetch(`${vulnUrl}/refund`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: "ord-1", amount: 25 }),
      }),
      fetch(`${vulnUrl}/refund`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: "ord-1", amount: 25 }),
      }),
    ]);
    const refStatuses = [ref1.status, ref2.status].sort();
    assert.deepEqual(refStatuses, [200, 409]);
    assert.equal(vulnStore.state.refunds.length, 1);

    // 3. Verify fixed server enforces invariant (1 succeeds, 1 gets 409, balance stays 20)
    const fixedStore = new FileCheckoutStore(path.join(tmpDir, "fixed.json"), {
      wallets: { "user-1": 100 },
      orders: [],
      webhooks: [],
      refunds: [],
    });
    const fixedServer = createFixedServer({ store: fixedStore, upstreamRecommendationsUrl: "" });
    const fixedUrl = await listenEphemeral(fixedServer);
    t.after(() => fixedServer.close());

    const [f1, f2] = await Promise.all([
      fetch(`${fixedUrl}/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "user-1", amount: 80 }),
      }),
      fetch(`${fixedUrl}/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "user-1", amount: 80 }),
      }),
    ]);

    assert.deepEqual([f1.status, f2.status].sort(), [200, 409]);
    assert.equal(fixedStore.state.orders.length, 1);
    assert.equal(fixedStore.getBalance("user-1"), 20);
  });

  it("verifies writeStateAtomic writes valid JSON and leaves zero stray temp files", (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "repro-atomic-"));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    const statePath = path.join(tmpDir, "state.json");
    const store = new FileCheckoutStore(statePath, {
      wallets: { "user-1": 250 },
      orders: [{ id: "ord-1", userId: "user-1", amount: 50 }],
      webhooks: [],
      refunds: [],
    });
    store.writeStateAtomic();

    const parsed = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    assert.equal(parsed.wallets["user-1"], 250);
    assert.equal(parsed.orders.length, 1);
    const strayTmp = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".tmp"));
    assert.deepEqual(strayTmp, []);
  });
});
