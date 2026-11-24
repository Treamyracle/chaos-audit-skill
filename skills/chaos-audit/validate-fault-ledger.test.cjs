"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  validateFaultLedger,
  validateFaultLedgerFile,
  escapeUnsafeDiagnosticCharacters,
} = require("./validate-fault-ledger.cjs");

function makeBaseUnit(overrides = {}) {
  return {
    fault_unit_id: "fu-checkout-wallet-001",
    canonical_refs: {
      surface: "POST /checkout",
      state_store: "wallets.json",
      subsystem: "billing",
      failure_class: "toctou_race",
    },
    invariant: "Wallet balance must never drop below zero under concurrent debits.",
    starting_paths: ["server.js", "store.js"],
    selected_playbooks: ["FAILURE-CLASSES.md", "FILESYSTEM-IPC-AND-SHUTDOWN.md"],
    excluded_playbooks: ["STATE-AND-FRONTEND-CONCURRENCY.md"],
    prior_status: "none",
    attempts: [],
    wave: 0,
    status: "planned",
    agent_id: null,
    reviewed_paths: [],
    reproducer_checks: [],
    result_fingerprints: [],
    unresolved: [],
    ...overrides,
  };
}

function makeBaseLedger(units = [makeBaseUnit()], overrides = {}) {
  return {
    schema_version: "1.0",
    run_id: "run-001",
    target_commit: "abc1234",
    units,
    ...overrides,
  };
}

describe("validate-fault-ledger", () => {
  it("1. accepts valid planned, covered, candidate, and blocked units", () => {
    const ledger = makeBaseLedger([
      makeBaseUnit({ fault_unit_id: "fu-planned-1", status: "planned", wave: 0, agent_id: null }),
      makeBaseUnit({
        fault_unit_id: "fu-covered-2",
        status: "covered",
        wave: 1,
        agent_id: "hunter-1",
        reviewed_paths: ["server.js"],
        reproducer_checks: ["Verified mutex guard serializes concurrent requests"],
      }),
      makeBaseUnit({
        fault_unit_id: "fu-candidate-3",
        status: "candidate",
        wave: 1,
        agent_id: "hunter-2",
        reviewed_paths: ["server.js", "store.js"],
        reproducer_checks: ["Two parallel POST /checkout calls observed"],
        result_fingerprints: ["fp-checkout-toctou-001"],
      }),
      makeBaseUnit({
        fault_unit_id: "fu-blocked-4",
        status: "blocked",
        wave: 1,
        agent_id: "hunter-3",
        reviewed_paths: ["store.js"],
        unresolved: ["Requires simulated SIGKILL mid-write against real filesystem"],
      }),
    ]);

    const res = validateFaultLedger(ledger);
    assert.equal(res.valid, true, JSON.stringify(res.errors));
    assert.equal(res.stats.total_units, 4);
    assert.equal(res.stats.coverage_pct, 50.0);
  });

  it("2. accepts valid not_applicable, out_of_scope, deferred, and in_progress units", () => {
    const ledger = makeBaseLedger([
      makeBaseUnit({ fault_unit_id: "fu-na", status: "not_applicable", wave: 1, agent_id: null }),
      makeBaseUnit({ fault_unit_id: "fu-oos", status: "out_of_scope", wave: 1, agent_id: null }),
      makeBaseUnit({ fault_unit_id: "fu-def", status: "deferred", wave: 1, agent_id: null }),
      makeBaseUnit({ fault_unit_id: "fu-prog", status: "in_progress", wave: 2, agent_id: "hunter-9" }),
    ]);
    const res = validateFaultLedger(ledger);
    assert.equal(res.valid, true, JSON.stringify(res.errors));
    assert.equal(res.stats.applicable_units, 2);
  });

  it("3. accepts valid prior attempts history entries", () => {
    const res = validateFaultLedger(
      makeBaseLedger([
        makeBaseUnit({
          status: "covered",
          wave: 2,
          agent_id: "hunter-2",
          reviewed_paths: ["server.js"],
          reproducer_checks: ["Verified under concurrency"],
          attempts: [
            {
              wave: 1,
              status: "blocked",
              agent_id: "hunter-1",
              reviewed_paths: ["server.js"],
              reproducer_checks: ["Initial read"],
              result_fingerprints: [],
              unresolved: ["Timed out"],
              reassignment_reason: "Reassigned with increased scratch timeout",
            },
          ],
        }),
      ])
    );
    assert.equal(res.valid, true, JSON.stringify(res.errors));
  });

  it("4. rejects non-object root and non-array units", () => {
    assert.equal(validateFaultLedger([]).valid, false);
    assert.equal(validateFaultLedger(makeBaseLedger("not-array")).valid, false);
  });

  it("5. rejects wrong schema_version and missing/unexpected root fields", () => {
    const res = validateFaultLedger({ schema_version: "2.0", extra: true, units: [] });
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('schema_version must be "1.0"')));
    assert.ok(res.errors.some((e) => e.includes("Missing required root field: run_id")));
    assert.ok(res.errors.some((e) => e.includes("Unexpected root field")));
  });

  it("6. rejects whitespace-only run_id and invalid fault_unit_id pattern", () => {
    const res = validateFaultLedger(
      makeBaseLedger([makeBaseUnit({ fault_unit_id: "bad unit id!" })], { run_id: "   " })
    );
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("run_id must contain non-whitespace")));
    assert.ok(res.errors.some((e) => e.includes("fault_unit_id must match")));
  });

  it("7. rejects duplicate fault_unit_id values", () => {
    const res = validateFaultLedger(makeBaseLedger([makeBaseUnit(), makeBaseUnit()]));
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("duplicated")));
  });

  it("8. rejects malformed canonical_refs (missing or unexpected keys)", () => {
    const res = validateFaultLedger(
      makeBaseLedger([
        makeBaseUnit({
          canonical_refs: {
            surface: "POST /checkout",
            state_store: "wallets.json",
            subsystem: "billing",
            extra_ref: "nope",
          },
        }),
      ])
    );
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("canonical_refs missing field: failure_class")));
    assert.ok(res.errors.some((e) => e.includes("canonical_refs has unexpected field")));
  });

  it("9. rejects invalid prior_status and invalid unit status", () => {
    const res = validateFaultLedger(
      makeBaseLedger([makeBaseUnit({ prior_status: "unknown_prior", status: "done" })])
    );
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("prior_status invalid")));
    assert.ok(res.errors.some((e) => e.includes("status invalid")));
  });

  it("10. rejects path traversal (..), absolute paths, and Windows backslash traversal", () => {
    const res = validateFaultLedger(
      makeBaseLedger([
        makeBaseUnit({
          starting_paths: ["../etc/passwd", "a\\..\\b.js", "/abs/path.js", "C:\\win\\a.js"],
        }),
      ])
    );
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("unsafe or empty path segment")));
    assert.ok(res.errors.some((e) => e.includes("absolute path")));
  });

  it("11. rejects Windows reserved filenames in paths (CON, PRN, NUL, COM1)", () => {
    const res = validateFaultLedger(
      makeBaseLedger([
        makeBaseUnit({
          starting_paths: ["src/CON.js", "src/nul", "com1.txt"],
        }),
      ])
    );
    assert.equal(res.valid, false);
    assert.equal(
      res.errors.filter((e) => e.includes("Windows reserved path segment")).length,
      3
    );
  });

  it("12. rejects forbidden control/bidi characters in file paths", () => {
    const res = validateFaultLedger(
      makeBaseLedger([makeBaseUnit({ starting_paths: ["src/\u202Eevil.js"] })])
    );
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("forbidden control or bidi characters")));
  });

  it("13. rejects Windows reserved device names and invalid patterns in agent_id", () => {
    const res = validateFaultLedger(
      makeBaseLedger([
        makeBaseUnit({ fault_unit_id: "fu-1", status: "in_progress", wave: 1, agent_id: "nul" }),
        makeBaseUnit({ fault_unit_id: "fu-2", status: "in_progress", wave: 1, agent_id: "con" }),
        makeBaseUnit({ fault_unit_id: "fu-3", status: "in_progress", wave: 1, agent_id: "BAD_ID" }),
      ])
    );
    assert.equal(res.valid, false);
    assert.equal(
      res.errors.filter((e) => e.includes("Windows reserved device name")).length,
      2
    );
    assert.ok(res.errors.some((e) => e.includes("agent_id must match")));
  });

  it("14. enforces planned invariant (wave 0 or null, agent_id null)", () => {
    const res = validateFaultLedger(
      makeBaseLedger([makeBaseUnit({ status: "planned", wave: 2, agent_id: "hunter-1" })])
    );
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("wave must be 0 or null")));
    assert.ok(res.errors.some((e) => e.includes("agent_id must be null")));
  });

  it("15. enforces in_progress invariant (wave >= 1, agent_id non-null)", () => {
    const res = validateFaultLedger(
      makeBaseLedger([makeBaseUnit({ status: "in_progress", wave: 0, agent_id: null })])
    );
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("wave must be >= 1")));
    assert.ok(res.errors.some((e) => e.includes("agent_id must be non-null")));
  });

  it("16. enforces covered invariant (reviewed_paths and reproducer_checks required)", () => {
    const res = validateFaultLedger(
      makeBaseLedger([
        makeBaseUnit({
          status: "covered",
          wave: 1,
          agent_id: "hunter-1",
          reviewed_paths: [],
          reproducer_checks: [],
        }),
      ])
    );
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("reviewed_paths must not be empty")));
    assert.ok(res.errors.some((e) => e.includes("reproducer_checks must describe")));
  });

  it("17. enforces candidate invariant (result_fingerprints required and valid pattern)", () => {
    const res = validateFaultLedger(
      makeBaseLedger([
        makeBaseUnit({
          fault_unit_id: "fu-c1",
          status: "candidate",
          wave: 1,
          agent_id: "hunter-1",
          reviewed_paths: ["server.js"],
          result_fingerprints: [],
        }),
        makeBaseUnit({
          fault_unit_id: "fu-c2",
          status: "candidate",
          wave: 1,
          agent_id: "hunter-1",
          reviewed_paths: ["server.js"],
          result_fingerprints: ["bad space fp"],
        }),
      ])
    );
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("result_fingerprints must not be empty")));
    assert.ok(res.errors.some((e) => e.includes("result_fingerprints[0] must match")));
  });

  it("18. enforces blocked invariant (unresolved required)", () => {
    const res = validateFaultLedger(
      makeBaseLedger([
        makeBaseUnit({ status: "blocked", wave: 1, agent_id: "hunter-1", unresolved: [] }),
      ])
    );
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("unresolved must list")));
  });

  it("19. rejects malformed attempts records", () => {
    const res = validateFaultLedger(
      makeBaseLedger([
        makeBaseUnit({
          attempts: [{ wave: 0, status: "planned", agent_id: "con" }],
        }),
      ])
    );
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("attempts[0] missing field")));
    assert.ok(res.errors.some((e) => e.includes("attempts[0].wave must be integer >= 1")));
    assert.ok(res.errors.some((e) => e.includes("attempts[0].status invalid")));
  });

  it("20. rejects excessive JSON nesting depth (> 64)", () => {
    let deep = { a: 1 };
    for (let i = 0; i < 70; i += 1) deep = { child: deep };
    const res = validateFaultLedger(makeBaseLedger([makeBaseUnit({ extra: deep })]));
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("nesting depth exceeds maximum")));
  });

  it("21. escapes ANSI and control characters in diagnostic outputs", () => {
    const dirty = "bad\x1b[31mred\x1b[0m\u202E";
    const escaped = escapeUnsafeDiagnosticCharacters(dirty);
    assert.equal(escaped.includes("\x1b"), false);
    assert.ok(escaped.includes("\\u001b"));
    assert.ok(escaped.includes("\\u202e"));

    const res = validateFaultLedger({ schema_version: "1.0", ["bad\x1b[31m"]: 1, units: [] });
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("\\u001b") && !e.includes("\x1b")));
  });

  it("22. validates --repo-root existence, rejects invalid UTF-8 BOM, and verifies CLI exit codes", (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chaos-ledger-test-"));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    fs.writeFileSync(path.join(tmpDir, "server.js"), "console.log('ok');\n");
    fs.writeFileSync(path.join(tmpDir, "store.js"), "console.log('ok');\n");
    const ledgerPath = path.join(tmpDir, "fault-ledger.json");
    fs.writeFileSync(ledgerPath, JSON.stringify(makeBaseLedger()));

    const passRes = validateFaultLedgerFile(ledgerPath, { repoRoot: tmpDir });
    assert.equal(passRes.valid, true);

    const cliOk = spawnSync(
      process.execPath,
      [path.join(__dirname, "validate-fault-ledger.cjs"), "--repo-root", tmpDir, ledgerPath],
      { encoding: "utf-8" }
    );
    assert.equal(cliOk.status, 0, cliOk.stderr);
    assert.match(cliOk.stdout, /VALID fault-ledger/);

    const bomPath = path.join(tmpDir, "bom-ledger.json");
    fs.writeFileSync(bomPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("{}")]));
    const bomRes = validateFaultLedgerFile(bomPath);
    assert.equal(bomRes.valid, false);

    const missingPathLedger = path.join(tmpDir, "bad-ledger.json");
    fs.writeFileSync(
      missingPathLedger,
      JSON.stringify(makeBaseLedger([makeBaseUnit({ starting_paths: ["missing.js"] })]))
    );
    const cliFail = spawnSync(
      process.execPath,
      [path.join(__dirname, "validate-fault-ledger.cjs"), "--repo-root", tmpDir, missingPathLedger],
      { encoding: "utf-8" }
    );
    assert.equal(cliFail.status, 1);
    assert.match(cliFail.stderr, /does not exist under --repo-root/);
  });

  it("23. supports --help and --json machine-readable output on pass and fail", (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chaos-ledger-json-"));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    const helpRun = spawnSync(
      process.execPath,
      [path.join(__dirname, "validate-fault-ledger.cjs"), "--help"],
      { encoding: "utf-8" }
    );
    assert.equal(helpRun.status, 0);
    assert.match(helpRun.stdout, /Usage: node validate-fault-ledger\.cjs/);

    const okPath = path.join(tmpDir, "ok.json");
    fs.writeFileSync(okPath, JSON.stringify(makeBaseLedger()));
    const jsonOk = spawnSync(
      process.execPath,
      [path.join(__dirname, "validate-fault-ledger.cjs"), "--json", okPath],
      { encoding: "utf-8" }
    );
    assert.equal(jsonOk.status, 0);
    const parsedOk = JSON.parse(jsonOk.stdout);
    assert.equal(parsedOk.valid, true);
    assert.equal(parsedOk.stats.total_units, 1);

    const badPath = path.join(tmpDir, "bad.json");
    fs.writeFileSync(badPath, JSON.stringify({ broken: true }));
    const jsonFail = spawnSync(
      process.execPath,
      [path.join(__dirname, "validate-fault-ledger.cjs"), "--json", badPath],
      { encoding: "utf-8" }
    );
    assert.equal(jsonFail.status, 1);
    const parsedFail = JSON.parse(jsonFail.stdout);
    assert.equal(parsedFail.valid, false);
    assert.ok(parsedFail.errors.length > 0);
  });
});
