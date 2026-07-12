/**
 * Controlled strict-vs-lite A/B for the architecture reviewer.
 *
 * The two standalone suites (architecture-reviewer / architecture-reviewer-lite) can each be
 * repeated and scored, but they CANNOT be `eval:delta`'d against each other: a record's nodeid is
 * `<testPath> > <describe-prefixed test name>`, and BOTH halves differ between the suites (different
 * .eval.ts file, and `agent:architecture-reviewer` vs `agent:architecture-reviewer-lite` prefix).
 * So every case lands unpaired and the delta is all `Δ n/a`. On top of that, the lite suite strips
 * the citation practices from its cases, so even the shared cases grade a different bar — the one
 * practice the A/B exists to measure is exactly the one that's hidden.
 *
 * This suite fixes both problems by making the injected agent the ONLY variable. One .eval.ts, one
 * fixed `agent:architecture-reviewer-ab` describe prefix, the STRICT cases verbatim (citation
 * practices kept — that is the shared bar both agents are held to). Which agent artifact gets
 * injected is chosen at runtime by AB_AGENT. Both runs therefore emit identical nodeids, so
 * `eval:delta` pairs every case and every practice — and the citation practices show up as the
 * `100% -> N%` regression that is the whole point of the comparison.
 *
 *   AB_AGENT=architecture-reviewer      pnpm eval:repeat agents/architecture-reviewer-ab -n 5 --label strict
 *   AB_AGENT=architecture-reviewer-lite pnpm eval:repeat agents/architecture-reviewer-ab -n 5 --label lite
 *   pnpm eval:delta strict lite
 *
 * Note the cases are imported from the strict suite unchanged; their prompts already embed the
 * fixture diffs (resolved relative to the strict cases file), so no fixtures are duplicated here.
 */
import { describeAgent, runAgentCases } from "../../src/index.js";
import { cases } from "../architecture-reviewer/architecture-reviewer.cases.js";

// Default to the strict agent so a bare `vitest run` (no env) still executes a valid suite.
const AB_AGENT = process.env.AB_AGENT ?? "architecture-reviewer";

// Fixed describe name → stable nodeids across both AB_AGENT values. The first arg to
// runAgentCases is only the artifact to INJECT (see runQualityCases in src/dsl/case.ts); it never
// enters the nodeid, which is what lets the injected agent vary while the case identity stays put.
describeAgent("architecture-reviewer-ab", () => runAgentCases(AB_AGENT, cases));
