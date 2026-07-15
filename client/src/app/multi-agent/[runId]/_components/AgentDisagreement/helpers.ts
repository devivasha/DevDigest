import type { Conflict, ConflictTake } from "@devdigest/shared";

/** Dot colour per flagged severity, per the product design mockup. */
const VERDICT_DOT_COLOR: Record<Exclude<ConflictTake["verdict"], "ignored">, string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--accent)",
};

/** Resolves the dot colour for a take's verdict — grey for "ignored". */
export function verdictDotColor(verdict: ConflictTake["verdict"]): string {
  if (verdict === "ignored") return "var(--text-muted)";
  return VERDICT_DOT_COLOR[verdict];
}

/**
 * A group of takes is a genuine disagreement when at least two distinct
 * verdicts are present across agents — either divergent severities, or some
 * agents flagged the spot while others did not ("ignored"). A group where
 * every take shares the same verdict is an agreement group.
 *
 * `MultiAgentRun.conflicts` is computed server-side to contain only
 * disagreements, but this component treats that as a fact to verify rather
 * than assume — the "Show only conflicts" toggle stays meaningful even if a
 * caller ever passes an all-agree row.
 */
export function isConflictGroup(takes: ConflictTake[]): boolean {
  const distinctVerdicts = new Set(takes.map((take) => take.verdict));
  return distinctVerdicts.size > 1;
}

/** Stable React key for a conflict row (file:line is unique per group). */
export function conflictKey(conflict: Conflict): string {
  return `${conflict.file}:${conflict.line}`;
}

/** Applies the "Show only conflicts" filter over the raw conflict groups. */
export function visibleConflicts(
  conflicts: Conflict[],
  showOnlyConflicts: boolean,
): Conflict[] {
  if (!showOnlyConflicts) return conflicts;
  return conflicts.filter((conflict) => isConflictGroup(conflict.takes));
}
