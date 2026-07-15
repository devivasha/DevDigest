import type { ReviewRecord, FindingRecord, Severity } from "@devdigest/shared";

/**
 * Build a lookup of every persisted finding (across all reviews for the PR)
 * by its id. `AgentColumn.findings` (from the multi-agent run payload) only
 * carries a subset shape (id/severity/category/title/file/start_line) — the
 * full `FindingRecord` (confidence, suggestion, rationale, accept/dismiss
 * timestamps) is joined back in from `usePrReviews` by this map.
 */
export function findingsById(reviews: ReviewRecord[]): Map<string, FindingRecord> {
  const map = new Map<string, FindingRecord>();
  for (const review of reviews) {
    for (const finding of review.findings) {
      map.set(finding.id, finding);
    }
  }
  return map;
}

/** Format a finding's line range ("11" when single-line, else "11-15"). */
export function lineLabel(f: { start_line: number; end_line?: number }): string {
  if (f.end_line == null || f.end_line === f.start_line) return `${f.start_line}`;
  return `${f.start_line}-${f.end_line}`;
}

/** Rounded confidence percentage (0..1 -> 0..100) for `finding.confShort`. */
export function confidencePct(confidence: number): number {
  return Math.round(confidence * 100);
}

/** Format a duration in ms as "6.9s" under a minute, else "2m". */
export function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

/** USD cost formatted to 2dp, or an em dash when the cost isn't known yet. */
export function formatCost(usd: number | null): string {
  if (usd == null) return "—";
  return `$${usd.toFixed(2)}`;
}

/** Score colour threshold, mirroring `CircularScore`'s own gradient. */
export function scoreColor(score: number | null): string {
  if (score == null) return "var(--text-muted)";
  if (score >= 75) return "var(--ok)";
  if (score >= 50) return "var(--warn)";
  return "var(--crit)";
}

const SEVERITY_BORDER: Record<Severity, string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--accent)",
};

/** Left-border accent for a finding card, by severity (design mock). */
export function severityBorderColor(severity: Severity): string {
  return SEVERITY_BORDER[severity] ?? "var(--border)";
}
