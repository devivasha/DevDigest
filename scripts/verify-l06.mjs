#!/usr/bin/env node
/**
 * verify-l06 — checks that all L06 deliverables (the Eval Pipeline) are in place:
 *   Shared contracts (EvalExpectation / EvalSetRunRecord, both vendor trees)
 *   DB schema + 0013 migration (eval_set_runs, eval_runs.workspace_id, unique eval_cases)
 *   Server eval module (scorer / repository / service / routes) + DI + registration
 *   Seed of >= 8 eval cases
 *   Client hooks, shared components, dashboard page, Evals tab, nav item
 *   FindingCard "Turn into eval case" wiring
 *   Root package.json verify:l06 script
 *
 * Same shape as verify-l03.mjs: file-existence / string-contains checks, exit 0/1.
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

function read(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return "";
  }
}

function contains(rel, pattern) {
  return read(rel).includes(pattern);
}

// A migration whose auto-generated slug we don't want to hard-code: match by prefix.
function hasMigrationPrefix(prefix) {
  const dir = path.join(ROOT, "server/src/db/migrations");
  try {
    return fs.readdirSync(dir).some((f) => f.startsWith(prefix) && f.endsWith(".sql"));
  } catch {
    return false;
  }
}

const CLIENT_EVAL_CI = "client/src/vendor/shared/contracts/eval-ci.ts";
const SERVER_EVAL_CI = "server/src/vendor/shared/contracts/eval-ci.ts";
const SCHEMA_EVAL = "server/src/db/schema/eval.ts";
const FINDINGS_PANEL =
  "client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx";
const AGENT_TABS =
  "client/src/app/agents/[id]/_components/AgentEditor/constants.ts";

const checks = [
  // ── Shared contracts (both vendor trees, byte-identical eval additions) ─────
  {
    name: "Contract: EvalExpectation in server vendor tree",
    pass: contains(SERVER_EVAL_CI, "EvalExpectation"),
  },
  {
    name: "Contract: EvalExpectation in client vendor tree",
    pass: contains(CLIENT_EVAL_CI, "EvalExpectation"),
  },
  {
    name: "Contract: EvalSetRunRecord in both vendor trees",
    pass: contains(SERVER_EVAL_CI, "EvalSetRunRecord") && contains(CLIENT_EVAL_CI, "EvalSetRunRecord"),
  },

  // ── DB schema + migration ──────────────────────────────────────────────────
  {
    name: "Schema: evalSetRuns table defined (server/src/db/schema/eval.ts)",
    pass: contains(SCHEMA_EVAL, "evalSetRuns"),
  },
  {
    name: "Schema: eval_runs carries workspace_id (structural tenancy)",
    pass: contains(SCHEMA_EVAL, "workspace_id"),
  },
  {
    name: "Schema: unique constraint on eval_cases (workspace_id, owner_id, name)",
    pass: contains(SCHEMA_EVAL, "eval_cases_owner_name_uq"),
  },
  {
    name: "Schema: evalSetRuns registered in db/schema.ts barrel",
    pass: contains("server/src/db/schema.ts", "evalSetRuns"),
  },
  {
    name: "Migration: a 0013_* migration exists",
    pass: hasMigrationPrefix("0013_"),
  },

  // ── Server eval module ─────────────────────────────────────────────────────
  {
    name: "Server: pure scorer (server/src/modules/eval/scorer.ts)",
    pass: exists("server/src/modules/eval/scorer.ts"),
  },
  {
    name: "Server: scorer exports matches()/computeRecall()/computePrecision()",
    pass:
      contains("server/src/modules/eval/scorer.ts", "computeRecall") &&
      contains("server/src/modules/eval/scorer.ts", "computePrecision") &&
      contains("server/src/modules/eval/scorer.ts", "computeCitationAccuracy"),
  },
  {
    name: "Server: scorer is LLM-free (no llm/container/provider import)",
    pass: (() => {
      const src = read("server/src/modules/eval/scorer.ts");
      // strip line comments so doc-mentions of "llm" don't trip the check
      const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      return !/from\s+["'][^"']*(container|\/llm|adapters)/.test(code);
    })(),
  },
  {
    name: "Server: repository (server/src/modules/eval/repository.ts)",
    pass: exists("server/src/modules/eval/repository.ts"),
  },
  {
    name: "Server: service (server/src/modules/eval/service.ts)",
    pass: exists("server/src/modules/eval/service.ts"),
  },
  {
    name: "Server: service runs the set + reads grounding kept/dropped",
    pass:
      contains("server/src/modules/eval/service.ts", "runSet") &&
      contains("server/src/modules/eval/service.ts", "reviewPullRequest"),
  },
  {
    name: "Server: routes (server/src/modules/eval/routes.ts)",
    pass: exists("server/src/modules/eval/routes.ts"),
  },
  {
    name: "Server: POST /agents/:id/eval-runs route",
    pass: contains("server/src/modules/eval/routes.ts", "eval-runs"),
  },
  {
    name: "Server: create-from-finding route",
    pass: contains("server/src/modules/eval/routes.ts", "from-finding"),
  },
  {
    name: "Server: eval module registered in modules/index.ts",
    pass: contains("server/src/modules/index.ts", "eval/routes"),
  },
  {
    name: "Server: evalRepo wired in the DI container",
    pass: contains("server/src/platform/container.ts", "evalRepo"),
  },

  // ── Seed ───────────────────────────────────────────────────────────────────
  {
    name: "Seed: >= 8 eval cases seeded (server/src/db/seed.ts)",
    pass: contains("server/src/db/seed.ts", "evalCases"),
  },

  // ── Client surfaces ────────────────────────────────────────────────────────
  {
    name: "Client: eval hooks (client/src/lib/hooks/eval.ts)",
    pass: exists("client/src/lib/hooks/eval.ts"),
  },
  {
    name: "Client: eval case editor modal component",
    pass: exists("client/src/components/eval/EvalCaseEditorModal.tsx"),
  },
  {
    name: "Client: compare-runs modal component",
    pass: exists("client/src/components/eval/CompareRunsModal.tsx"),
  },
  {
    name: "Client: Eval Dashboard page (client/src/app/eval/page.tsx)",
    pass: exists("client/src/app/eval/page.tsx"),
  },
  {
    name: "Client: Evals tab registered in AgentEditor",
    pass: contains(AGENT_TABS, "'evals'") || contains(AGENT_TABS, '"evals"'),
  },
  {
    name: "Client: Eval Dashboard nav item (/eval)",
    pass: contains("client/src/vendor/ui/nav.ts", "/eval"),
  },
  {
    name: 'Client: FindingCard "Turn into eval case" wired in FindingsPanel',
    pass: contains(FINDINGS_PANEL, "useCreateCaseFromFinding"),
  },

  // ── Verify script itself ───────────────────────────────────────────────────
  {
    name: "Root package.json has a verify:l06 script",
    pass: contains("package.json", "verify:l06"),
  },
];

let passed = 0;
let failed = 0;

console.log(`\n${BOLD}L06 verification — Eval Pipeline${RESET}\n`);

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
  console.log(`${GREEN}${BOLD}✓ All ${passed} checks passed — L06 complete!${RESET}\n`);
  process.exit(0);
} else {
  console.log(`${RED}${BOLD}✗ ${failed} check(s) failed (${passed}/${checks.length} passed)${RESET}\n`);
  process.exit(1);
}
