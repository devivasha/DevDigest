/**
 * Findings application logic — application layer.
 *
 * Shared by both `get_findings` (T7) and `run_agent_on_pr` (T8).  Pure
 * functions over @devdigest/shared types + format helpers — no I/O, no MCP
 * imports, no fetch.
 *
 * Layer: application/orchestration.  Imports from @devdigest/shared and
 * src/format only.  Never imports from tools/*.
 */

import type { ReviewRecord, FindingRecord } from '@devdigest/shared';
import { compactFinding, type CompactFinding } from '../format.js';

// ---------------------------------------------------------------------------
// Review selection
// ---------------------------------------------------------------------------

/**
 * Pick the best ReviewRecord from a list.
 *
 * Filters to kind === "review" rows only (excludes summary-kind rows).
 * If runId is provided, prefers the record whose run_id matches.
 * Otherwise returns the newest record by created_at (lexicographic ISO-8601
 * comparison is safe for full timestamps).
 */
export function pickReview(
  reviews: ReviewRecord[],
  opts: { runId?: string },
): ReviewRecord | undefined {
  const candidates = reviews.filter((r) => r.kind === 'review');
  if (candidates.length === 0) return undefined;

  if (opts.runId !== undefined) {
    const exact = candidates.find((r) => r.run_id === opts.runId);
    if (exact) return exact;
    // Fall through to newest if runId not matched
  }

  // Sort descending by created_at (ISO-8601 strings sort correctly lexicographically)
  const sorted = [...candidates].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  return sorted[0];
}

// ---------------------------------------------------------------------------
// Severity sort order
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};

function severityRank(severity: string): number {
  return SEVERITY_ORDER[severity] ?? 3;
}

// ---------------------------------------------------------------------------
// Findings shaping
// ---------------------------------------------------------------------------

/** Concise finding counts by severity. */
export type FindingCounts = {
  critical: number;
  warning: number;
  suggestion: number;
};

/** Output of shapeFindings for concise format. */
export type ConciseFindingsResult = {
  verdict: string | null;
  score: number | null;
  total: number;
  returned: number;
  offset: number;
  counts: FindingCounts;
  findings: CompactFinding[];
};

/** Output of shapeFindings for detailed format. */
export type DetailedFindingsResult = {
  verdict: string | null;
  score: number | null;
  total: number;
  returned: number;
  offset: number;
  counts: FindingCounts;
  findings: FindingRecord[];
};

export type FindingsResult = ConciseFindingsResult | DetailedFindingsResult;

export type ShapeFindingsOpts = {
  format: 'concise' | 'detailed';
  offset: number;
  limit: number;
};

/**
 * Shape findings from a ReviewRecord into a paginated, token-efficient
 * response suitable for tool output.
 *
 * Concise mode: compactFinding projection, sorted CRITICAL→WARNING→SUGGESTION,
 *   with severity counts.
 * Detailed mode: full FindingRecord fields, same sort order, with counts.
 *
 * verdict guards: ReviewRecord.verdict is nullable (summary rows have null).
 * score guards: ReviewRecord.score is nullable.
 */
export function shapeFindings(
  review: ReviewRecord,
  opts: ShapeFindingsOpts,
): FindingsResult {
  const { format, offset, limit } = opts;

  // Guard nullable verdict
  const verdict = review.verdict ?? null;
  const score = review.score ?? null;

  const allFindings = review.findings;
  const total = allFindings.length;

  // Compute counts over the full set before pagination
  const counts: FindingCounts = {
    critical: allFindings.filter((f) => f.severity === 'CRITICAL').length,
    warning: allFindings.filter((f) => f.severity === 'WARNING').length,
    suggestion: allFindings.filter((f) => f.severity === 'SUGGESTION').length,
  };

  // Sort by severity CRITICAL→WARNING→SUGGESTION
  const sorted = [...allFindings].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity),
  );

  // Apply offset + limit
  const page = sorted.slice(offset, offset + limit);
  const returned = page.length;

  if (format === 'concise') {
    return {
      verdict,
      score,
      total,
      returned,
      offset,
      counts,
      findings: page.map(compactFinding),
    };
  }

  // Detailed: return full FindingRecord fields
  return {
    verdict,
    score,
    total,
    returned,
    offset,
    counts,
    findings: page,
  };
}
