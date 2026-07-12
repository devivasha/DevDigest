import type { AgentCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

const REVIEW_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("checkout-service.diff")}`;

// A second real diff whose violations map onto DevDigest-SPECIFIC rule names
// (`reviewer-core-zero-io`, `reviewer-core-ground-findings-gate`) that a competent model will
// describe in prose but will not spontaneously name unless the agent forces a citation. This is
// the discriminating case for the strict-vs-lite A/B: both variants should FIND both problems,
// but only the strict variant (which keeps the "cite the exact documented rule per finding" hard
// rule) should reliably emit the identifier. The checkout diff's textbook violations don't
// discriminate — the model volunteers `inward-only-dependencies`/`di-discipline` either way.
const REVIEWER_CORE_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("reviewer-core-gate.diff")}`;

// A diff that violates NO documented rule (a pure local-variable rename inside a domain file, no
// new imports, no cross-layer edges). A grounded reviewer should report zero violations. This
// surfaces the COST of relaxing the citation rule: freed from "every finding must name a
// documented contract", the lite variant is more prone to fabricating a judgment/best-practice
// finding where the strict variant stays silent.
const BENIGN_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("benign-refactor.diff")}`;

// Shared across the strict (architecture-reviewer) and relaxed (architecture-reviewer-lite)
// variants so the two agents are graded on the exact same task — the only thing that should
// move between the two runs is whether "cites the specific documented rule" keeps passing.
export const cases: AgentCase[] = [
  {
    name: "flags both violations in the checkout diff with severity and a citable rule",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    practices: [
      "flags the domain file (checkout.ts) importing a type from 'fastify' as a violation of the inward-only dependency rule between Domain and Presentation layers",
      "flags the `new PgCheckoutRepository()` call inside service.ts as a violation of DI discipline (concrete adapters/repositories must be constructed only in the composition root / container)",
      "names the specific documented rule identifier for EVERY finding (e.g. `inward-only-dependencies`, `di-discipline`) rather than describing the problem only in prose",
      "assigns a severity (critical/high/medium/low/info) to each finding",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      "ends with an explicit PASS/FAIL gate verdict based on whether any critical or high findings exist",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "does not fabricate an architecture finding for the out-of-scope security-shaped change",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    // Phrased positively AND without pinning the exact quote: the judge PASSes only with a verbatim
    // quote proving the practice was MET, so (a) an absence ("does not raise X") has nothing to quote
    // and always fails, and (b) demanding a specific quote (the `reply?` *parameter*) fails when the
    // model evidences the same violation via the import line instead. Accept either quote; let the
    // second practice carry the "stayed in scope, invented no security finding" signal.
    practices: [
      'flags the Fastify framework type reaching the Domain layer as an inward-only-dependencies layering violation — evidenced by the `import type { FastifyReply } from "fastify"` line and/or the `reply?: FastifyReply` parameter it enables — rather than as a runtime-bug, null-safety, or security finding',
      "every finding it raises is a structural / layering / DI concern tied to a documented architectural contract, not a runtime-bug, null-safety, security, naming, style, or test-coverage comment",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "cites the DevDigest-specific rule identifier for reviewer-core violations",
    kind: "quality",
    prompt: REVIEWER_CORE_PROMPT,
    practices: [
      "flags the `import { readFileSync } from 'node:fs'` added to reviewer-core/src/pipeline/run.ts as a violation (reviewer-core must do no I/O except the injected LLMProvider)",
      "flags that runPipeline now returns `deduped` directly, skipping the mandatory `groundFindings()` gate before emitting findings",
      "names the exact documented rule identifier `reviewer-core-zero-io` for the fs-import finding rather than only describing it in prose",
      "names the exact documented rule identifier `reviewer-core-ground-findings-gate` for the skipped-gate finding rather than only describing it in prose",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      "ends with an explicit PASS/FAIL gate verdict based on whether any critical or high findings exist",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "does not fabricate a documented-rule violation for a benign rename",
    kind: "quality",
    prompt: BENIGN_PROMPT,
    // Two positively-anchored practices, tolerant of format variance. The dropped third practice
    // ("does not fabricate a documented-rule violation") was a pure absence — nothing to quote, so
    // the judge returned evidence:null and failed it even on a correct clean report. On a benign
    // diff a model often free-forms its "all clear" instead of the full Verdict table, so both
    // practices accept an equivalent explicit statement, not only the literal `PASS` gate line.
    practices: [
      'concludes the benign rename introduces no rule violations — it fabricates no critical/high/medium finding (states "No violations found", shows an empty or `info`-only findings table, or otherwise explicitly reports the diff as clean)',
      "its overall verdict is clean — a `PASS` gate, or an equivalent explicit statement that nothing blocks merge",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
];
