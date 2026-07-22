import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { buildWorkflowFile, type CiWorkflowInput } from './workflow.js';
import { RUNNER_ENTRY_PATH, SUPPORTED_TRIGGERS, WORKFLOW_PATH } from './constants.js';

/**
 * T11 — hermetic unit tests for `workflow.ts` (pure workflow-yml generation,
 * no DB/network). Covers AC-6, AC-8, AC-9.
 */

interface WorkflowDoc {
  on: { pull_request: { types: string[] } };
  jobs: {
    review: {
      steps: Array<{ name?: string; uses?: string; run?: string; env?: Record<string, string> }>;
    };
  };
}

function parseWorkflow(contents: string): WorkflowDoc {
  return parseYaml(contents) as WorkflowDoc;
}

describe('buildWorkflowFile — bundled runner, no marketplace action (AC-6)', () => {
  it('runs the bundled runner directly via `run:`, not a DevDigest marketplace `uses:`', () => {
    const input: CiWorkflowInput = { triggers: ['opened', 'synchronize'], postAs: 'github_review' };
    const file = buildWorkflowFile(input);
    expect(file.path).toBe(WORKFLOW_PATH);
    expect(file.editable).toBe(true);

    const doc = parseWorkflow(file.contents);
    const steps = doc.jobs.review.steps;

    // AC-6 observable: the review step is `run: node .devdigest/runner/index.js`.
    const reviewStep = steps.find((s) => typeof s.run === 'string' && s.run.includes(RUNNER_ENTRY_PATH));
    expect(reviewStep).toBeDefined();
    expect(reviewStep!.run).toBe(`node ${RUNNER_ENTRY_PATH}`);
    // The review step must not itself be a `uses:` action.
    expect(reviewStep!.uses).toBeUndefined();

    // No step anywhere in the job invokes a DevDigest-published/third-party
    // review marketplace action — any `uses:` present (e.g. actions/checkout)
    // is scaffolding only, and none reference a devdigest review action.
    const usesSteps = steps.filter((s) => typeof s.uses === 'string');
    for (const step of usesSteps) {
      expect(step.uses).not.toMatch(/devdigest.*review/i);
    }
    // actions/checkout is permitted/expected as required scaffolding.
    expect(usesSteps.some((s) => s.uses?.startsWith('actions/checkout'))).toBe(true);
  });
});

describe('buildWorkflowFile — triggers (AC-8)', () => {
  it('derives on.pull_request.types 1:1 from the selected triggers, in canonical order', () => {
    const file = buildWorkflowFile({ triggers: ['synchronize', 'opened'], postAs: 'github_review' });
    const doc = parseWorkflow(file.contents);
    // Canonical SUPPORTED_TRIGGERS order (opened, synchronize, reopened),
    // regardless of the input array's order; `reopened` is excluded since it
    // was not selected.
    expect(doc.on.pull_request.types).toEqual(['opened', 'synchronize']);
  });

  it('toggling `reopened` on changes the generated workflow types list accordingly', () => {
    const without = parseWorkflow(
      buildWorkflowFile({ triggers: ['opened', 'synchronize'], postAs: 'github_review' }).contents,
    );
    const withReopened = parseWorkflow(
      buildWorkflowFile({ triggers: ['opened', 'synchronize', 'reopened'], postAs: 'github_review' }).contents,
    );
    expect(without.on.pull_request.types).not.toContain('reopened');
    expect(withReopened.on.pull_request.types).toContain('reopened');
    expect(withReopened.on.pull_request.types).toEqual([...SUPPORTED_TRIGGERS]);
  });

  it('falls back to all supported triggers when none are recognized/selected', () => {
    const doc = parseWorkflow(buildWorkflowFile({ triggers: [], postAs: 'github_review' }).contents);
    expect(doc.on.pull_request.types).toEqual([...SUPPORTED_TRIGGERS]);
  });
});

describe('buildWorkflowFile — post_as wiring (AC-9)', () => {
  it.each(['github_review', 'pr_comment', 'none'] as const)(
    'wires post_as=%s into the runner env (DEVDIGEST_POST_AS)',
    (postAs) => {
      const doc = parseWorkflow(buildWorkflowFile({ triggers: ['opened'], postAs }).contents);
      const reviewStep = doc.jobs.review.steps.find((s) => s.run?.includes('runner/index.js'));
      expect(reviewStep?.env?.DEVDIGEST_POST_AS).toBe(postAs);
    },
  );
});
