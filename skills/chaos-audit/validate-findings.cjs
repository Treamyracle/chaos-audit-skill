#!/usr/bin/env node
"use strict";

/**
 * Zero-dependency deterministic validator for findings.json.
 * Usage: node validate-findings.cjs [--repo-root <dir>] [--artifacts-root <dir>] [--ledger <fault-ledger.json>] [--json] [--help] <findings.json>
 */

const fs = require("node:fs");
const path = require("node:path");
const { TextDecoder } = require("node:util");
const {
  escapeUnsafeDiagnosticCharacters,
  validateSafeRepoRelativePath,
  validateFaultLedgerFile,
} = require("./validate-fault-ledger.cjs");

const LIMITS = Object.freeze({
  inputBytes: 5 * 1024 * 1024,
  findings: 5000,
  collectionItems: 500,
  nestingDepth: 64,
  validationErrors: 100,
  maxTextLength: 16384,
});

const CONFIRMED_FIELDS = new Set([
  "verdict",
  "fingerprint",
  "fault_unit_ids",
  "title",
  "failure_class",
  "severity",
  "blast_radius",
  "trigger_likelihood",
  "broken_invariant",
  "root_cause",
  "source_trace",
  "reproducer",
  "disprover_notes",
  "minimal_fix",
  "regression_test_strategy",
]);

const NEEDS_VALIDATION_FIELDS = new Set([
  "verdict",
  "fingerprint",
  "fault_unit_ids",
  "title",
  "failure_class",
  "severity",
  "broken_invariant",
  "root_cause",
  "source_trace",
  "unresolved_fact",
  "why_blocked",
  "safe_verification_recipe",
]);

const REJECTED_FIELDS = new Set([
  "verdict",
  "fingerprint",
  "fault_unit_ids",
  "title",
  "failure_class",
  "severity",
  "disprover_evidence",
  "mitigating_guard_location",
  "rejection_reason",
]);

const TRACE_FIELDS = new Set(["file", "line_start", "line_end", "symbol", "role"]);
const GUARD_FIELDS = new Set(["file", "line_start", "line_end", "symbol"]);
const REPRODUCER_FIELDS = new Set([
  "kind",
  "command",
  "test_file",
  "runs_executed",
  "runs_failed",
  "observed_failure_output",
]);

const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const REPRODUCER_KINDS = new Set(["concurrent_test", "fault_injection", "deterministic_trace"]);
const FINGERPRINT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;
const VISIBLE_CONTENT = /[^\p{White_Space}\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function safeQuote(value) {
  if (typeof value === "string") {
    const clipped = value.length > 256 ? `${value.slice(0, 256)}...` : value;
    return escapeUnsafeDiagnosticCharacters(JSON.stringify(clipped));
  }
  return escapeUnsafeDiagnosticCharacters(String(value));
}

function createErrorList() {
  const errors = [];
  Object.defineProperty(errors, "push", {
    value(...msgs) {
      const rem = LIMITS.validationErrors - this.length;
      if (rem > 0) {
        Array.prototype.push.apply(
          this,
          msgs.slice(0, rem).map(escapeUnsafeDiagnosticCharacters)
        );
      }
      return this.length;
    },
  });
  return errors;
}

function checkMaxDepth(root, maxDepth) {
  const stack = [{ node: root, depth: 1 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop();
    if (depth > maxDepth) return false;
    if (Array.isArray(node)) {
      for (const item of node) {
        if (item !== null && typeof item === "object") {
          stack.push({ node: item, depth: depth + 1 });
        }
      }
    } else if (isPlainObject(node)) {
      for (const k of Object.keys(node)) {
        const val = node[k];
        if (val !== null && typeof val === "object") {
          stack.push({ node: val, depth: depth + 1 });
        }
      }
    }
  }
  return true;
}

function validateText(value, fieldPath, errors, maxLen = LIMITS.maxTextLength) {
  if (typeof value !== "string") {
    errors.push(`${fieldPath} must be a string`);
    return false;
  }
  if (value.length === 0 || !VISIBLE_CONTENT.test(value)) {
    errors.push(`${fieldPath} must contain non-whitespace visible text`);
    return false;
  }
  if (value.length > maxLen) {
    errors.push(`${fieldPath} exceeds maximum length (${maxLen})`);
    return false;
  }
  return true;
}

function isWithinRoot(rootAbs, relNormalized) {
  const full = path.resolve(rootAbs, relNormalized);
  const relBack = path.relative(rootAbs, full);
  if (relBack.startsWith("..") || path.isAbsolute(relBack)) {
    return { escaped: true, full };
  }
  return { escaped: false, full };
}

function getRepoFileLineCount(repoRootAbs, relNormalized, lineCountCache, fieldPath, errors) {
  const { escaped, full } = isWithinRoot(repoRootAbs, relNormalized);
  if (escaped) {
    errors.push(`${fieldPath} escapes --repo-root: ${safeQuote(relNormalized)}`);
    return null;
  }
  if (!fs.existsSync(full)) {
    errors.push(`${fieldPath} does not exist under --repo-root: ${safeQuote(relNormalized)}`);
    return null;
  }
  if (lineCountCache.has(full)) {
    return lineCountCache.get(full);
  }
  const content = fs.readFileSync(full, "utf-8");
  const lines = content.length === 0 ? 0 : content.split(/\r?\n/).length;
  lineCountCache.set(full, lines);
  return lines;
}

function checkReproducerTestFileExists(
  normTest,
  fieldPath,
  { repoRootAbs, artifactsRootAbs, findingsDirAbs },
  errors
) {
  const candidateRoots = [];
  if (artifactsRootAbs) candidateRoots.push({ label: "--artifacts-root", root: artifactsRootAbs });
  if (repoRootAbs) candidateRoots.push({ label: "--repo-root", root: repoRootAbs });
  if (!artifactsRootAbs && findingsDirAbs) {
    candidateRoots.push({ label: "findings directory", root: findingsDirAbs });
  }
  if (candidateRoots.length === 0) return;

  for (const { label, root } of candidateRoots) {
    const { escaped, full } = isWithinRoot(root, normTest);
    if (escaped) {
      errors.push(`${fieldPath} escapes ${label}: ${safeQuote(normTest)}`);
      return;
    }
    if (fs.existsSync(full)) {
      return;
    }
  }

  const labels = candidateRoots.map((c) => c.label).join(" or ");
  errors.push(`${fieldPath} does not exist under ${labels}: ${safeQuote(normTest)}`);
}

function validateLocationObject(
  loc,
  fieldPath,
  requiredSet,
  errors,
  repoRootAbs,
  lineCountCache
) {
  if (!isPlainObject(loc)) {
    errors.push(`${fieldPath} must be an object`);
    return;
  }
  for (const key of requiredSet) {
    if (!hasOwn(loc, key)) {
      errors.push(`${fieldPath} missing required field: ${key}`);
    }
  }
  for (const key of Object.keys(loc)) {
    if (!requiredSet.has(key)) {
      errors.push(`${fieldPath} has unexpected field: ${safeQuote(key)}`);
    }
  }

  let normFile = null;
  if (hasOwn(loc, "file")) {
    normFile = validateSafeRepoRelativePath(loc.file, `${fieldPath}.file`, errors);
  }
  if (hasOwn(loc, "line_start") && (!Number.isInteger(loc.line_start) || loc.line_start < 1)) {
    errors.push(`${fieldPath}.line_start must be an integer >= 1`);
  }
  if (hasOwn(loc, "line_end") && (!Number.isInteger(loc.line_end) || loc.line_end < 1)) {
    errors.push(`${fieldPath}.line_end must be an integer >= 1`);
  }
  if (
    Number.isInteger(loc.line_start) &&
    Number.isInteger(loc.line_end) &&
    loc.line_end < loc.line_start
  ) {
    errors.push(`${fieldPath}.line_end (${loc.line_end}) must be >= line_start (${loc.line_start})`);
  }
  if (hasOwn(loc, "symbol")) {
    validateText(loc.symbol, `${fieldPath}.symbol`, errors, 512);
  }
  if (requiredSet.has("role") && hasOwn(loc, "role")) {
    validateText(loc.role, `${fieldPath}.role`, errors, 512);
  }

  if (repoRootAbs && normFile) {
    const totalLines = getRepoFileLineCount(
      repoRootAbs,
      normFile,
      lineCountCache,
      `${fieldPath}.file`,
      errors
    );
    if (totalLines !== null && Number.isInteger(loc.line_end) && loc.line_end > totalLines) {
      errors.push(
        `${fieldPath}.line_end (${loc.line_end}) exceeds ${normFile} line count (${totalLines})`
      );
    }
  }
}

function validateFindingFieldsShape(item, base, requiredSet, errors) {
  for (const req of requiredSet) {
    if (!hasOwn(item, req)) {
      errors.push(`${base} missing required field: ${req}`);
    }
  }
  for (const key of Object.keys(item)) {
    if (!requiredSet.has(key)) {
      errors.push(`${base} has unexpected field for verdict "${item.verdict}": ${safeQuote(key)}`);
    }
  }
}

function validateFindings(doc, options = {}) {
  const errors = createErrorList();
  const repoRootAbs = options.repoRoot ? path.resolve(options.repoRoot) : null;
  const artifactsRootAbs = options.artifactsRoot ? path.resolve(options.artifactsRoot) : null;
  const findingsDirAbs = options.findingsDir ? path.resolve(options.findingsDir) : null;
  const lineCountCache = new Map();

  let ledgerUnitMap = null;
  if (options.ledgerDoc) {
    ledgerUnitMap = new Map();
    for (const u of options.ledgerDoc.units || []) {
      ledgerUnitMap.set(u.fault_unit_id, new Set(u.result_fingerprints || []));
    }
  }

  if (!Array.isArray(doc)) {
    errors.push("Root findings document must be a JSON array");
    return { valid: false, errors, stats: null };
  }
  if (!checkMaxDepth(doc, LIMITS.nestingDepth)) {
    errors.push(`JSON nesting depth exceeds maximum (${LIMITS.nestingDepth})`);
    return { valid: false, errors, stats: null };
  }
  if (doc.length > LIMITS.findings) {
    errors.push(`findings array exceeds maximum (${LIMITS.findings})`);
    return { valid: false, errors, stats: null };
  }

  const seenFingerprints = new Set();
  const verdictCounts = { confirmed: 0, needs_validation: 0, rejected: 0 };
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };

  for (let i = 0; i < doc.length; i += 1) {
    const item = doc[i];
    const base = `findings[${i}]`;
    if (!isPlainObject(item)) {
      errors.push(`${base} must be an object`);
      continue;
    }

    const verdict = item.verdict;
    if (verdict === "confirmed") {
      validateFindingFieldsShape(item, base, CONFIRMED_FIELDS, errors);
      verdictCounts.confirmed += 1;
    } else if (verdict === "needs_validation") {
      validateFindingFieldsShape(item, base, NEEDS_VALIDATION_FIELDS, errors);
      verdictCounts.needs_validation += 1;
    } else if (verdict === "rejected") {
      validateFindingFieldsShape(item, base, REJECTED_FIELDS, errors);
      verdictCounts.rejected += 1;
    } else {
      errors.push(`${base}.verdict must be "confirmed", "needs_validation", or "rejected"`);
      continue;
    }

    if (hasOwn(item, "fingerprint")) {
      if (typeof item.fingerprint !== "string" || !FINGERPRINT_PATTERN.test(item.fingerprint)) {
        errors.push(`${base}.fingerprint must match ${FINGERPRINT_PATTERN}`);
      } else if (seenFingerprints.has(item.fingerprint)) {
        errors.push(`${base}.fingerprint is duplicated: ${safeQuote(item.fingerprint)}`);
      } else {
        seenFingerprints.add(item.fingerprint);
      }
    }

    if (hasOwn(item, "fault_unit_ids")) {
      if (!Array.isArray(item.fault_unit_ids) || item.fault_unit_ids.length === 0) {
        errors.push(`${base}.fault_unit_ids must be a non-empty array`);
      } else if (item.fault_unit_ids.length > LIMITS.collectionItems) {
        errors.push(`${base}.fault_unit_ids exceeds max items`);
      } else {
        let linkedToFingerprint = false;
        for (let uIdx = 0; uIdx < item.fault_unit_ids.length; uIdx += 1) {
          const uid = item.fault_unit_ids[uIdx];
          if (validateText(uid, `${base}.fault_unit_ids[${uIdx}]`, errors, 128) && ledgerUnitMap) {
            if (!ledgerUnitMap.has(uid)) {
              errors.push(`${base}.fault_unit_ids[${uIdx}] not found in fault-ledger: ${safeQuote(uid)}`);
            } else if (
              typeof item.fingerprint === "string" &&
              ledgerUnitMap.get(uid).has(item.fingerprint)
            ) {
              linkedToFingerprint = true;
            }
          }
        }
        if (
          ledgerUnitMap &&
          (verdict === "confirmed" || verdict === "needs_validation") &&
          typeof item.fingerprint === "string" &&
          !linkedToFingerprint
        ) {
          errors.push(
            `${base}.fingerprint (${safeQuote(item.fingerprint)}) is not registered in result_fingerprints of its referenced fault_unit_ids`
          );
        }
      }
    }

    if (hasOwn(item, "title")) validateText(item.title, `${base}.title`, errors, 512);
    if (hasOwn(item, "failure_class")) {
      validateText(item.failure_class, `${base}.failure_class`, errors, 128);
    }

    if (verdict === "confirmed") {
      if (!SEVERITIES.has(item.severity)) {
        errors.push(`${base}.severity must be one of critical|high|medium|low`);
      } else {
        severityCounts[item.severity] += 1;
      }
      for (const tf of [
        "blast_radius",
        "trigger_likelihood",
        "broken_invariant",
        "root_cause",
        "disprover_notes",
        "minimal_fix",
        "regression_test_strategy",
      ]) {
        if (hasOwn(item, tf)) validateText(item[tf], `${base}.${tf}`, errors);
      }

      if (hasOwn(item, "source_trace")) {
        if (!Array.isArray(item.source_trace) || item.source_trace.length < 2) {
          errors.push(`${base}.source_trace must contain at least 2 hops (entrypoint -> sink)`);
        } else {
          for (let t = 0; t < item.source_trace.length; t += 1) {
            validateLocationObject(
              item.source_trace[t],
              `${base}.source_trace[${t}]`,
              TRACE_FIELDS,
              errors,
              repoRootAbs,
              lineCountCache
            );
          }
        }
      }

      if (hasOwn(item, "reproducer")) {
        const rep = item.reproducer;
        const rBase = `${base}.reproducer`;
        if (!isPlainObject(rep)) {
          errors.push(`${rBase} must be an object`);
        } else {
          for (const rf of REPRODUCER_FIELDS) {
            if (!hasOwn(rep, rf)) errors.push(`${rBase} missing field: ${rf}`);
          }
          for (const key of Object.keys(rep)) {
            if (!REPRODUCER_FIELDS.has(key)) {
              errors.push(`${rBase} has unexpected field: ${safeQuote(key)}`);
            }
          }
          if (hasOwn(rep, "kind") && !REPRODUCER_KINDS.has(rep.kind)) {
            errors.push(`${rBase}.kind invalid: ${safeQuote(rep.kind)}`);
          }
          if (hasOwn(rep, "command")) validateText(rep.command, `${rBase}.command`, errors, 2048);
          if (hasOwn(rep, "test_file")) {
            const normTest = validateSafeRepoRelativePath(rep.test_file, `${rBase}.test_file`, errors);
            if (normTest) {
              checkReproducerTestFileExists(
                normTest,
                `${rBase}.test_file`,
                { repoRootAbs, artifactsRootAbs, findingsDirAbs },
                errors
              );
            }
          }
          if (
            hasOwn(rep, "runs_executed") &&
            (!Number.isInteger(rep.runs_executed) || rep.runs_executed < 1)
          ) {
            errors.push(`${rBase}.runs_executed must be an integer >= 1`);
          }
          if (
            hasOwn(rep, "runs_failed") &&
            (!Number.isInteger(rep.runs_failed) || rep.runs_failed < 1)
          ) {
            errors.push(`${rBase}.runs_failed must be an integer >= 1`);
          }
          if (
            Number.isInteger(rep.runs_executed) &&
            Number.isInteger(rep.runs_failed) &&
            rep.runs_failed > rep.runs_executed
          ) {
            errors.push(`${rBase}.runs_failed (${rep.runs_failed}) cannot exceed runs_executed (${rep.runs_executed})`);
          }
          if (hasOwn(rep, "observed_failure_output")) {
            validateText(rep.observed_failure_output, `${rBase}.observed_failure_output`, errors);
          }
        }
      }
    } else if (verdict === "needs_validation") {
      if (item.severity !== null) {
        errors.push(`${base}.severity must be null for needs_validation verdicts`);
      }
      for (const tf of [
        "broken_invariant",
        "root_cause",
        "unresolved_fact",
        "why_blocked",
        "safe_verification_recipe",
      ]) {
        if (hasOwn(item, tf)) validateText(item[tf], `${base}.${tf}`, errors);
      }
      if (hasOwn(item, "source_trace")) {
        if (!Array.isArray(item.source_trace) || item.source_trace.length < 1) {
          errors.push(`${base}.source_trace must contain at least 1 location`);
        } else {
          for (let t = 0; t < item.source_trace.length; t += 1) {
            validateLocationObject(
              item.source_trace[t],
              `${base}.source_trace[${t}]`,
              TRACE_FIELDS,
              errors,
              repoRootAbs,
              lineCountCache
            );
          }
        }
      }
    } else if (verdict === "rejected") {
      if (item.severity !== null) {
        errors.push(`${base}.severity must be null for rejected verdicts`);
      }
      for (const tf of ["disprover_evidence", "rejection_reason"]) {
        if (hasOwn(item, tf)) validateText(item[tf], `${base}.${tf}`, errors);
      }
      if (hasOwn(item, "mitigating_guard_location")) {
        validateLocationObject(
          item.mitigating_guard_location,
          `${base}.mitigating_guard_location`,
          GUARD_FIELDS,
          errors,
          repoRootAbs,
          lineCountCache
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      total_findings: doc.length,
      verdicts: verdictCounts,
      severities: severityCounts,
    },
  };
}

function parseJsonFileStrict(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > LIMITS.inputBytes) {
    throw new Error(`Input file exceeds max size (${LIMITS.inputBytes} bytes)`);
  }
  const buf = fs.readFileSync(filePath);
  return JSON.parse(UTF8_DECODER.decode(buf));
}

function validateFindingsFile(filePath, options = {}) {
  let doc;
  try {
    doc = parseJsonFileStrict(filePath);
  } catch (err) {
    return {
      valid: false,
      errors: [escapeUnsafeDiagnosticCharacters(`Failed to load ${filePath}: ${err.message}`)],
      stats: null,
    };
  }

  let ledgerDoc = options.ledgerDoc || null;
  if (!ledgerDoc && options.ledgerPath) {
    const ledgerCheck = validateFaultLedgerFile(options.ledgerPath, { repoRoot: options.repoRoot });
    if (!ledgerCheck.valid) {
      return {
        valid: false,
        errors: [
          `Referenced --ledger failed validation: ${ledgerCheck.errors.join("; ")}`,
        ],
        stats: null,
      };
    }
    ledgerDoc = parseJsonFileStrict(options.ledgerPath);
  }

  return validateFindings(doc, {
    repoRoot: options.repoRoot,
    artifactsRoot: options.artifactsRoot,
    findingsDir: path.dirname(path.resolve(filePath)),
    ledgerDoc,
  });
}

function parseCliArgs(argv) {
  let repoRoot = null;
  let artifactsRoot = null;
  let ledgerPath = null;
  let jsonOutput = false;
  let help = false;
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--json") {
      jsonOutput = true;
    } else if (arg === "--repo-root") {
      if (i + 1 >= argv.length) throw new Error("--repo-root requires a path");
      repoRoot = argv[i + 1];
      i += 1;
    } else if (arg === "--artifacts-root") {
      if (i + 1 >= argv.length) throw new Error("--artifacts-root requires a path");
      artifactsRoot = argv[i + 1];
      i += 1;
    } else if (arg === "--ledger") {
      if (i + 1 >= argv.length) throw new Error("--ledger requires a path");
      ledgerPath = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (help) {
    return { help: true, jsonOutput, repoRoot, artifactsRoot, ledgerPath, findingsPath: null };
  }
  if (positional.length !== 1) {
    throw new Error(
      "Usage: node validate-findings.cjs [--repo-root <dir>] [--artifacts-root <dir>] [--ledger <fault-ledger.json>] [--json] [--help] <findings.json>"
    );
  }
  return {
    help: false,
    jsonOutput,
    repoRoot,
    artifactsRoot,
    ledgerPath,
    findingsPath: positional[0],
  };
}

if (require.main === module) {
  let wantJson = false;
  try {
    const { help, jsonOutput, repoRoot, artifactsRoot, ledgerPath, findingsPath } = parseCliArgs(
      process.argv.slice(2)
    );
    wantJson = jsonOutput;
    if (help) {
      console.log(
        "Usage: node validate-findings.cjs [--repo-root <dir>] [--artifacts-root <dir>] [--ledger <fault-ledger.json>] [--json] [--help] <findings.json>"
      );
      process.exit(0);
    }
    const result = validateFindingsFile(findingsPath, { repoRoot, artifactsRoot, ledgerPath });
    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.valid ? 0 : 1);
    }
    if (!result.valid) {
      console.error(`INVALID findings (${result.errors.length} error(s)):`);
      for (const e of result.errors) {
        console.error(`  - ${e}`);
      }
      process.exit(1);
    }
    console.log(
      `VALID findings: ${result.stats.total_findings} record(s) ` +
        `(confirmed=${result.stats.verdicts.confirmed}, ` +
        `needs_validation=${result.stats.verdicts.needs_validation}, ` +
        `rejected=${result.stats.verdicts.rejected})`
    );
    process.exit(0);
  } catch (err) {
    const msg = escapeUnsafeDiagnosticCharacters(err.message);
    if (wantJson) {
      console.log(JSON.stringify({ valid: false, errors: [msg], stats: null }, null, 2));
    } else {
      console.error(msg);
    }
    process.exit(1);
  }
}

module.exports = {
  LIMITS,
  SEVERITIES,
  REPRODUCER_KINDS,
  validateFindings,
  validateFindingsFile,
};
