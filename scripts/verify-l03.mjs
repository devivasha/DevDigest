#!/usr/bin/env node
/**
 * verify-l03 — checks that all L03 deliverables are in place:
 *   Smart Diff (server classifier + route + client viewer)
 *   Intent layer ("What this does" — deriveFileSummary + pseudocode_summary)
 *   Root package.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function contains(rel, pattern) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8").includes(pattern);
  } catch {
    return false;
  }
}

const checks = [
  // ── Root package.json ────────────────────────────────────────────────────
  {
    name: "Root package.json exists",
    pass: exists("package.json"),
  },

  // ── Smart Diff — server ─────────────────────────────────────────────────
  {
    name: "Smart Diff classifier  (server/src/modules/pulls/smart-diff-classifier.ts)",
    pass: exists("server/src/modules/pulls/smart-diff-classifier.ts"),
  },
  {
    name: "classifyFile() exported from classifier",
    pass: contains("server/src/modules/pulls/smart-diff-classifier.ts", "export function classifyFile"),
  },
  {
    name: "BOILERPLATE_PATTERNS constant exported",
    pass: contains("server/src/modules/pulls/smart-diff-classifier.ts", "export const BOILERPLATE_PATTERNS"),
  },
  {
    name: "GET /pulls/:id/smart-diff route registered",
    pass: contains("server/src/modules/pulls/routes.ts", "smart-diff"),
  },

  // ── Intent layer — deriveFileSummary ────────────────────────────────────
  {
    name: "Intent layer: deriveFileSummary() exported",
    pass: contains("server/src/modules/pulls/smart-diff-classifier.ts", "export function deriveFileSummary"),
  },
  {
    name: "Intent layer: pseudocode_summary populated in route",
    pass: contains("server/src/modules/pulls/routes.ts", "pseudocode_summary"),
  },

  // ── Smart Diff — client ─────────────────────────────────────────────────
  {
    name: "SmartDiffViewer component exists",
    pass: exists("client/src/components/diff-viewer/SmartDiffViewer/SmartDiffViewer.tsx"),
  },
  {
    name: "GroupSection component exists",
    pass: exists("client/src/components/diff-viewer/SmartDiffViewer/GroupSection.tsx"),
  },
  {
    name: "SmartFileCard component exists",
    pass: exists("client/src/components/diff-viewer/SmartDiffViewer/SmartFileCard.tsx"),
  },
  {
    name: "useSmartDiff hook added to pulls hooks",
    pass: contains("client/src/lib/hooks/pulls.ts", "useSmartDiff"),
  },
  {
    name: "Smart order / Original order toggle in DiffTab",
    pass: contains(
      "client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx",
      "smartOrder"
    ),
  },
  {
    name: '"What this does" i18n key present',
    pass: contains("client/messages/en/shell.json", "whatThisDoes"),
  },
  {
    name: "Line-level severity indicators in CodeLine",
    pass: contains("client/src/components/diff-viewer/CodeLine/CodeLine.tsx", "finding"),
  },
  {
    name: "Cross-tab click-to-navigate (targetFindingId) in page.tsx",
    pass: contains(
      "client/src/app/repos/[repoId]/pulls/[number]/page.tsx",
      "targetFindingId"
    ),
  },
];

let passed = 0;
let failed = 0;

console.log(`\n${BOLD}L03 verification — Smart Diff + Intent Layer${RESET}\n`);

for (const { name, pass } of checks) {
  if (pass) {
    console.log(`  ${GREEN}✓${RESET}  ${name}`);
    passed++;
  } else {
    console.log(`  ${RED}✗${RESET}  ${name}`);
    failed++;
  }
}

console.log("");

if (failed === 0) {
  console.log(`${GREEN}${BOLD}✓ All ${passed} checks passed — L03 complete!${RESET}\n`);
  process.exit(0);
} else {
  console.log(`${RED}${BOLD}✗ ${failed} check(s) failed (${passed}/${checks.length} passed)${RESET}\n`);
  process.exit(1);
}
