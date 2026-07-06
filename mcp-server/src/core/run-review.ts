/**
 * core/run-review.ts — the blocking review orchestration (application layer).
 *
 * A review runs in the BACKGROUND: `POST /pulls/:id/review` is fire-and-forget
 * and its response carries NO findings. So we trigger, then POLL
 * `GET /pulls/:id/runs` for the run's status, and once it's `done` read the
 * persisted review from `GET /pulls/:id/reviews`. On timeout we hand back
 * `{ kind: "running", run_id }` so the caller can retrieve results later.
 *
 * Pure orchestration: `client` + core helpers are injected; it returns a plain
 * discriminated union and contains NO MCP / `toolOk` / `toolError` code (that
 * mapping happens in the thin tool). Never imports `tools/*` or the MCP SDK.
 */

import type { DevDigestClient } from "../http/client.js";
import type { pickReview as PickReview, shapeFindings as ShapeFindings } from "./findings.js";

export type RunReviewResult =
  | {
      kind: "done";
      run_id: string;
      verdict: string | null;
      score: number | null;
      counts: { critical: number; warning: number; suggestion: number };
      findings: unknown[];
    }
  | { kind: "running"; run_id: string }
  | { kind: "failed"; run_id: string; error: string };

interface Deps {
  pickReview: typeof PickReview;
  shapeFindings: typeof ShapeFindings;
}

interface Opts {
  pollIntervalMs: number;
  runTimeoutMs: number;
  /** Concise finding limit for the inline result (kept small). */
  findingsLimit?: number;
  signal?: AbortSignal;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    };
    const t = setTimeout(() => {
      // Detach the abort listener on normal resolution — otherwise each poll
      // leaves a listener on the shared request signal and Node warns about a
      // MaxListeners leak across a long poll loop.
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** Terminal run states. Anything else (incl. null/unknown) = still running. */
function classify(status: string | null): "done" | "failed" | "running" {
  if (status === "done") return "done";
  if (status === "failed" || status === "cancelled") return "failed";
  return "running";
}

export async function runReviewAndWait(
  client: DevDigestClient,
  target: { pullId: string; agentId: string },
  opts: Opts,
  deps: Deps,
): Promise<RunReviewResult> {
  const trigger = await client.triggerReview(target.pullId, target.agentId);
  const runId = trigger.runs[0]?.run_id;
  if (!runId) {
    return {
      kind: "failed",
      run_id: "",
      error: "Review trigger returned no run — the agent may be disabled or not applicable to this PR.",
    };
  }

  const started = Date.now();
  const deadline = started + opts.runTimeoutMs;
  while (Date.now() < deadline) {
    await sleep(opts.pollIntervalMs, opts.signal);

    const runs = await client.listRuns(target.pullId);
    const run = runs.find((r) => r.run_id === runId);
    const state = classify(run?.status ?? null);

    if (state === "failed") {
      return { kind: "failed", run_id: runId, error: run?.error ?? "Review run failed." };
    }
    if (state === "done") {
      const reviews = await client.listReviews(target.pullId);
      const review = deps.pickReview(reviews, { runId });
      if (!review) {
        // Run completed but no persisted review row surfaced (e.g. summary-only).
        return { kind: "failed", run_id: runId, error: "Run finished but produced no review." };
      }
      const shaped = deps.shapeFindings(review, {
        format: "concise",
        offset: 0,
        limit: opts.findingsLimit ?? 10,
      });
      return {
        kind: "done",
        run_id: runId,
        verdict: shaped.verdict,
        score: shaped.score,
        counts: shaped.counts,
        findings: shaped.findings,
      };
    }
    // still running → keep polling
  }

  return { kind: "running", run_id: runId };
}
