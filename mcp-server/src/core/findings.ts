/**
 * core/findings.ts — ReviewRecord selection + finding shaping (application layer).
 *
 * Shared by BOTH `devdigest_get_findings` and `devdigest_run_agent_on_pr` so the
 * concise/detailed/pagination behaviour is identical. Pure functions over
 * `@devdigest/shared` types + `format` helpers — no I/O, no MCP code.
 */

import type { ReviewRecord } from "@devdigest/shared";
import { compactFinding, detailedFinding } from "../format.js";

export type ResponseFormat = "concise" | "detailed";

/** Severity ordering for "most important first" (CRITICAL → WARNING → SUGGESTION). */
const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

/**
 * Pick the relevant review for a PR. A PR may carry multiple ReviewRecords (one
 * per agent run, plus `kind:"summary"` rows). We only ever want `kind:"review"`;
 * prefer the one matching `runId`, else the newest by `created_at`.
 */
export function pickReview(
  reviews: ReviewRecord[],
  opts: { runId?: string } = {},
): ReviewRecord | undefined {
  const actual = reviews.filter((r) => r.kind === "review");
  if (opts.runId) {
    const byRun = actual.find((r) => r.run_id === opts.runId);
    if (byRun) return byRun;
  }
  // Newest first by created_at (ISO strings sort lexicographically).
  return [...actual].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
}

export interface ShapedFindings {
  verdict: string | null;
  score: number | null;
  total: number;
  returned: number;
  offset: number;
  counts: { critical: number; warning: number; suggestion: number };
  findings: unknown[];
}

/**
 * Shape a review's findings for return:
 *  - sorted most-severe first,
 *  - windowed by offset/limit,
 *  - concise (compactFinding) or detailed (full fields),
 *  - always accompanied by total + per-severity counts (summary-first).
 */
export function shapeFindings(
  review: ReviewRecord,
  opts: { format: ResponseFormat; offset: number; limit: number },
): ShapedFindings {
  const sorted = [...review.findings].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9),
  );

  const counts = {
    critical: sorted.filter((f) => f.severity === "CRITICAL").length,
    warning: sorted.filter((f) => f.severity === "WARNING").length,
    suggestion: sorted.filter((f) => f.severity === "SUGGESTION").length,
  };

  const offset = Math.max(0, opts.offset);
  const window = sorted.slice(offset, offset + Math.max(0, opts.limit));
  const findings =
    opts.format === "detailed" ? window.map(detailedFinding) : window.map(compactFinding);

  return {
    verdict: review.verdict,
    score: review.score,
    total: sorted.length,
    returned: findings.length,
    offset,
    counts,
    findings,
  };
}
