#!/usr/bin/env node
"use strict";

/**
 * Zero-dependency deterministic validator for fault-ledger.json.
 * Usage: node validate-fault-ledger.cjs [--repo-root <dir>] <fault-ledger.json>
 */

const fs = require("node:fs");
const path = require("node:path");
const { TextDecoder } = require("node:util");

const LIMITS = Object.freeze({
  inputBytes: 5 * 1024 * 1024,
  units: 10000,
  collectionItems: 1000,
  nestingDepth: 64,
  validationErrors: 100,
  maxTextLength: 8192,
});

const REQUIRED_TOP_FIELDS = ["schema_version", "run_id", "target_commit", "units"];
const TOP_FIELD_SET = new Set(REQUIRED_TOP_FIELDS);

const REQUIRED_UNIT_FIELDS = [
  "fault_unit_id",
  "canonical_refs",
  "invariant",
  "starting_paths",
  "selected_playbooks",
  "excluded_playbooks",
  "prior_status",
  "attempts",
  "wave",
  "status",
  "agent_id",
  "reviewed_paths",
  "reproducer_checks",
  "result_fingerprints",
  "unresolved",
];
const UNIT_FIELD_SET = new Set(REQUIRED_UNIT_FIELDS);

const REF_FIELDS = ["surface", "state_store", "subsystem", "failure_class"];
const REF_FIELD_SET = new Set(REF_FIELDS);

const ATTEMPT_FIELDS = [
  "wave",
  "status",
  "agent_id",
  "reviewed_paths",
  "reproducer_checks",
  "result_fingerprints",
  "unresolved",
  "reassignment_reason",
];
const ATTEMPT_FIELD_SET = new Set(ATTEMPT_FIELDS);

const STATUSES = new Set([
  "planned",
  "not_applicable",
  "out_of_scope",
  "in_progress",
  "covered",
  "candidate",
  "blocked",
  "deferred",
]);
const ATTEMPT_STATUSES = new Set(["covered", "candidate", "blocked"]);
const PRIOR_STATUSES = new Set([
  "none",
  "new",
  "prior_confirmed_same_source",
  "prior_confirmed_changed_source",
  "prior_needs_validation",
  "prior_deferred",
  "prior_blocked",
  "prior_out_of_scope",
  "prior_covered_same_source",
  "prior_covered_changed_source",
  "prior_rejected_same_source",
  "prior_rejected_changed_source",
]);

const UNIT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const FINGERPRINT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;
const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const WINDOWS_RESERVED_AGENT_ID = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const WINDOWS_RESERVED_COMPONENT = /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/iu;
const VISIBLE_CONTENT = /[^\p{White_Space}\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u;
const PATH_FORBIDDEN_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
const UNSAFE_DIAGNOSTIC_CHARACTER = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/gu;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function escapeUnsafeDiagnosticCharacters(value) {
  return String(value).replace(UNSAFE_DIAGNOSTIC_CHARACTER, (ch) => {
    const cp = ch.codePointAt(0);
    return cp <= 0xffff
      ? `\\u${cp.toString(16).padStart(4, "0")}`
      : `\\u{${cp.toString(16)}}`;
  });
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

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function checkMaxDepth(root, maxDepth) {
  const stack = [{ node: root, depth: 1 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop();
    if (depth > maxDepth) {
      return false;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        if (item !== null && typeof item === "object") {
          stack.push({ node: item, depth: depth + 1 });
        }
      }
    } else if (isPlainObject(node)) {
      for (const key of Object.keys(node)) {
        const val = node[key];
        if (val !== null && typeof val === "object") {
          stack.push({ node: val, depth: depth + 1 });
        }
      }
    }
  }
  return true;
}

function validateNonEmptyVisibleString(value, fieldPath, errors, maxLen = LIMITS.maxTextLength) {
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

function validateAgentId(value, fieldPath, errors) {
  if (typeof value !== "string" || !AGENT_ID_PATTERN.test(value)) {
    errors.push(`${fieldPath} must match ${AGENT_ID_PATTERN}`);
    return false;
  }
  if (WINDOWS_RESERVED_AGENT_ID.test(value)) {
    errors.push(`${fieldPath} uses a Windows reserved device name: ${safeQuote(value)}`);
    return false;
  }
  return true;
}

function validateSafeRepoRelativePath(rawPath, fieldPath, errors) {
  if (!validateNonEmptyVisibleString(rawPath, fieldPath, errors, 1024)) {
    return null;
  }
  if (PATH_FORBIDDEN_CHARACTER.test(rawPath)) {
    errors.push(`${fieldPath} contains forbidden control or bidi characters`);
    return null;
  }
  const normalized = rawPath.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    errors.push(`${fieldPath} must be repository-relative, got absolute path ${safeQuote(rawPath)}`);
    return null;
  }
  const segments = normalized.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") {
      errors.push(`${fieldPath} contains unsafe or empty path segment in ${safeQuote(rawPath)}`);
      return null;
    }
    if (WINDOWS_RESERVED_COMPONENT.test(seg)) {
      errors.push(`${fieldPath} contains Windows reserved path segment ${safeQuote(seg)}`);
      return null;
    }
  }
  return segments.join("/");
}

function validateStringList(arr, fieldPath, errors, { minItems = 0, itemValidator } = {}) {
  if (!Array.isArray(arr)) {
    errors.push(`${fieldPath} must be an array`);
    return [];
  }
  if (arr.length < minItems) {
    errors.push(`${fieldPath} must contain at least ${minItems} item(s)`);
  }
  if (arr.length > LIMITS.collectionItems) {
    errors.push(`${fieldPath} exceeds max items (${LIMITS.collectionItems})`);
    return [];
  }
  const clean = [];
  for (let i = 0; i < arr.length; i += 1) {
    const itemPath = `${fieldPath}[${i}]`;
    if (itemValidator) {
      const res = itemValidator(arr[i], itemPath, errors);
      if (res !== null) clean.push(res);
    } else if (validateNonEmptyVisibleString(arr[i], itemPath, errors)) {
      clean.push(arr[i]);
    }
  }
  return clean;
}

function checkRepoFileExists(repoRootAbs, relNormalized, fieldPath, errors) {
  const full = path.resolve(repoRootAbs, relNormalized);
  const relBack = path.relative(repoRootAbs, full);
  if (relBack.startsWith("..") || path.isAbsolute(relBack)) {
    errors.push(`${fieldPath} escapes --repo-root: ${safeQuote(relNormalized)}`);
    return;
  }
  if (!fs.existsSync(full)) {
    errors.push(`${fieldPath} does not exist under --repo-root: ${safeQuote(relNormalized)}`);
  }
}

function validateFaultLedger(doc, options = {}) {
  const errors = createErrorList();
  const repoRootAbs = options.repoRoot ? path.resolve(options.repoRoot) : null;

  if (!isPlainObject(doc)) {
    errors.push("Root document must be a JSON object");
    return { valid: false, errors, stats: null };
  }
  if (!checkMaxDepth(doc, LIMITS.nestingDepth)) {
    errors.push(`JSON nesting depth exceeds maximum (${LIMITS.nestingDepth})`);
    return { valid: false, errors, stats: null };
  }

  for (const key of REQUIRED_TOP_FIELDS) {
    if (!hasOwn(doc, key)) {
      errors.push(`Missing required root field: ${key}`);
    }
  }
  for (const key of Object.keys(doc)) {
    if (!TOP_FIELD_SET.has(key)) {
      errors.push(`Unexpected root field: ${safeQuote(key)}`);
    }
  }

  if (hasOwn(doc, "schema_version") && doc.schema_version !== "1.0") {
    errors.push(`schema_version must be "1.0", got ${safeQuote(doc.schema_version)}`);
  }
  if (hasOwn(doc, "run_id")) {
    validateNonEmptyVisibleString(doc.run_id, "run_id", errors, 256);
  }
  if (hasOwn(doc, "target_commit")) {
    validateNonEmptyVisibleString(doc.target_commit, "target_commit", errors, 128);
  }

  if (!Array.isArray(doc.units)) {
    errors.push("units must be an array");
    return { valid: false, errors, stats: null };
  }
  if (doc.units.length > LIMITS.units) {
    errors.push(`units exceeds maximum (${LIMITS.units})`);
    return { valid: false, errors, stats: null };
  }

  const seenIds = new Set();
  const statusCounts = Object.fromEntries([...STATUSES].map((s) => [s, 0]));

  for (let idx = 0; idx < doc.units.length; idx += 1) {
    const unit = doc.units[idx];
    const base = `units[${idx}]`;
    if (!isPlainObject(unit)) {
      errors.push(`${base} must be an object`);
      continue;
    }

    for (const req of REQUIRED_UNIT_FIELDS) {
      if (!hasOwn(unit, req)) {
        errors.push(`${base} missing required field: ${req}`);
      }
    }
    for (const key of Object.keys(unit)) {
      if (!UNIT_FIELD_SET.has(key)) {
        errors.push(`${base} has unexpected field: ${safeQuote(key)}`);
      }
    }

    if (hasOwn(unit, "fault_unit_id")) {
      if (typeof unit.fault_unit_id !== "string" || !UNIT_ID_PATTERN.test(unit.fault_unit_id)) {
        errors.push(`${base}.fault_unit_id must match ${UNIT_ID_PATTERN}`);
      } else if (seenIds.has(unit.fault_unit_id)) {
        errors.push(`${base}.fault_unit_id is duplicated: ${safeQuote(unit.fault_unit_id)}`);
      } else {
        seenIds.add(unit.fault_unit_id);
      }
    }

    if (hasOwn(unit, "canonical_refs")) {
      if (!isPlainObject(unit.canonical_refs)) {
        errors.push(`${base}.canonical_refs must be an object`);
      } else {
        for (const rf of REF_FIELDS) {
          if (!hasOwn(unit.canonical_refs, rf)) {
            errors.push(`${base}.canonical_refs missing field: ${rf}`);
          } else {
            validateNonEmptyVisibleString(
              unit.canonical_refs[rf],
              `${base}.canonical_refs.${rf}`,
              errors,
              256
            );
          }
        }
        for (const key of Object.keys(unit.canonical_refs)) {
          if (!REF_FIELD_SET.has(key)) {
            errors.push(`${base}.canonical_refs has unexpected field: ${safeQuote(key)}`);
          }
        }
      }
    }

    if (hasOwn(unit, "invariant")) {
      validateNonEmptyVisibleString(unit.invariant, `${base}.invariant`, errors);
    }

    const startingPaths = hasOwn(unit, "starting_paths")
      ? validateStringList(unit.starting_paths, `${base}.starting_paths`, errors, {
          minItems: 1,
          itemValidator: validateSafeRepoRelativePath,
        })
      : [];
    if (repoRootAbs) {
      for (let pIdx = 0; pIdx < startingPaths.length; pIdx += 1) {
        checkRepoFileExists(repoRootAbs, startingPaths[pIdx], `${base}.starting_paths[${pIdx}]`, errors);
      }
    }

    if (hasOwn(unit, "selected_playbooks")) {
      validateStringList(unit.selected_playbooks, `${base}.selected_playbooks`, errors, {
        minItems: 1,
      });
    }
    if (hasOwn(unit, "excluded_playbooks")) {
      validateStringList(unit.excluded_playbooks, `${base}.excluded_playbooks`, errors);
    }
    if (hasOwn(unit, "prior_status") && !PRIOR_STATUSES.has(unit.prior_status)) {
      errors.push(`${base}.prior_status invalid: ${safeQuote(unit.prior_status)}`);
    }

    if (hasOwn(unit, "attempts")) {
      if (!Array.isArray(unit.attempts)) {
        errors.push(`${base}.attempts must be an array`);
      } else if (unit.attempts.length > LIMITS.collectionItems) {
        errors.push(`${base}.attempts exceeds max items`);
      } else {
        for (let aIdx = 0; aIdx < unit.attempts.length; aIdx += 1) {
          const att = unit.attempts[aIdx];
          const aBase = `${base}.attempts[${aIdx}]`;
          if (!isPlainObject(att)) {
            errors.push(`${aBase} must be an object`);
            continue;
          }
          for (const req of ATTEMPT_FIELDS) {
            if (!hasOwn(att, req)) errors.push(`${aBase} missing field: ${req}`);
          }
          for (const key of Object.keys(att)) {
            if (!ATTEMPT_FIELD_SET.has(key)) {
              errors.push(`${aBase} unexpected field: ${safeQuote(key)}`);
            }
          }
          if (hasOwn(att, "wave") && (!Number.isInteger(att.wave) || att.wave < 1)) {
            errors.push(`${aBase}.wave must be integer >= 1`);
          }
          if (hasOwn(att, "status") && !ATTEMPT_STATUSES.has(att.status)) {
            errors.push(`${aBase}.status invalid: ${safeQuote(att.status)}`);
          }
          if (hasOwn(att, "agent_id")) {
            validateAgentId(att.agent_id, `${aBase}.agent_id`, errors);
          }
          if (hasOwn(att, "reviewed_paths")) {
            validateStringList(att.reviewed_paths, `${aBase}.reviewed_paths`, errors, {
              itemValidator: validateSafeRepoRelativePath,
            });
          }
          if (hasOwn(att, "reproducer_checks")) {
            validateStringList(att.reproducer_checks, `${aBase}.reproducer_checks`, errors);
          }
          if (hasOwn(att, "result_fingerprints")) {
            validateStringList(att.result_fingerprints, `${aBase}.result_fingerprints`, errors);
          }
          if (hasOwn(att, "unresolved")) {
            validateStringList(att.unresolved, `${aBase}.unresolved`, errors);
          }
          if (hasOwn(att, "reassignment_reason")) {
            validateNonEmptyVisibleString(
              att.reassignment_reason,
              `${aBase}.reassignment_reason`,
              errors
            );
          }
        }
      }
    }

    const wave = unit.wave;
    if (hasOwn(unit, "wave")) {
      if (wave !== null && (!Number.isInteger(wave) || wave < 0)) {
        errors.push(`${base}.wave must be null or an integer >= 0`);
      }
    }

    const status = unit.status;
    if (!STATUSES.has(status)) {
      errors.push(`${base}.status invalid: ${safeQuote(status)}`);
    } else {
      statusCounts[status] += 1;
    }

    if (hasOwn(unit, "agent_id") && unit.agent_id !== null) {
      validateAgentId(unit.agent_id, `${base}.agent_id`, errors);
    }

    const reviewedPaths = hasOwn(unit, "reviewed_paths")
      ? validateStringList(unit.reviewed_paths, `${base}.reviewed_paths`, errors, {
          itemValidator: validateSafeRepoRelativePath,
        })
      : [];
    if (repoRootAbs) {
      for (let rIdx = 0; rIdx < reviewedPaths.length; rIdx += 1) {
        checkRepoFileExists(repoRootAbs, reviewedPaths[rIdx], `${base}.reviewed_paths[${rIdx}]`, errors);
      }
    }

    const reproChecks = hasOwn(unit, "reproducer_checks")
      ? validateStringList(unit.reproducer_checks, `${base}.reproducer_checks`, errors)
      : [];

    const fps = hasOwn(unit, "result_fingerprints")
      ? validateStringList(unit.result_fingerprints, `${base}.result_fingerprints`, errors, {
          itemValidator: (fp, fpPath, errs) => {
            if (typeof fp !== "string" || !FINGERPRINT_PATTERN.test(fp)) {
              errs.push(`${fpPath} must match ${FINGERPRINT_PATTERN}`);
              return null;
            }
            return fp;
          },
        })
      : [];

    const unresolved = hasOwn(unit, "unresolved")
      ? validateStringList(unit.unresolved, `${base}.unresolved`, errors)
      : [];

    // Status-specific semantic invariants
    if (status === "planned") {
      if (wave !== 0 && wave !== null) {
        errors.push(`${base} has status "planned" so wave must be 0 or null`);
      }
      if (unit.agent_id !== null) {
        errors.push(`${base} has status "planned" so agent_id must be null`);
      }
    }
    if (status === "in_progress") {
      if (!Number.isInteger(wave) || wave < 1) {
        errors.push(`${base} has status "in_progress" so wave must be >= 1`);
      }
      if (unit.agent_id === null) {
        errors.push(`${base} has status "in_progress" so agent_id must be non-null`);
      }
    }
    if (status === "covered" || status === "candidate") {
      if (!Number.isInteger(wave) || wave < 1) {
        errors.push(`${base} has status "${status}" so wave must be >= 1`);
      }
      if (unit.agent_id === null) {
        errors.push(`${base} has status "${status}" so agent_id must be non-null`);
      }
      if (reviewedPaths.length === 0) {
        errors.push(`${base} has status "${status}" so reviewed_paths must not be empty`);
      }
    }
    if (status === "candidate" && fps.length === 0) {
      errors.push(`${base} has status "candidate" so result_fingerprints must not be empty`);
    }
    if (status === "covered" && reproChecks.length === 0) {
      errors.push(`${base} has status "covered" so reproducer_checks must describe what was checked`);
    }
    if (status === "blocked" && unresolved.length === 0) {
      errors.push(`${base} has status "blocked" so unresolved must list the exact blocker`);
    }
  }

  const total = doc.units.length;
  const terminalCovered = statusCounts.covered + statusCounts.candidate;
  const applicable = total - statusCounts.not_applicable - statusCounts.out_of_scope;
  const coveragePct = applicable > 0 ? Number(((terminalCovered / applicable) * 100).toFixed(1)) : 100.0;

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      total_units: total,
      applicable_units: applicable,
      coverage_pct: coveragePct,
      status_counts: statusCounts,
    },
  };
}

function parseJsonFileStrict(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > LIMITS.inputBytes) {
    throw new Error(`Input file exceeds max size (${LIMITS.inputBytes} bytes)`);
  }
  const buf = fs.readFileSync(filePath);
  const text = UTF8_DECODER.decode(buf);
  return JSON.parse(text);
}

function validateFaultLedgerFile(filePath, options = {}) {
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
  return validateFaultLedger(doc, options);
}

function parseCliArgs(argv) {
  let repoRoot = null;
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
      if (i + 1 >= argv.length) {
        throw new Error("--repo-root requires a directory path");
      }
      repoRoot = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (help) {
    return { help: true, jsonOutput, repoRoot, ledgerPath: null };
  }
  if (positional.length !== 1) {
    throw new Error(
      "Usage: node validate-fault-ledger.cjs [--repo-root <dir>] [--json] [--help] <fault-ledger.json>"
    );
  }
  return { help: false, jsonOutput, repoRoot, ledgerPath: positional[0] };
}

if (require.main === module) {
  let wantJson = false;
  try {
    const { help, jsonOutput, repoRoot, ledgerPath } = parseCliArgs(process.argv.slice(2));
    wantJson = jsonOutput;
    if (help) {
      console.log(
        "Usage: node validate-fault-ledger.cjs [--repo-root <dir>] [--json] [--help] <fault-ledger.json>"
      );
      process.exit(0);
    }
    const result = validateFaultLedgerFile(ledgerPath, { repoRoot });
    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.valid ? 0 : 1);
    }
    if (!result.valid) {
      console.error(`INVALID fault-ledger (${result.errors.length} error(s)):`);
      for (const e of result.errors) {
        console.error(`  - ${e}`);
      }
      process.exit(1);
    }
    console.log(
      `VALID fault-ledger: ${result.stats.total_units} unit(s), ` +
        `coverage=${result.stats.coverage_pct}% ` +
        `(covered=${result.stats.status_counts.covered}, candidate=${result.stats.status_counts.candidate}, ` +
        `blocked=${result.stats.status_counts.blocked}, planned=${result.stats.status_counts.planned})`
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
  STATUSES,
  escapeUnsafeDiagnosticCharacters,
  validateSafeRepoRelativePath,
  validateFaultLedger,
  validateFaultLedgerFile,
};
