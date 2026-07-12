import type { AgentCase } from "../../src/index.js";
import { cases as strictCases } from "../architecture-reviewer/architecture-reviewer.cases.js";

/**
 * The lite variant is the SAME agent with one hard rule removed: "name the exact documented rule
 * identifier per finding". So it is graded on the strict variant's exact tasks (same prompts, same
 * fixtures) MINUS the citation practices — which lite is designed not to satisfy. Asserting them
 * would contradict the artifact under test (Haiku fails them too, by design), not measure a defect.
 *
 * Everything else stays: both variants must still FIND the violations, quote them verbatim, assign
 * severity, and end with a gate verdict. What moves between the two runs is only the citation, which
 * is exactly the A/B this pair exists to expose — run `pnpm eval:delta` on the two labeled repeats.
 */
const CITATION_PRACTICE = /names the (?:specific|exact) documented rule identifier/i;

export const cases: AgentCase[] = strictCases.map((c) => {
  const practices = c.practices?.filter((p) => !CITATION_PRACTICE.test(p));
  // Rename the reviewer-core case: without the citation practices it no longer tests "cites the
  // identifier" — it tests that lite still finds both reviewer-core violations with evidence.
  const name =
    c.name === "cites the DevDigest-specific rule identifier for reviewer-core violations"
      ? "flags both reviewer-core violations with verbatim evidence (no citation required)"
      : c.name;
  return { ...c, name, practices };
});
