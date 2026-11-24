"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { validateFindings, validateFindingsFile } = require("./validate-findings.cjs");

function makeConfirmed(overrides = {}) {
  return {
    verdict: "confirmed",
    fingerprint: "fp-checkout-toctou-001",
    fault_unit_ids: ["fu-checkout-wallet-001"],
    title: "TOCTOU double-spend race in POST /checkout",
    failure_class: "toctou_race",
    severity: "critical",
    blast_radius: "Account balance can go negative while fulfilling duplicate orders.",
    trigger_likelihood: "High under concurrent click or parallel API requests.",
    broken_invariant: "Total debited amount must never exceed wallet balance.",
    root_cause: "Handler reads balance before an async gateway await and overwrites balance without a lock.",
    source_trace: [
      {
        file: "server.js",
        line_start: 1,
        line_end: 2,
        symbol: "handleCheckout",
        role: "entrypoint",
      },
      {
        file: "store.js",
        line_start: 1,
        line_end: 3,
        symbol: "writeBalance",
        role: "sink",
      },
    ],
    reproducer: {
      kind: "concurrent_test",
      command: "node --test reproducers/double-spend.repro.test.cjs",
      test_file: "reproducers/double-spend.repro.test.cjs",
      runs_executed: 3,
      runs_failed: 3,
      observed_failure_output: "2/2 concurrent $80 checkouts returned 200 OK on $100 wallet; balance=-60",
    },
    disprover_notes: "Checked store.js and server.js; no mutex or CAS check guards checkout.",
    minimal_fix: "Serialize mutations per userId with an async mutex or atomic conditional debit.",
    regression_test_strategy: "Keep double-spend.repro.test.cjs in CI.",
    ...overrides,
  };
}

function makeNeedsValidation(overrides = {}) {
  return {
    verdict: "needs_validation",
    fingerprint: "fp-non-atomic-crash-002",
    fault_unit_ids: ["fu-store-crash-002"],
    title: "Non-atomic JSON state overwrite on abrupt SIGKILL",
    failure_class: "non_atomic_file_write",
    severity: null,
    broken_invariant: "State file must remain parseable JSON across unexpected process termination.",
    root_cause: "writeState invokes fs.writeFileSync directly against the primary file.",
    source_trace: [
      {
        file: "store.js",
        line_start: 1,
        line_end: 3,
        symbol: "writeState",
        role: "sink",
      },
    ],
    unresolved_fact: "Local Node sandbox cannot inject mid-syscall kernel power loss deterministically.",
    why_blocked: "Requires OS fault-injection harness (dm-flakey / SIGKILL timing harness).",
    safe_verification_recipe: "Run SIGKILL stress loop against scratch copy of store.js and verify JSON.parse recovery.",
    ...overrides,
  };
}

function makeRejected(overrides = {}) {
  return {
    verdict: "rejected",
    fingerprint: "fp-refund-race-003",
    fault_unit_ids: ["fu-refund-guard-003"],
    title: "Potential duplicate refund under parallel POST /refund",
    failure_class: "non_idempotent_retry",
    severity: null,
    disprover_evidence: "Verified synchronous idempotency Set check + per-order queue prevents duplicate refund.",
    mitigating_guard_location: {
      file: "server.js",
      line_start: 2,
      line_end: 3,
      symbol: "handleRefund",
    },
    rejection_reason: "Idempotency check occurs synchronously before await.",
    ...overrides,
  };
}

describe("validate-findings", () => {
  it("1. accepts valid confirmed, needs_validation, and rejected records", () => {
    const res = validateFindings([makeConfirmed(), makeNeedsValidation(), makeRejected()]);
    assert.equal(res.valid, true, JSON.stringify(res.errors));
    assert.equal(res.stats.total_findings, 3);
    assert.deepEqual(res.stats.verdicts, { confirmed: 1, needs_validation: 1, rejected: 1 });
    assert.equal(res.stats.severities.critical, 1);
  });

  it("2. accepts fault_injection and deterministic_trace reproducer kinds", () => {
    const res = validateFindings([
      makeConfirmed({
        fingerprint: "fp-1",
        reproducer: { ...makeConfirmed().reproducer, kind: "fault_injection" },
      }),
      makeConfirmed({
        fingerprint: "fp-2",
        reproducer: { ...makeConfirmed().reproducer, kind: "deterministic_trace" },
      }),
    ]);
    assert.equal(res.valid, true, JSON.stringify(res.errors));
  });

  it("3. rejects non-array root and non-object finding items", () => {
    assert.equal(validateFindings({}).valid, false);
    assert.equal(validateFindings(["bad"]).valid, false);
  });

  it("4. rejects unknown verdict value", () => {
    const res = validateFindings([{ verdict: "maybe" }]);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('must be "confirmed", "needs_validation", or "rejected"')));
  });

  it("5. rejects confirmed finding with missing required fields", () => {
    const incomplete = makeConfirmed();
    delete incomplete.minimal_fix;
    delete incomplete.disprover_notes;
    const res = validateFindings([incomplete]);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("missing required field: minimal_fix")));
    assert.ok(res.errors.some((e) => e.includes("missing required field: disprover_notes")));
  });

  it("6. rejects unexpected fields on all verdict variants", () => {
    const res = validateFindings([
      makeConfirmed({ fingerprint: "fp-a", unknown_c: 1 }),
      makeNeedsValidation({ fingerprint: "fp-b", unknown_nv: 2 }),
      makeRejected({ fingerprint: "fp-c", unknown_r: 3 }),
    ]);
    assert.equal(res.valid, false);
    assert.equal(res.errors.filter((e) => e.includes("unexpected field")).length, 3);
  });

  it("7. rejects duplicate fingerprints and malformed fingerprint patterns", () => {
    const dup = validateFindings([makeConfirmed(), makeConfirmed()]);
    assert.equal(dup.valid, false);
    assert.ok(dup.errors.some((e) => e.includes("duplicated")));

    const badPat = validateFindings([makeConfirmed({ fingerprint: "has spaces!" })]);
    assert.equal(badPat.valid, false);
    assert.ok(badPat.errors.some((e) => e.includes("fingerprint must match")));
  });

  it("8. rejects empty or non-array fault_unit_ids", () => {
    const emptyArr = validateFindings([makeConfirmed({ fault_unit_ids: [] })]);
    assert.equal(emptyArr.valid, false);
    assert.ok(emptyArr.errors.some((e) => e.includes("fault_unit_ids must be a non-empty array")));
  });

  it("9. rejects invalid severity on confirmed finding", () => {
    const res = validateFindings([makeConfirmed({ severity: "urgent" })]);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("critical|high|medium|low")));
  });

  it("10. rejects severity inflation on needs_validation and rejected verdicts", () => {
    const nv = validateFindings([makeNeedsValidation({ severity: "high" })]);
    assert.equal(nv.valid, false);
    assert.ok(nv.errors.some((e) => e.includes("severity must be null for needs_validation")));

    const rej = validateFindings([makeRejected({ severity: "low" })]);
    assert.equal(rej.valid, false);
    assert.ok(rej.errors.some((e) => e.includes("severity must be null for rejected")));
  });

  it("11. rejects confirmed finding with runs_failed == 0", () => {
    const res = validateFindings([
      makeConfirmed({
        reproducer: { ...makeConfirmed().reproducer, runs_executed: 5, runs_failed: 0 },
      }),
    ]);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("runs_failed must be an integer >= 1")));
  });

  it("12. rejects confirmed finding with runs_failed > runs_executed", () => {
    const res = validateFindings([
      makeConfirmed({
        reproducer: { ...makeConfirmed().reproducer, runs_executed: 2, runs_failed: 5 },
      }),
    ]);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("cannot exceed runs_executed")));
  });

  it("13. rejects invalid reproducer.kind and empty observed_failure_output", () => {
    const res = validateFindings([
      makeConfirmed({
        reproducer: {
          ...makeConfirmed().reproducer,
          kind: "theoretical",
          observed_failure_output: "   \t\n ",
        },
      }),
    ]);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("reproducer.kind invalid")));
    assert.ok(res.errors.some((e) => e.includes("observed_failure_output must contain")));
  });

  it("14. rejects confirmed finding with fewer than 2 source_trace hops", () => {
    const res = validateFindings([
      makeConfirmed({ source_trace: [makeConfirmed().source_trace[0]] }),
    ]);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("at least 2 hops")));
  });

  it("15. rejects needs_validation with empty source_trace", () => {
    const res = validateFindings([makeNeedsValidation({ source_trace: [] })]);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("at least 1 location")));
  });

  it("16. rejects invalid line numbers (line_start < 1 or line_end < line_start)", () => {
    const res = validateFindings([
      makeRejected({
        mitigating_guard_location: {
          file: "server.js",
          line_start: 10,
          line_end: 4,
          symbol: "guard",
        },
      }),
      makeNeedsValidation({
        source_trace: [
          { file: "store.js", line_start: 0, line_end: 2, symbol: "writeState", role: "sink" },
        ],
      }),
    ]);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("must be >= line_start")));
    assert.ok(res.errors.some((e) => e.includes("line_start must be an integer >= 1")));
  });

  it("17. rejects invisible unicode-only text and escapes ANSI diagnostic injection", () => {
    const res = validateFindings([
      makeConfirmed({ title: "\u200B\u00A0" }),
      makeRejected({ fingerprint: "fp-ansi", ["k\x1b[31m"]: "x" }),
    ]);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("visible text")));
    assert.ok(res.errors.some((e) => e.includes("\\u001b") && !e.includes("\x1b")));
  });

  it("18. rejects path traversal and Windows reserved filenames in source_trace & test_file", () => {
    const res = validateFindings([
      makeConfirmed({
        source_trace: [
          { file: "../secret.js", line_start: 1, line_end: 2, symbol: "a", role: "entrypoint" },
          { file: "src/CON.js", line_start: 1, line_end: 2, symbol: "b", role: "sink" },
        ],
        reproducer: { ...makeConfirmed().reproducer, test_file: "/abs/repro.test.cjs" },
      }),
    ]);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("unsafe or empty path segment")));
    assert.ok(res.errors.some((e) => e.includes("Windows reserved path segment")));
    assert.ok(res.errors.some((e) => e.includes("absolute path")));
  });

  it("19. rejects excessive JSON nesting depth (> 64)", () => {
    let deep = { a: 1 };
    for (let i = 0; i < 70; i += 1) deep = { nested: deep };
    const res = validateFindings([makeConfirmed({ extra: deep })]);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("nesting depth exceeds maximum")));
  });

  it("20. enforces --repo-root file existence and line_end bounds across all verdicts", (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chaos-findings-repo-"));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    fs.mkdirSync(path.join(tmpDir, "reproducers"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "server.js"), "line1\nline2\nline3\n");
    fs.writeFileSync(path.join(tmpDir, "store.js"), "line1\nline2\nline3\n");
    fs.writeFileSync(path.join(tmpDir, "reproducers", "double-spend.repro.test.cjs"), "// ok\n");

    const okPath = path.join(tmpDir, "findings-ok.json");
    fs.writeFileSync(okPath, JSON.stringify([makeConfirmed(), makeNeedsValidation(), makeRejected()]));
    const okRes = validateFindingsFile(okPath, { repoRoot: tmpDir });
    assert.equal(okRes.valid, true, JSON.stringify(okRes.errors));

    const badPath = path.join(tmpDir, "findings-oob.json");
    fs.writeFileSync(
      badPath,
      JSON.stringify([
        makeConfirmed({
          reproducer: { ...makeConfirmed().reproducer, test_file: "reproducers/missing.test.cjs" },
          source_trace: [
            { file: "server.js", line_start: 1, line_end: 99, symbol: "h", role: "entrypoint" },
            { file: "missing.js", line_start: 1, line_end: 2, symbol: "w", role: "sink" },
          ],
        }),
        makeRejected({
          mitigating_guard_location: { file: "server.js", line_start: 1, line_end: 50, symbol: "g" },
        }),
      ])
    );
    const badRes = validateFindingsFile(badPath, { repoRoot: tmpDir });
    assert.equal(badRes.valid, false);
    assert.ok(badRes.errors.some((e) => e.includes("exceeds server.js line count")));
    assert.ok(badRes.errors.some((e) => e.includes("missing.js")));
    assert.ok(badRes.errors.some((e) => e.includes("reproducers/missing.test.cjs")));
  });

  it("21. enforces --ledger cross-checks (unit ID existence & fingerprint registration)", (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chaos-findings-ledger-"));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    fs.mkdirSync(path.join(tmpDir, "reproducers"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "server.js"), "line1\nline2\nline3\n");
    fs.writeFileSync(path.join(tmpDir, "store.js"), "line1\nline2\nline3\n");
    fs.writeFileSync(path.join(tmpDir, "reproducers", "double-spend.repro.test.cjs"), "// ok\n");

    const ledgerPath = path.join(tmpDir, "fault-ledger.json");
    fs.writeFileSync(
      ledgerPath,
      JSON.stringify({
        schema_version: "1.0",
        run_id: "run-1",
        target_commit: "head",
        units: [
          {
            fault_unit_id: "fu-checkout-wallet-001",
            canonical_refs: {
              surface: "POST /checkout",
              state_store: "wallets.json",
              subsystem: "billing",
              failure_class: "toctou_race",
            },
            invariant: "Balance >= 0",
            starting_paths: ["server.js"],
            selected_playbooks: ["FAILURE-CLASSES.md"],
            excluded_playbooks: [],
            prior_status: "none",
            attempts: [],
            wave: 1,
            status: "candidate",
            agent_id: "hunter-1",
            reviewed_paths: ["server.js", "store.js"],
            reproducer_checks: ["checked"],
            result_fingerprints: ["fp-checkout-toctou-001"],
            unresolved: [],
          },
          {
            fault_unit_id: "fu-refund-guard-003",
            canonical_refs: {
              surface: "POST /refund",
              state_store: "refunds",
              subsystem: "billing",
              failure_class: "non_idempotent_retry",
            },
            invariant: "At most 1 refund per orderId",
            starting_paths: ["server.js"],
            selected_playbooks: ["FAILURE-CLASSES.md"],
            excluded_playbooks: [],
            prior_status: "none",
            attempts: [],
            wave: 1,
            status: "covered",
            agent_id: "hunter-2",
            reviewed_paths: ["server.js"],
            reproducer_checks: ["Verified synchronous guard"],
            result_fingerprints: [],
            unresolved: [],
          },
        ],
      })
    );

    const okPath = path.join(tmpDir, "findings-ok.json");
    fs.writeFileSync(okPath, JSON.stringify([makeConfirmed(), makeRejected()]));

    const cliOk = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "validate-findings.cjs"),
        "--repo-root",
        tmpDir,
        "--ledger",
        ledgerPath,
        okPath,
      ],
      { encoding: "utf-8" }
    );
    assert.equal(cliOk.status, 0, cliOk.stderr);
    assert.match(cliOk.stdout, /VALID findings/);

    // Missing unit ID and unregistered fingerprint
    const unlinkedPath = path.join(tmpDir, "findings-unlinked.json");
    fs.writeFileSync(
      unlinkedPath,
      JSON.stringify([
        makeConfirmed({ fingerprint: "fp-unregistered-999" }),
        makeNeedsValidation({ fault_unit_ids: ["fu-missing-id"] }),
      ])
    );
    const cliFail = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "validate-findings.cjs"),
        "--repo-root",
        tmpDir,
        "--ledger",
        ledgerPath,
        unlinkedPath,
      ],
      { encoding: "utf-8" }
    );
    assert.equal(cliFail.status, 1);
    assert.match(cliFail.stderr, /not registered in result_fingerprints/);
    assert.match(cliFail.stderr, /not found in fault-ledger/);
  });

  it("22. fails gracefully when referenced --ledger is invalid JSON", (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chaos-findings-badledger-"));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    const ledgerPath = path.join(tmpDir, "bad-ledger.json");
    fs.writeFileSync(ledgerPath, JSON.stringify({ broken: true }));
    const findingsPath = path.join(tmpDir, "findings.json");
    fs.writeFileSync(findingsPath, JSON.stringify([makeRejected()]));

    const res = validateFindingsFile(findingsPath, { ledgerPath });
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("Referenced --ledger failed validation")));
  });

  it("23. fails gracefully on missing or malformed findings JSON file", (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chaos-findings-badfile-"));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    const badJson = path.join(tmpDir, "syntax.json");
    fs.writeFileSync(badJson, "[{broken");
    assert.equal(validateFindingsFile(badJson).valid, false);
    assert.equal(validateFindingsFile(path.join(tmpDir, "nope.json")).valid, false);
  });

  it("24. supports --artifacts-root for reproducers stored outside read-only --repo-root", (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chaos-findings-art-"));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    const repoDir = path.join(tmpDir, "target-repo");
    const outDir = path.join(tmpDir, "audit-out");
    fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(path.join(outDir, "agents", "v1", "scratch"), { recursive: true });
    fs.writeFileSync(path.join(repoDir, "server.js"), "line1\nline2\nline3\n");
    fs.writeFileSync(path.join(repoDir, "store.js"), "line1\nline2\nline3\n");
    fs.writeFileSync(
      path.join(outDir, "agents", "v1", "scratch", "double-spend.repro.test.cjs"),
      "// scratch reproducer\n"
    );

    const findingsPath = path.join(outDir, "findings.json");
    fs.writeFileSync(
      findingsPath,
      JSON.stringify([
        makeConfirmed({
          reproducer: {
            ...makeConfirmed().reproducer,
            test_file: "agents/v1/scratch/double-spend.repro.test.cjs",
          },
        }),
      ])
    );

    const cliOk = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "validate-findings.cjs"),
        "--repo-root",
        repoDir,
        "--artifacts-root",
        outDir,
        findingsPath,
      ],
      { encoding: "utf-8" }
    );
    assert.equal(cliOk.status, 0, cliOk.stderr);
    assert.match(cliOk.stdout, /VALID findings/);
  });

  it("25. supports --help and --json machine-readable output on pass and fail", (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chaos-findings-json-"));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    const helpRun = spawnSync(
      process.execPath,
      [path.join(__dirname, "validate-findings.cjs"), "--help"],
      { encoding: "utf-8" }
    );
    assert.equal(helpRun.status, 0);
    assert.match(helpRun.stdout, /--artifacts-root/);

    const okPath = path.join(tmpDir, "ok.json");
    fs.writeFileSync(okPath, JSON.stringify([makeRejected()]));
    const jsonOk = spawnSync(
      process.execPath,
      [path.join(__dirname, "validate-findings.cjs"), "--json", okPath],
      { encoding: "utf-8" }
    );
    assert.equal(jsonOk.status, 0);
    const parsedOk = JSON.parse(jsonOk.stdout);
    assert.equal(parsedOk.valid, true);
    assert.equal(parsedOk.stats.verdicts.rejected, 1);

    const badPath = path.join(tmpDir, "bad.json");
    fs.writeFileSync(badPath, JSON.stringify([makeRejected({ severity: "high" })]));
    const jsonFail = spawnSync(
      process.execPath,
      [path.join(__dirname, "validate-findings.cjs"), "--json", badPath],
      { encoding: "utf-8" }
    );
    assert.equal(jsonFail.status, 1);
    const parsedFail = JSON.parse(jsonFail.stdout);
    assert.equal(parsedFail.valid, false);
    assert.ok(parsedFail.errors.some((e) => e.includes("severity must be null")));
  });
});
