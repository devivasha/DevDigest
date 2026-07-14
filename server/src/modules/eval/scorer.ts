import type { EvalExpectation, Finding } from '@devdigest/shared';

/**
 * Pure, deterministic eval scorer (L06 — modules/eval/scorer.ts).
 *
 * Zero I/O, zero LLM, zero db/Container/provider imports — this is how AC-9
 * ("the scoring step makes zero LLM/provider calls") is structurally
 * guaranteed rather than merely tested. Only TYPES are imported from
 * `@devdigest/shared`; every export below is plain arithmetic over
 * `Finding[]` / `EvalExpectation` values passed in by the caller.
 *
 * Metric semantics are PINNED per `docs/plans/eval-pipeline.md`
 * ("Final scorer input signature (pinned)" + cross-model review finding #2):
 *  - recall is computed over the GROUNDED `kept` set.
 *  - precision is computed over `producedAll` (kept ∪ dropped — the
 *    pre-grounding model output). A hallucinated finding on a
 *    `must_not_flag` target still counts as a false positive even if
 *    grounding would have dropped it.
 *  - citation_accuracy is `kept / (kept + dropped)`, or `null` when the
 *    case's diff was unavailable/unparseable (degraded — Rec-D).
 */

/** Minimal shape both `Finding` and an `EvalExpectation` target satisfy. */
type ExpectedFinding = EvalExpectation['findings'][number];

// ===========================================================================
// AC-5 — match predicate
// ===========================================================================

/**
 * A produced finding matches an expected finding iff their `file` paths are
 * equal AND their `[start_line, end_line]` ranges overlap.
 */
export function matches(a: Finding | ExpectedFinding, b: Finding | ExpectedFinding): boolean {
  return (
    a.file === b.file && Math.max(a.start_line, b.start_line) <= Math.min(a.end_line, b.end_line)
  );
}

function mustFindTargets(expectations: EvalExpectation[]): ExpectedFinding[] {
  return expectations.filter((e) => e.kind === 'must_find').flatMap((e) => e.findings);
}

function mustNotFlagTargets(expectations: EvalExpectation[]): ExpectedFinding[] {
  return expectations.filter((e) => e.kind === 'must_not_flag').flatMap((e) => e.findings);
}

// ===========================================================================
// AC-6 — recall (over kept)
// ===========================================================================

/**
 * recall = (# must_find expectations across the set matched by >=1 KEPT
 * finding) / (total # must_find expectations). Zero must_find expectations
 * -> 1.0 (vacuously satisfied).
 */
export function computeRecall(kept: Finding[], expectations: EvalExpectation[]): number {
  const targets = mustFindTargets(expectations);
  if (targets.length === 0) return 1.0;
  const matchedCount = targets.filter((target) => kept.some((f) => matches(f, target))).length;
  return matchedCount / targets.length;
}

// ===========================================================================
// AC-7 — precision (over producedAll = kept ∪ dropped)
// ===========================================================================

/**
 * precision = (# produced findings that do NOT match any must_not_flag
 * target) / (total # produced findings), over the PRE-GROUNDING model output
 * (`producedAll`). Zero produced findings -> 1.0 (no false positives).
 */
export function computePrecision(producedAll: Finding[], expectations: EvalExpectation[]): number {
  if (producedAll.length === 0) return 1.0;
  const targets = mustNotFlagTargets(expectations);
  const nonOffending = producedAll.filter(
    (f) => !targets.some((target) => matches(f, target)),
  ).length;
  return nonOffending / producedAll.length;
}

// ===========================================================================
// AC-8 — citation_accuracy (grounding survival rate; null when degraded)
// ===========================================================================

/**
 * citation_accuracy = kept / (kept + dropped). `kept + dropped === 0` ->
 * 1.0 (no produced findings, nothing to ground). `opts.diffAvailable ===
 * false` -> `null` (degraded — the case's diff was empty/unparseable, so no
 * grounding could run at all; Rec-D).
 */
export function computeCitationAccuracy(
  keptCount: number,
  droppedCount: number,
  opts?: { diffAvailable?: boolean },
): number | null {
  if (opts?.diffAvailable === false) return null;
  const total = keptCount + droppedCount;
  if (total === 0) return 1.0;
  return keptCount / total;
}

// ===========================================================================
// AC-10 — per-case pass/fail
// ===========================================================================

export interface ScoreCaseInput {
  /** kept ∪ dropped — the pre-grounding model output. */
  producedAll: Finding[];
  /** Grounding survivors (post-grounding). */
  kept: Finding[];
  expectation: EvalExpectation;
  droppedCount: number;
  /** false -> citation_accuracy is null (degraded, Rec-D). */
  diffAvailable: boolean;
}

export interface ScoreCaseResult {
  recall: number;
  precision: number;
  citation_accuracy: number | null;
  pass: boolean;
}

/**
 * pass = per-case recall === 1.0 (via kept) AND no produced finding
 * (producedAll) matches any must_not_flag target in this case's expectation.
 */
export function scoreCase(input: ScoreCaseInput): ScoreCaseResult {
  const expectations = [input.expectation];
  const recall = computeRecall(input.kept, expectations);
  const precision = computePrecision(input.producedAll, expectations);
  const citation_accuracy = computeCitationAccuracy(input.kept.length, input.droppedCount, {
    diffAvailable: input.diffAvailable,
  });

  const mustNotFlagTargetsForCase = mustNotFlagTargets(expectations);
  const hasFalsePositive = input.producedAll.some((f) =>
    mustNotFlagTargetsForCase.some((target) => matches(f, target)),
  );

  const pass = recall === 1.0 && !hasFalsePositive;

  return { recall, precision, citation_accuracy, pass };
}

// ===========================================================================
// AC-11 — pooled set-level aggregate
// ===========================================================================

export interface PerCaseMetrics {
  recall: number;
  precision: number;
  citation_accuracy: number | null;
  pass: boolean;
}

export interface PooledMetrics {
  recall: number;
  precision: number;
  citation_accuracy: number;
  traces_passed: number;
  traces_total: number;
}

/**
 * Pools per-case metrics into a set-level aggregate. `recall`/`precision`
 * are the mean across all cases. `citation_accuracy` is the mean of only
 * the NON-degraded (non-null) per-case values — a degraded case (unparseable
 * diff) contributes no citation signal and must not silently drag the pooled
 * average toward zero/undefined.
 *
 * DESIGN CHOICE (documented per T4's acceptance): if EVERY case is degraded
 * (all citation_accuracy === null), the pooled citation_accuracy defaults to
 * 1.0 — the same "nothing to ground, nothing wrong" convention AC-8 uses for
 * the zero-produced-findings case, so the aggregate stays a finite, easily
 * averaged/trended number rather than null propagating into the dashboard's
 * trend chart and delta math.
 */
export function poolSetMetrics(perCase: PerCaseMetrics[]): PooledMetrics {
  const traces_total = perCase.length;
  const traces_passed = perCase.filter((c) => c.pass).length;

  if (traces_total === 0) {
    return { recall: 1.0, precision: 1.0, citation_accuracy: 1.0, traces_passed: 0, traces_total: 0 };
  }

  const recall = perCase.reduce((sum, c) => sum + c.recall, 0) / traces_total;
  const precision = perCase.reduce((sum, c) => sum + c.precision, 0) / traces_total;

  const groundedCitations = perCase
    .map((c) => c.citation_accuracy)
    .filter((v): v is number => v !== null);
  const citation_accuracy =
    groundedCitations.length === 0
      ? 1.0
      : groundedCitations.reduce((sum, v) => sum + v, 0) / groundedCitations.length;

  return { recall, precision, citation_accuracy, traces_passed, traces_total };
}

// ===========================================================================
// AC-14 — metric delta + regression detection
// ===========================================================================

export interface MetricSnapshot {
  recall: number;
  precision: number;
  citation_accuracy: number | null;
}

export interface MetricDelta {
  recall: number;
  precision: number;
  /** null when either side is degraded (null) — no comparable delta. */
  citation_accuracy: number | null;
}

/** Signed delta (curr - prev) per metric. Positive = improved, negative = dipped. */
export function metricDelta(curr: MetricSnapshot, prev: MetricSnapshot): MetricDelta {
  return {
    recall: curr.recall - prev.recall,
    precision: curr.precision - prev.precision,
    citation_accuracy:
      curr.citation_accuracy === null || prev.citation_accuracy === null
        ? null
        : curr.citation_accuracy - prev.citation_accuracy,
  };
}

export type MetricName = 'recall' | 'precision' | 'citation_accuracy';

export interface Regression {
  metric: MetricName;
  /** How much the metric dipped, as a positive number. */
  magnitude: number;
}

const METRIC_NAMES: MetricName[] = ['recall', 'precision', 'citation_accuracy'];

/**
 * Returns the dipped metric(s) + magnitude — any metric whose delta is
 * strictly negative (latest < previous) is a regression (AC-14). Returns an
 * empty array when nothing dipped (including when a metric's delta is
 * `null`, i.e. incomparable because one side was degraded).
 */
export function regressionOf(delta: MetricDelta): Regression[] {
  const regressions: Regression[] = [];
  for (const metric of METRIC_NAMES) {
    const value = delta[metric];
    if (value !== null && value < 0) {
      regressions.push({ metric, magnitude: Math.abs(value) });
    }
  }
  return regressions;
}
