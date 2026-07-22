/* Pure formatting helpers for the Configure-run page (T13). Local to this
   feature — the existing `formatCost`/`formatSeconds` pair lives inside
   `pulls/[number]/_components/RunTraceDrawer/helpers.ts`, a different
   feature's private `_components` dir, so it is not reused here (would
   create cross-feature coupling per frontend-architecture's colocation
   rule); these are simple enough that duplication is cheaper than a new
   shared util for two one-line formatters. */

import type { MultiAgentEstimateAgent } from "@devdigest/shared";

/** "8.2s" for sub-minute durations, "2m" once a minute or more. */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

/** "$0.20" — 2dp USD. Estimates are always approximate (AC-9), so the extra
   precision `formatCost` (RunTraceDrawer) applies for real run costs isn't
   needed here. */
export function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** Fan-out summary for the CURRENTLY SELECTED agents, computed client-side
   from the full per-agent estimate list (AC-6/AC-7 requires the estimate
   request to cover every listed agent, not just the selected ones, so the
   server's own `summary` field — which aggregates whatever ids were
   requested — no longer matches "the current selection" once every row is
   fetched). Mirrors the server's `summariseEstimate`
   (`server/src/modules/multi-agent-runs/estimate.ts`) exactly: duration is
   the MAX of known durations (agents run in parallel), cost is the SUM of
   known costs, and cold-start (null) agents are excluded from both
   reductions but still count toward `agent_count`. */
export function summarizeSelectedEstimate(
  selectedAgentIds: string[],
  agents: MultiAgentEstimateAgent[] | undefined,
): { est_duration_ms: number | null; est_cost_usd: number | null; agent_count: number } {
  const selectedEntries = selectedAgentIds.map((id) => agents?.find((a) => a.agent_id === id));
  const durations = selectedEntries
    .map((a) => a?.est_duration_ms)
    .filter((d): d is number => d != null);
  const costs = selectedEntries.map((a) => a?.est_cost_usd).filter((c): c is number => c != null);

  return {
    est_duration_ms: durations.length > 0 ? Math.max(...durations) : null,
    est_cost_usd: costs.length > 0 ? costs.reduce((sum, c) => sum + c, 0) : null,
    agent_count: selectedAgentIds.length,
  };
}
