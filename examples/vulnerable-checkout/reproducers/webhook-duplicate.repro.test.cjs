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

describe("reproducer: non-idempotent duplicate webhook retry", () => {
  it("demonstrates duplicate credit on vulnerable server and verifies fixed server deduplicates", async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "repro-wh-"));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    const vulnStore = new FileCheckoutStore(path.join(tmpDir, "vuln.json"), {
      wallets: { "user-1": 0 },
      orders: [],
      webhooks: [],
      refunds: [],
    });
    const vulnServer = createVulnerableServer({ store: vulnStore, upstreamRecommendationsUrl: "" });
    const vulnUrl = await listenEphemeral(vulnServer);
    t.after(() => vulnServer.close());

    const webhookPayload = JSON.stringify({
      eventId: "evt_stripe_991",
      userId: "user-1",
      amount: 50,
    });

    const [w1, w2] = await Promise.all([
      fetch(`${vulnUrl}/webhooks/payment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: webhookPayload,
      }),
      fetch(`${vulnUrl}/webhooks/payment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: webhookPayload,
      }),
    ]);

    assert.equal(w1.status, 200);
    assert.equal(w2.status, 200);
    assert.equal(vulnStore.getBalance("user-1"), 100, "Duplicate webhook double-credited user to 100!");

    const fixedStore = new FileCheckoutStore(path.join(tmpDir, "fixed.json"), {
      wallets: { "user-1": 0 },
      orders: [],
      webhooks: [],
      refunds: [],
    });
    const fixedServer = createFixedServer({ store: fixedStore, upstreamRecommendationsUrl: "" });
    const fixedUrl = await listenEphemeral(fixedServer);
    t.after(() => fixedServer.close());

    const [fw1, fw2] = await Promise.all([
      fetch(`${fixedUrl}/webhooks/payment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: webhookPayload,
      }),
      fetch(`${fixedUrl}/webhooks/payment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: webhookPayload,
      }),
    ]);

    assert.equal(fw1.status, 200);
    assert.equal(fw2.status, 200);
    assert.equal(fixedStore.getBalance("user-1"), 50, "Fixed server credited exactly once");
    assert.equal(fixedStore.state.webhooks.length, 1);
  });
});
