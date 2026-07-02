/**
 * runReviewAndWait — application layer.
 *
 * Triggers a review run, polls for completion, and returns a plain
 * discriminated union.  No MCP/toolOk/toolError code here — the thin tool
 * layer (T8) maps the result to MCP.
 *
 * Flow:
 *  (a) POST /pulls/:pullId/review  → capture runs[0].run_id
 *  (b) Poll /pulls/:pullId/runs every pollIntervalMs up to runTimeoutMs.
 *      Find the RunSummary with matching run_id; watch status:
 *        done            → success path
 *        failed/cancelled → failure path
 *        null/unknown/running → still running, keep polling
 *  (c) On done:  GET /pulls/:pullId/reviews → pickReview → shapeFindings(concise)
 *      On failed/cancelled: return { kind:"failed", run_id, error }
 *      On timeout:          return { kind:"running", run_id }
 *
 * Layer: application/orchestration.  Imports client (infrastructure) + core
 * findings helpers.  Never imports tools/* or the MCP SDK.
 */

import type { DevDigestClient } from '../http/client.js';
import type { pickReview as PickReviewFn, shapeFindings as ShapeFindingsFn } from './findings.js';
import type { CompactFinding } from '../format.js';
import type { FindingCounts } from './findings.js';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type RunReviewDone = {
  kind: 'done';
  verdict: string | null;
  score: number | null;
  counts: FindingCounts;
  findings: CompactFinding[];
};

export type RunReviewRunning = {
  kind: 'running';
  run_id: string;
};

export type RunReviewFailed = {
  kind: 'failed';
  run_id: string;
  error: string;
};

export type RunReviewResult = RunReviewDone | RunReviewRunning | RunReviewFailed;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type RunReviewOpts = {
  pollIntervalMs: number;
  runTimeoutMs: number;
};

export type RunReviewDeps = {
  pickReview: typeof PickReviewFn;
  shapeFindings: typeof ShapeFindingsFn;
};

// ---------------------------------------------------------------------------
// Sleep helper — real async delay, no busy-loop
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Trigger a review run for (pullId, agentId) and wait for it to finish.
 *
 * Returns a RunReviewResult discriminated union.  The caller (T8 tool) maps
 * this to MCP tool output.
 *
 * Rate-limit note: POST /pulls/:id/review is limited to 10/min — this
 * function triggers exactly once regardless of polling iterations.
 */
export async function runReviewAndWait(
  client: DevDigestClient,
  params: { pullId: string; agentId: string },
  opts: RunReviewOpts,
  deps: RunReviewDeps,
): Promise<RunReviewResult> {
  const { pullId, agentId } = params;
  const { pollIntervalMs, runTimeoutMs } = opts;
  const { pickReview, shapeFindings } = deps;

  // (a) Trigger the review — fire-and-forget background job
  const triggered = await client.triggerReview(pullId, agentId);
  const runInfo = triggered.runs[0];
  if (!runInfo) {
    return {
      kind: 'failed',
      run_id: '',
      error: `Trigger returned no run entries for pull ${pullId} / agent ${agentId}.`,
    };
  }
  const run_id = runInfo.run_id;

  // (b) Poll until done, failed, cancelled, or timeout
  const deadline = Date.now() + runTimeoutMs;

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);

    let runs;
    try {
      runs = await client.listRuns(pullId);
    } catch {
      // Network hiccup — keep polling until timeout
      continue;
    }

    const summary = runs.find((r) => r.run_id === run_id);
    if (!summary) {
      // Not yet visible in the run list — keep polling
      continue;
    }

    const status = summary.status;

    if (status === 'done') {
      // (c) Fetch reviews and shape the result
      let reviews;
      try {
        reviews = await client.listReviews(pullId);
      } catch (cause) {
        return {
          kind: 'failed',
          run_id,
          error: `Run completed but could not fetch reviews: ${String(cause)}`,
        };
      }

      const review = pickReview(reviews, { runId: run_id });
      if (!review) {
        return {
          kind: 'failed',
          run_id,
          error: `Run ${run_id} is done but no matching review record was found.`,
        };
      }

      const shaped = shapeFindings(review, {
        format: 'concise',
        offset: 0,
        limit: 20,
      });

      return {
        kind: 'done',
        verdict: shaped.verdict,
        score: shaped.score,
        counts: shaped.counts,
        findings: shaped.findings as CompactFinding[],
      };
    }

    if (status === 'failed' || status === 'cancelled') {
      return {
        kind: 'failed',
        run_id,
        error: summary.error ?? `Run ${run_id} ended with status '${status}'.`,
      };
    }

    // status is null, 'running', or any unknown string → still running, keep polling
  }

  // (c) Timeout — return running fallback
  return { kind: 'running', run_id };
}
