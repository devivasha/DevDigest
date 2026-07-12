/**
 * smart-diff-classifier.test.ts — hermetic unit test for `groupSmartDiff`
 * (NOT *.it.test.ts, no DB, no route invocation).
 *
 * `classifyFile` already has dedicated coverage in `classifier.test.ts`
 * (untouched here per T9's owned paths). This file is the T3/T9
 * golden-file/parity test for the EXTRACTED `groupSmartDiff` pure function
 * (`docs/plans/why-risk-brief.md`, cross-model review finding #2): ≥3
 * representative `SmartDiffFile[]` inputs (small/under-threshold,
 * large/over-`LARGE_PR_THRESHOLD`, mixed-roles) plus an empty file list,
 * each asserted against a HAND-COMPUTED expected `SmartDiff` (not derived by
 * re-running the function under test) so a future regression in the
 * role-bucketing / split-suggestion logic is actually caught.
 */
import { describe, it, expect } from 'vitest';
import { groupSmartDiff, LARGE_PR_THRESHOLD } from './smart-diff-classifier.js';
import type { SmartDiffFile } from '@devdigest/shared';

function file(overrides: Partial<SmartDiffFile> & { path: string }): SmartDiffFile {
  return {
    additions: 0,
    deletions: 0,
    finding_lines: [],
    pseudocode_summary: null,
    ...overrides,
  };
}

describe('groupSmartDiff — golden/parity (T3 extraction, cross-model review #2)', () => {
  it('small PR, mixed roles, under LARGE_PR_THRESHOLD → no split suggestion', () => {
    const core = file({ path: 'src/modules/reviews/service.ts', additions: 20, deletions: 5, finding_lines: [12], pseudocode_summary: 'Adds: reviewPr' });
    const wiring = file({ path: 'src/index.ts', additions: 3, deletions: 1 });
    const boilerplate = file({ path: 'package-lock.json', additions: 100, deletions: 50 });

    const result = groupSmartDiff([core, wiring, boilerplate]);

    // total_lines = (20+5) + (3+1) + (100+50) = 179 — well under the 500 threshold.
    expect(result).toEqual({
      groups: [
        { role: 'core', files: [core] },
        { role: 'wiring', files: [wiring] },
        { role: 'boilerplate', files: [boilerplate] },
      ],
      split_suggestion: { too_big: false, total_lines: 179, proposed_splits: [] },
    });
    expect(LARGE_PR_THRESHOLD).toBe(500);
  });

  it('large PR over LARGE_PR_THRESHOLD with boilerplate present → proposed split into Logic changes / Lockfile', () => {
    const coreA = file({ path: 'src/modules/pulls/routes.ts', additions: 300, deletions: 100 });
    const coreB = file({ path: 'src/modules/pulls/smart-diff-classifier.ts', additions: 150, deletions: 50 });
    const boilerplate = file({ path: 'pnpm-lock.yaml', additions: 20, deletions: 10 });

    const result = groupSmartDiff([coreA, coreB, boilerplate]);

    // total_lines = 400 + 200 + 30 = 630 > 500.
    expect(result).toEqual({
      groups: [
        { role: 'core', files: [coreA, coreB] },
        { role: 'boilerplate', files: [boilerplate] },
      ],
      split_suggestion: {
        too_big: true,
        total_lines: 630,
        proposed_splits: [
          { name: 'Logic changes', files: ['src/modules/pulls/routes.ts', 'src/modules/pulls/smart-diff-classifier.ts'] },
          { name: 'Lockfile / generated', files: ['pnpm-lock.yaml'] },
        ],
      },
    });
  });

  it('mixed roles across all three buckets, insertion order preserved per bucket, corePaths = core-then-wiring', () => {
    const wiringA = file({ path: 'Dockerfile', additions: 5, deletions: 0 });
    const coreA = file({ path: 'client/src/components/Foo.tsx', additions: 10, deletions: 2 });
    const wiringB = file({ path: 'src/index.ts', additions: 2, deletions: 1 });
    const boilerplate = file({ path: 'dist/bundle.js', additions: 1000, deletions: 0 });
    const coreB = file({ path: 'reviewer-core/src/pipeline/run.ts', additions: 8, deletions: 3 });

    const result = groupSmartDiff([wiringA, coreA, wiringB, boilerplate, coreB]);

    // total_lines = 5 + 12 + 3 + 1000 + 11 = 1031 > 500.
    expect(result).toEqual({
      groups: [
        { role: 'core', files: [coreA, coreB] },
        { role: 'wiring', files: [wiringA, wiringB] },
        { role: 'boilerplate', files: [boilerplate] },
      ],
      split_suggestion: {
        too_big: true,
        total_lines: 1031,
        proposed_splits: [
          {
            name: 'Logic changes',
            // corePaths = core bucket files, THEN wiring bucket files (not input order).
            files: ['client/src/components/Foo.tsx', 'reviewer-core/src/pipeline/run.ts', 'Dockerfile', 'src/index.ts'],
          },
          { name: 'Lockfile / generated', files: ['dist/bundle.js'] },
        ],
      },
    });
  });

  it('empty file list (title-only PR) → empty groups, too_big:false, no crash (T3/T5 edge #5, cross-model disposition b)', () => {
    const result = groupSmartDiff([]);

    expect(result).toEqual({
      groups: [],
      split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
    });
  });
});
