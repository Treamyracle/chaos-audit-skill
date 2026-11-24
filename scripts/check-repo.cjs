#!/usr/bin/env node
"use strict";

/**
 * Zero-dependency repository self-checker:
 * 1. Parses every JSON file in manifests, schemas, and sample outputs.
 * 2. Verifies required manifest keys and core skill files exist.
 * 3. Verifies every relative Markdown link across README.md, i18n/*.md, and docs/*.md resolves to disk.
 * 4. Audits docs/assets/*.svg for valid viewBox, resolved url(#...) refs, and pill/card text-fit bounds.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const errors = [];

const REQUIRED_FILES = [
  "LICENSE",
  "README.md",
  "package.json",
  ".gitattributes",
  ".claude-plugin/marketplace.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".cursor-plugin/marketplace.json",
  ".cursor-plugin/plugin.json",
  ".agents/plugins/marketplace.json",
  "plugin.json",
  "gemini-extension.json",
  "assets/logo.svg",
  "assets/icon.png",
  "skills/chaos-audit/SKILL.md",
  "skills/chaos-audit/RECONNAISSANCE.md",
  "skills/chaos-audit/HUNTING.md",
  "skills/chaos-audit/VALIDATION-AND-REPORTING.md",
  "skills/chaos-audit/FAILURE-CLASSES.md",
  "skills/chaos-audit/DATABASE-AND-TRANSACTIONS.md",
  "skills/chaos-audit/QUEUES-WEBHOOKS-AND-WORKERS.md",
  "skills/chaos-audit/HTTP-CACHING-AND-DISTRIBUTED.md",
  "skills/chaos-audit/STATE-AND-FRONTEND-CONCURRENCY.md",
  "skills/chaos-audit/AI-AGENTS-AND-LLM-PIPELINES.md",
  "skills/chaos-audit/FILESYSTEM-IPC-AND-SHUTDOWN.md",
  "skills/chaos-audit/fault-ledger-schema.json",
  "skills/chaos-audit/report-schema.json",
  "skills/chaos-audit/validate-fault-ledger.cjs",
  "skills/chaos-audit/validate-findings.cjs",
  "docs/BENCHMARKS.md",
  "docs/CASE-STUDY.md",
  "docs/CASE-STUDY-HUEY.md",
  "docs/EVAL.md",
  "docs/STATUS.md",
  "docs/assets/hero-banner.svg",
  "docs/assets/architecture-flow.svg",
  "docs/assets/reproducer-proof.svg",
  "docs/assets/before-after-benchmark.svg",
  "docs/assets/badges/version.svg",
  "docs/assets/badges/node.svg",
  "docs/assets/badges/harnesses.svg",
  "docs/assets/badges/license.svg",
  "examples/vulnerable-checkout/benchmark.cjs",
  "examples/benchmark-results/before-after.json",
  "examples/benchmark-results/tinydb-case-study.json",
  "examples/benchmark-results/huey-case-study.json",
  "examples/benchmark-results/skill-eval-ab.json",
  "examples/case-study-audit/architecture.md",
  "examples/case-study-audit/fault-ledger.json",
  "examples/case-study-audit/findings.json",
  "examples/case-study-audit/REPORT.md",
  "examples/case-study-audit/FINDINGS-DETAIL.md",
  "examples/case-study-audit/REPRODUCERS.md",
  "examples/case-study-audit/NEEDS-VALIDATION.md",
  "examples/case-study-audit/reproducers/tinydb_chaos_benchmark.py",
  "examples/case-study-huey/architecture.md",
  "examples/case-study-huey/fault-ledger.json",
  "examples/case-study-huey/findings.json",
  "examples/case-study-huey/REPORT.md",
  "examples/case-study-huey/FINDINGS-DETAIL.md",
  "examples/case-study-huey/REPRODUCERS.md",
  "examples/case-study-huey/NEEDS-VALIDATION.md",
  "examples/case-study-huey/reproducers/huey_chaos_benchmark.py",
  "examples/eval-suite/ground-truth.json",
  "examples/eval-suite/order-worker/store.js",
  "examples/eval-suite/order-worker/server.js",
  "examples/eval-suite/order-worker/reconciler.js",
];

for (const rel of REQUIRED_FILES) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    errors.push(`Missing required file: ${rel}`);
  }
}

const JSON_FILES = [
  "package.json",
  ".claude-plugin/marketplace.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".cursor-plugin/marketplace.json",
  ".cursor-plugin/plugin.json",
  ".agents/plugins/marketplace.json",
  "plugin.json",
  "gemini-extension.json",
  "skills/chaos-audit/fault-ledger-schema.json",
  "skills/chaos-audit/report-schema.json",
  "examples/benchmark-results/before-after.json",
  "examples/benchmark-results/tinydb-case-study.json",
  "examples/benchmark-results/huey-case-study.json",
  "examples/benchmark-results/skill-eval-ab.json",
  "examples/case-study-audit/fault-ledger.json",
  "examples/case-study-audit/findings.json",
  "examples/case-study-huey/fault-ledger.json",
  "examples/case-study-huey/findings.json",
  "examples/eval-suite/ground-truth.json",
  "examples/sample-audit-output/fault-ledger.json",
  "examples/sample-audit-output/findings.json",
];

for (const rel of JSON_FILES) {
  const full = path.join(ROOT, rel);
  try {
    JSON.parse(fs.readFileSync(full, "utf-8"));
  } catch (err) {
    errors.push(`Invalid JSON in ${rel}: ${err.message}`);
  }
}

function checkMarkdownLinks(mdRel) {
  const full = path.join(ROOT, mdRel);
  if (!fs.existsSync(full)) {
    errors.push(`Missing markdown file: ${mdRel}`);
    return;
  }
  const text = fs.readFileSync(full, "utf-8");
  const dir = path.dirname(full);
  const linkRegex = /(?:!\[[^\]]*\]|\[[^\]]*\])\(([^)]+)\)/g;
  let match;
  while ((match = linkRegex.exec(text)) !== null) {
    const rawTarget = match[1].trim().split(/\s+/)[0];
    if (
      rawTarget.startsWith("http://") ||
      rawTarget.startsWith("https://") ||
      rawTarget.startsWith("#") ||
      rawTarget.startsWith("mailto:")
    ) {
      continue;
    }
    const cleanTarget = rawTarget.split("#")[0];
    if (!cleanTarget) continue;
    const resolved = path.resolve(dir, cleanTarget);
    if (!fs.existsSync(resolved)) {
      errors.push(`Broken relative link in ${mdRel}: (${rawTarget}) -> missing ${path.relative(ROOT, resolved)}`);
    }
  }
  const htmlAttrRegex = /\b(?:src|href)="([^"]+)"/g;
  while ((match = htmlAttrRegex.exec(text)) !== null) {
    const rawTarget = match[1].trim();
    if (
      rawTarget.startsWith("http://") ||
      rawTarget.startsWith("https://") ||
      rawTarget.startsWith("#") ||
      rawTarget.startsWith("mailto:")
    ) {
      continue;
    }
    const cleanTarget = rawTarget.split("#")[0];
    if (!cleanTarget) continue;
    const resolved = path.resolve(dir, cleanTarget);
    if (!fs.existsSync(resolved)) {
      errors.push(`Broken HTML asset/link in ${mdRel}: (${rawTarget}) -> missing ${path.relative(ROOT, resolved)}`);
    }
  }
}

function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function estimateTextWidth(content, fontSize) {
  let width = 0;
  for (const ch of content) {
    if ("iIljtf1·.,:;|() ".includes(ch)) width += fontSize * 0.36;
    else if ("MWmw@&%".includes(ch)) width += fontSize * 0.78;
    else width += fontSize * 0.62;
  }
  return width;
}

function checkSvgFile(svgRel) {
  const full = path.join(ROOT, svgRel);
  if (!fs.existsSync(full)) return;
  const txt = fs.readFileSync(full, "utf-8");

  const vbMatch = txt.match(/<svg[^>]*viewBox="0\s+0\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)"/);
  if (!vbMatch) {
    errors.push(`SVG ${svgRel} is missing explicit viewBox="0 0 W H"`);
    return;
  }
  const svgWidth = Number(vbMatch[1]);
  if (!txt.includes("</svg>")) {
    errors.push(`SVG ${svgRel} is missing closing </svg> tag`);
  }

  // Verify every url(#id) points to a real defined id="..."
  const definedIds = new Set([...txt.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const refMatch of txt.matchAll(/url\(#([^)]+)\)/g)) {
    if (!definedIds.has(refMatch[1])) {
      errors.push(`SVG ${svgRel} references undefined url(#${refMatch[1]})`);
    }
  }

  // Extract explicit rect bounding boxes and check centered text fits comfortably inside containing rect
  const rects = [];
  for (const m of txt.matchAll(/<rect\b([^>]*)>/g)) {
    const attrs = m[1];
    const x = Number((attrs.match(/\bx="([^"]+)"/) || [, 0])[1]);
    const y = Number((attrs.match(/\by="([^"]+)"/) || [, 0])[1]);
    const wMatch = attrs.match(/\bwidth="([^"]+)"/);
    const hMatch = attrs.match(/\bheight="([^"]+)"/);
    if (!wMatch || !hMatch) continue;
    const w = Number(wMatch[1]);
    const h = Number(hMatch[1]);
    // Skip full-canvas background rect
    if (x === 0 && y === 0 && w >= svgWidth) continue;
    rects.push({ x, y, w, h });
  }

  for (const m of txt.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const attrs = m[1];
    const x = Number((attrs.match(/\bx="([^"]+)"/) || [, 0])[1]);
    const y = Number((attrs.match(/\by="([^"]+)"/) || [, 0])[1]);
    const fsMatch = attrs.match(/font-size="([^"]+)"/);
    const fontSize = fsMatch ? Number(fsMatch[1]) : 12;
    const isMiddle = /text-anchor="middle"/.test(attrs);
    const isEnd = /text-anchor="end"/.test(attrs);
    const content = decodeXmlEntities(m[2].replace(/<[^>]+>/g, "")).trim();
    const estWidth = estimateTextWidth(content, fontSize);

    if (isMiddle) {
      const container = rects.find(
        (r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h + 4
      );
      if (container && estWidth > container.w - 8) {
        errors.push(
          `SVG ${svgRel} text "${content}" (est ${estWidth.toFixed(1)}px) overflows container width ${container.w}px`
        );
      }
    } else if (isEnd) {
      if (x - estWidth < 8) {
        errors.push(
          `SVG ${svgRel} right-aligned text "${content}" extends past left canvas edge`
        );
      }
    } else if (x + estWidth > svgWidth - 8) {
      errors.push(
        `SVG ${svgRel} text "${content}" extends past viewBox width (${svgWidth}px)`
      );
    }
  }
}

checkMarkdownLinks("README.md");
checkMarkdownLinks("docs/BENCHMARKS.md");
checkMarkdownLinks("docs/CASE-STUDY.md");
checkMarkdownLinks("docs/CASE-STUDY-HUEY.md");
checkMarkdownLinks("docs/EVAL.md");
checkMarkdownLinks("docs/STATUS.md");
checkMarkdownLinks("skills/chaos-audit/SKILL.md");
checkMarkdownLinks("examples/case-study-audit/REPORT.md");
checkMarkdownLinks("examples/case-study-audit/FINDINGS-DETAIL.md");
checkMarkdownLinks("examples/case-study-audit/REPRODUCERS.md");
checkMarkdownLinks("examples/case-study-audit/NEEDS-VALIDATION.md");
checkMarkdownLinks("examples/case-study-huey/REPORT.md");
checkMarkdownLinks("examples/case-study-huey/FINDINGS-DETAIL.md");
checkMarkdownLinks("examples/case-study-huey/REPRODUCERS.md");
checkMarkdownLinks("examples/case-study-huey/NEEDS-VALIDATION.md");

const i18nDir = path.join(ROOT, "i18n");
if (!fs.existsSync(i18nDir)) {
  errors.push("Missing i18n directory");
} else {
  const i18nFiles = fs.readdirSync(i18nDir).filter((f) => f.endsWith(".md"));
  if (i18nFiles.length < 10) {
    errors.push(`Expected at least 10 localized READMEs in i18n/, found ${i18nFiles.length}`);
  }
  for (const f of i18nFiles) {
    checkMarkdownLinks(`i18n/${f}`);
  }
}

const SVG_FILES = [
  "docs/assets/hero-banner.svg",
  "docs/assets/architecture-flow.svg",
  "docs/assets/reproducer-proof.svg",
  "docs/assets/before-after-benchmark.svg",
  "docs/assets/badges/version.svg",
  "docs/assets/badges/node.svg",
  "docs/assets/badges/harnesses.svg",
  "docs/assets/badges/license.svg",
  "assets/logo.svg",
];
for (const svg of SVG_FILES) {
  checkSvgFile(svg);
}

// Verify manifest versions stay in sync with the self-hosted version badge SVG.
try {
  const versionFiles = [
    "package.json",
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    ".cursor-plugin/plugin.json",
    "gemini-extension.json",
  ];
  const expectedVersion = JSON.parse(
    fs.readFileSync(path.join(ROOT, ".claude-plugin/plugin.json"), "utf-8")
  ).version;
  for (const vf of versionFiles) {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, vf), "utf-8")).version;
    if (v !== expectedVersion) {
      errors.push(`Version mismatch in ${vf}: expected "${expectedVersion}", got "${v}"`);
    }
  }
  const versionBadge = fs.readFileSync(path.join(ROOT, "docs/assets/badges/version.svg"), "utf-8");
  if (!versionBadge.includes(`v${expectedVersion}`)) {
    errors.push(`docs/assets/badges/version.svg does not display v${expectedVersion}`);
  }
} catch (err) {
  errors.push(`Version consistency check failed: ${err.message}`);
}

if (errors.length > 0) {
  console.error(`Repository check FAILED (${errors.length} error(s)):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `Repository check PASSED: ${REQUIRED_FILES.length} required files, ${JSON_FILES.length} JSON files, ${SVG_FILES.length} SVGs, and all relative Markdown links verified.`
);
