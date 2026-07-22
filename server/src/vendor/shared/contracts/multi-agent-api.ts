import { z } from 'zod';
import { ReviewRunTarget } from './review-api.js';

/**
 * T1 — Multi-Agent Review: launch + estimate API shapes (L07 follow-on).
 *
 * These sit alongside `observability.ts` (`MultiAgentRun`, `AgentColumn`, `Conflict`),
 * which already model the multi-agent run/read shape:
 *   - MultiAgentRunLaunchBody    body of POST /pulls/:id/multi-agent-run
 *   - MultiAgentRunLaunchResult  response of POST /pulls/:id/multi-agent-run (launch ack)
 *   - MultiAgentEstimateAgent    one agent's cost/duration estimate
 *   - MultiAgentEstimate         response of GET /pulls/:id/multi-agent-estimate
 */

/** Body of POST /pulls/:id/multi-agent-run — which agents to fan out to. */
export const MultiAgentRunLaunchBody = z.object({
  agent_ids: z.array(z.string()).min(1),
});
export type MultiAgentRunLaunchBody = z.infer<typeof MultiAgentRunLaunchBody>;

/** Response of POST /pulls/:id/multi-agent-run — launch acknowledgement. */
export const MultiAgentRunLaunchResult = z.object({
  id: z.string(),
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
});
export type MultiAgentRunLaunchResult = z.infer<typeof MultiAgentRunLaunchResult>;

/** One agent's estimated duration/cost, derived from its recent run history. */
export const MultiAgentEstimateAgent = z.object({
  agent_id: z.string(),
  est_duration_ms: z.number().int().nullable(),
  est_cost_usd: z.number().nullable(),
});
export type MultiAgentEstimateAgent = z.infer<typeof MultiAgentEstimateAgent>;

/** Response of GET /pulls/:id/multi-agent-estimate. */
export const MultiAgentEstimate = z.object({
  agents: z.array(MultiAgentEstimateAgent),
  summary: z.object({
    est_duration_ms: z.number().int().nullable(),
    est_cost_usd: z.number().nullable(),
    agent_count: z.number().int(),
  }),
});
export type MultiAgentEstimate = z.infer<typeof MultiAgentEstimate>;
