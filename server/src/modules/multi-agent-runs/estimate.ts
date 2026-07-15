import type { MultiAgentEstimate, MultiAgentEstimateAgent } from '@devdigest/shared';

/**
 * T3 — Pure estimate summary (multi-agent-review plan, Phase 2).
 *
 * Zero I/O, zero LLM — `summariseEstimate` is plain arithmetic over the
 * per-agent estimates the repository (T4) will compute from recent completed
 * `agent_runs` history. Deterministic: same input always yields the same
 * summary.
 */

/**
 * summariseEstimate — reduce the per-agent duration/cost estimates into the
 * fan-out summary:
 *  - `est_cost_usd` is the SUM of every agent's known cost estimate.
 *  - `est_duration_ms` is the MAX of every agent's known duration estimate
 *    (agents run in parallel, so the fan-out wall-clock is bounded by the
 *    slowest one, not the sum).
 *  - Cold-start agents (no prior completed runs -> `est_duration_ms`/
 *    `est_cost_usd` both `null`, "no estimate yet") are EXCLUDED from both
 *    reductions. If every agent is cold-start, the corresponding summary
 *    field is `null` rather than `0` — there is nothing to estimate from,
 *    not a genuinely-zero estimate.
 *  - `agent_count` is always the total number of agents being estimated
 *    (cold-start agents still count — the summary calls out "no estimate
 *    yet" separately from "not part of this launch").
 */
export function summariseEstimate(
  perAgent: MultiAgentEstimateAgent[],
): MultiAgentEstimate['summary'] {
  const durations = perAgent
    .map((a) => a.est_duration_ms)
    .filter((d): d is number => d !== null);
  const costs = perAgent.map((a) => a.est_cost_usd).filter((c): c is number => c !== null);

  return {
    est_duration_ms: durations.length > 0 ? Math.max(...durations) : null,
    est_cost_usd: costs.length > 0 ? costs.reduce((sum, c) => sum + c, 0) : null,
    agent_count: perAgent.length,
  };
}
