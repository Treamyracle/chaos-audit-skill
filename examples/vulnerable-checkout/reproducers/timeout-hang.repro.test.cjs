"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
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

describe("reproducer: missing outbound HTTP timeout hangs indefinitely", () => {
  it("demonstrates unbounded hang on vulnerable server and verifies fixed server bounds latency", async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "repro-to-"));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    // Local blackhole server that accepts HTTP connections and never sends a response.
    const openSockets = new Set();
    const blackhole = http.createServer((req, res) => {
      openSockets.add(res.socket);
      res.socket.on("close", () => openSockets.delete(res.socket));
    });
    const blackholeUrl = await listenEphemeral(blackhole);
    t.after(() => {
      for (const s of openSockets) s.destroy();
      blackhole.close();
    });

    const vulnStore = new FileCheckoutStore(path.join(tmpDir, "vuln.json"));
    const vulnServer = createVulnerableServer({
      store: vulnStore,
      upstreamRecommendationsUrl: `${blackholeUrl}/items`,
    });
    const vulnUrl = await listenEphemeral(vulnServer);
    t.after(() => vulnServer.close());

    // Client-side watchdog proves server itself never resolves within 300ms
    await assert.rejects(
      fetch(`${vulnUrl}/recommendations`, { signal: AbortSignal.timeout(300) }),
      (err) => err.name === "TimeoutError" || err.name === "AbortError"
    );

    const fixedStore = new FileCheckoutStore(path.join(tmpDir, "fixed.json"));
    const fixedServer = createFixedServer({
      store: fixedStore,
      upstreamRecommendationsUrl: `${blackholeUrl}/items`,
      upstreamTimeoutMs: 120,
    });
    const fixedUrl = await listenEphemeral(fixedServer);
    t.after(() => fixedServer.close());

    const start = performance.now();
    const fixedRes = await fetch(`${fixedUrl}/recommendations`, {
      signal: AbortSignal.timeout(1000),
    });
    const elapsedMs = performance.now() - start;
    const body = await fixedRes.json();

    assert.equal(fixedRes.status, 504);
    assert.equal(body.ok, false);
    assert.deepEqual(body.fallback_items, []);
    assert.ok(elapsedMs < 500, `Expected fast timeout < 500ms, got ${elapsedMs}ms`);
  });
});
