/**
 * scorer.test.ts — hermetic unit test for the pure eval scorer (L06, T4/T16).
 *
 * METHODOLOGY: every expected number in this file is derived directly from
 * `specs/2026-07-12-eval-pipeline.md` (AC-5..AC-10, AC-14) and the plan's
 * pinned "Final scorer input signature" block in `docs/plans/eval-pipeline.md`
 * — NOT from reading scorer.ts's implementation or from running it and
 * recording whatever came out. `scorer.ts` was read only to learn the exact
 * exported function names/signatures to call. A scorer that computes the
 * wrong arithmetic MUST fail these tests.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EvalExpectation, Finding } from '@devdigest/shared';
import {
  matches,
  computeRecall,
  computePrecision,
  computeCitationAccuracy,
  scoreCase,
  metricDelta,
  regressionOf,
} from './scorer.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let idSeq = 0;
function makeFinding(overrides: Partial<Finding> = {}): Finding {
  idSeq += 1;
  return {
    id: overrides.id ?? `f-${idSeq}`,
    severity: overrides.severity ?? 'WARNING',
    category: overrides.category ?? 'bug',
    title: overrides.title ?? 'A produced finding',
    file: overrides.file ?? 'src/a.ts',
    start_line: overrides.start_line ?? 10,
    end_line: overrides.end_line ?? 10,
    rationale: overrides.rationale ?? 'because',
    suggestion: overrides.suggestion ?? null,
    confidence: overrides.confidence ?? 0.9,
    kind: overrides.kind ?? 'finding',
    trifecta_components: overrides.trifecta_components ?? null,
    evidence: overrides.evidence ?? null,
  };
}

type ExpectedFinding = EvalExpectation['findings'][number];

function makeTarget(overrides: Partial<ExpectedFinding> = {}): ExpectedFinding {
  return {
    file: overrides.file ?? 'src/a.ts',
    start_line: overrides.start_line ?? 10,
    end_line: overrides.end_line ?? 10,
    severity: overrides.severity ?? 'WARNING',
    category: overrides.category ?? 'bug',
    title: overrides.title ?? 'an expected finding',
  };
}

function mustFind(...findings: ExpectedFinding[]): EvalExpectation {
  return { kind: 'must_find', findings };
}
function mustNotFlag(...findings: ExpectedFinding[]): EvalExpectation {
  return { kind: 'must_not_flag', findings };
}

// ---------------------------------------------------------------------------
// AC-5 — match iff file equal AND [start_line,end_line] overlap
// ---------------------------------------------------------------------------

describe('matches (AC-5)', () => {
  it('same file, identical single-line ranges -> true', () => {
    const a = makeFinding({ file: 'a.ts', start_line: 10, end_line: 10 });
    const b = makeTarget({ file: 'a.ts', start_line: 10, end_line: 10 });
    expect(matches(a, b)).toBe(true);
  });

  it('same file, ranges touching at the exact boundary max(starts)<=min(ends) -> true', () => {
    // a=[5,10], b=[10,15] -> max(5,10)=10 <= min(10,15)=10 -> true (touches at line 10)
    const a = makeFinding({ file: 'a.ts', start_line: 5, end_line: 10 });
    const b = makeTarget({ file: 'a.ts', start_line: 10, end_line: 15 });
    expect(matches(a, b)).toBe(true);
  });

  it('same file, ranges one line short of the boundary -> false', () => {
    // a=[5,9], b=[10,15] -> max(5,10)=10 <= min(9,15)=9 -> false (adjacent, no overlap)
    const a = makeFinding({ file: 'a.ts', start_line: 5, end_line: 9 });
    const b = makeTarget({ file: 'a.ts', start_line: 10, end_line: 15 });
    expect(matches(a, b)).toBe(false);
  });

  it('different file, identical line ranges -> false', () => {
    const a = makeFinding({ file: 'a.ts', start_line: 10, end_line: 10 });
    const b = makeTarget({ file: 'b.ts', start_line: 10, end_line: 10 });
    expect(matches(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-6 — recall over kept, vacuous 1.0
// ---------------------------------------------------------------------------

describe('computeRecall (AC-6)', () => {
  it('4 must_find expectations, 3 matched by a kept finding -> 0.75', () => {
    const expectations = [
      mustFind(makeTarget({ file: 'a.ts', start_line: 1, end_line: 1 })),
      mustFind(makeTarget({ file: 'a.ts', start_line: 2, end_line: 2 })),
      mustFind(makeTarget({ file: 'a.ts', start_line: 3, end_line: 3 })),
      mustFind(makeTarget({ file: 'a.ts', start_line: 4, end_line: 4 })),
    ];
    const kept = [
      makeFinding({ file: 'a.ts', start_line: 1, end_line: 1 }),
      makeFinding({ file: 'a.ts', start_line: 2, end_line: 2 }),
      makeFinding({ file: 'a.ts', start_line: 3, end_line: 3 }),
      // no kept finding covers line 4 -> that must_find target is unmatched
    ];
    expect(computeRecall(kept, expectations)).toBeCloseTo(0.75);
  });

  it('zero must_find expectations in the set -> 1.0 (vacuously satisfied), even with must_not_flag expectations present and zero kept findings', () => {
    const expectations = [mustNotFlag(makeTarget({ file: 'a.ts', start_line: 1, end_line: 1 }))];
    expect(computeRecall([], expectations)).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// AC-7 — precision over producedAll (kept UNION dropped), zero -> 1.0
// ---------------------------------------------------------------------------

describe('computePrecision (AC-7)', () => {
  it('10 producedAll findings, 1 matching a must_not_flag target -> 0.9', () => {
    const target = makeTarget({ file: 'a.ts', start_line: 50, end_line: 50 });
    const expectations = [mustNotFlag(target)];
    const offending = makeFinding({ file: 'a.ts', start_line: 50, end_line: 50 });
    const clean = Array.from({ length: 9 }, (_, i) =>
      makeFinding({ file: 'a.ts', start_line: 100 + i, end_line: 100 + i }),
    );
    const producedAll = [offending, ...clean];
    expect(producedAll).toHaveLength(10);
    expect(computePrecision(producedAll, expectations)).toBeCloseTo(0.9);
  });

  it('zero produced findings -> 1.0 (no false positives possible)', () => {
    expect(computePrecision([], [mustNotFlag(makeTarget())])).toBe(1.0);
  });

  it('the denominator is producedAll (kept UNION dropped), NOT kept — a hallucinated must_not_flag hit still counts as a false positive even when grounding drops it out of kept', () => {
    const target = makeTarget({ file: 'a.ts', start_line: 50, end_line: 50 });
    const expectations = [mustNotFlag(target)];
    // the offender is produced by the model but did NOT survive grounding
    // (e.g. dropped for an unrelated reason) — it's still in producedAll.
    const offender = makeFinding({ id: 'offender', file: 'a.ts', start_line: 50, end_line: 50 });
    const clean = makeFinding({ file: 'a.ts', start_line: 200, end_line: 200 });
    const producedAll = [offender, clean];
    const kept = [clean]; // grounding dropped the offender

    // Scoring against `kept` alone would (wrongly) read as perfectly clean —
    // proves precision must NOT be computed over kept.
    expect(computePrecision(kept, expectations)).toBe(1.0);
    // Scoring against `producedAll` correctly counts the offender.
    expect(computePrecision(producedAll, expectations)).toBeCloseTo(0.5);
  });
});

// ---------------------------------------------------------------------------
// AC-8 — citation_accuracy = kept/(kept+dropped); zero -> 1.0; degraded -> null
// ---------------------------------------------------------------------------

describe('computeCitationAccuracy (AC-8)', () => {
  it('6 kept / 8 producedAll (2 dropped) -> 0.75', () => {
    expect(computeCitationAccuracy(6, 2)).toBeCloseTo(0.75);
  });

  it('0 kept + 0 dropped (nothing produced) -> 1.0', () => {
    expect(computeCitationAccuracy(0, 0)).toBe(1.0);
  });

  it('opts.diffAvailable === false -> null (degraded), regardless of the kept/dropped counts', () => {
    expect(computeCitationAccuracy(3, 1, { diffAvailable: false })).toBeNull();
    expect(computeCitationAccuracy(0, 0, { diffAvailable: false })).toBeNull();
  });

  it('all-dropped: 0 kept, N>0 dropped -> 0.0 (a valid outcome, not an error/null)', () => {
    expect(computeCitationAccuracy(0, 5)).toBe(0.0);
  });
});

// ---------------------------------------------------------------------------
// AC-9 — the scoring step makes ZERO LLM/provider calls (structural proof)
// ---------------------------------------------------------------------------

describe('AC-9 — zero LLM/provider calls in scoring', () => {
  it('scorer.ts imports no LLM/provider/db/container/reviewer-core symbol (source-level structural proof)', () => {
    const src = readFileSync(fileURLToPath(new URL('./scorer.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/LLMProvider/);
    expect(src).not.toMatch(/from ['"].*\/container/);
    expect(src).not.toMatch(/from ['"].*\/db\//);
    expect(src).not.toMatch(/reviewer-core/);
    // The only import is the `@devdigest/shared` TYPES used for typing inputs.
    expect(src).toMatch(/import type \{[^}]*\} from '@devdigest\/shared';/);
  });

  it('every scorer function is PURE: identical inputs -> identical outputs, deterministically, with no provider in scope', () => {
    const kept = [makeFinding({ file: 'a.ts', start_line: 1, end_line: 1 })];
    const producedAll = [...kept, makeFinding({ file: 'a.ts', start_line: 99, end_line: 99 })];
    const expectation = mustFind(makeTarget({ file: 'a.ts', start_line: 1, end_line: 1 }));
    const input = { producedAll, kept, expectation, droppedCount: 1, diffAvailable: true };

    // A stubbed/absent LLM provider cannot influence this — no provider is
    // referenced anywhere in the call graph below; repeated calls with the
    // exact same arguments must produce byte-identical results.
    const first = scoreCase(input);
    const second = scoreCase(input);
    const third = scoreCase({ ...input });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });
});

// ---------------------------------------------------------------------------
// AC-10 — per-case pass/fail
// ---------------------------------------------------------------------------

describe('scoreCase (AC-10)', () => {
  it('must_find case: expected finding matched by a kept finding, no false positive -> pass:true', () => {
    const expectation = mustFind(makeTarget({ file: 'a.ts', start_line: 10, end_line: 10 }));
    const kept = [makeFinding({ file: 'a.ts', start_line: 10, end_line: 10 })];
    const result = scoreCase({
      producedAll: kept,
      kept,
      expectation,
      droppedCount: 0,
      diffAvailable: true,
    });
    expect(result.recall).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  it('must_find case: expected finding missed by every kept finding -> pass:false', () => {
    const expectation = mustFind(makeTarget({ file: 'a.ts', start_line: 10, end_line: 10 }));
    const result = scoreCase({
      producedAll: [],
      kept: [],
      expectation,
      droppedCount: 0,
      diffAvailable: true,
    });
    expect(result.recall).toBe(0.0);
    expect(result.pass).toBe(false);
  });

  it('must_not_flag case: a producedAll finding lands on the target -> pass:false', () => {
    const target = makeTarget({ file: 'a.ts', start_line: 20, end_line: 20 });
    const expectation = mustNotFlag(target);
    const offender = makeFinding({ file: 'a.ts', start_line: 20, end_line: 20 });
    const result = scoreCase({
      producedAll: [offender],
      kept: [],
      expectation,
      droppedCount: 1,
      diffAvailable: true,
    });
    expect(result.pass).toBe(false);
  });

  it('must_not_flag case: zero produced findings on the target -> pass:true', () => {
    const target = makeTarget({ file: 'a.ts', start_line: 20, end_line: 20 });
    const expectation = mustNotFlag(target);
    const result = scoreCase({
      producedAll: [],
      kept: [],
      expectation,
      droppedCount: 0,
      diffAvailable: true,
    });
    expect(result.pass).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-14 — metricDelta / regressionOf
// ---------------------------------------------------------------------------

describe('metricDelta / regressionOf (AC-14)', () => {
  it('precision 0.93 -> 0.91 (a run drop of 2pts) is reported as a precision regression of magnitude ~0.02', () => {
    const prev = { recall: 1.0, precision: 0.93, citation_accuracy: 0.9 };
    const curr = { recall: 1.0, precision: 0.91, citation_accuracy: 0.9 };
    const delta = metricDelta(curr, prev);
    expect(delta.precision).toBeCloseTo(-0.02);

    const regressions = regressionOf(delta);
    expect(regressions).toHaveLength(1);
    expect(regressions[0]!.metric).toBe('precision');
    expect(regressions[0]!.magnitude).toBeCloseTo(0.02);
  });

  it('every metric improved or held steady -> no regression reported', () => {
    const prev = { recall: 0.8, precision: 0.9, citation_accuracy: 0.9 };
    const curr = { recall: 0.9, precision: 0.95, citation_accuracy: 0.9 };
    expect(regressionOf(metricDelta(curr, prev))).toEqual([]);
  });

  it('a null citation_accuracy on either side makes that delta incomparable — never reported as a regression', () => {
    const prev = { recall: 1.0, precision: 1.0, citation_accuracy: null };
    const curr = { recall: 1.0, precision: 1.0, citation_accuracy: 0.5 };
    const delta = metricDelta(curr, prev);
    expect(delta.citation_accuracy).toBeNull();
    expect(regressionOf(delta)).toEqual([]);
  });
});
