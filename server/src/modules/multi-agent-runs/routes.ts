import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  MultiAgentEstimate,
  MultiAgentRun,
  MultiAgentRunLaunchBody,
  MultiAgentRunLaunchResult,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { MultiAgentRunsService } from './service.js';

/**
 * multi-agent-runs module routes (T5, multi-agent-review plan).
 *
 *   POST /pulls/:id/multi-agent-run              → launch a fan-out run (rate-limited 10/min)
 *   GET  /multi-agent-runs/:id                    → read one run (columns + conflicts, reload-safe)
 *   GET  /pulls/:id/multi-agent                   → latest run for a PR
 *   GET  /pulls/:id/multi-agent/estimate          → pre-run per-agent + summary estimate
 *
 * Onion layer: presentation — every handler resolves tenancy via `getContext`
 * FIRST (AC-12), then makes exactly one `MultiAgentRunsService` call, then
 * replies. No business logic or DB access lives here.
 *
 * These are the EXACT paths the client hooks
 * (`client/src/lib/hooks/multiAgent.ts`, T8) already call.
 */
/** Bounded, uuid-validated `agent_ids` CSV — accepts the client hook's
 * `?agent_ids=a,b,c` wire format but rejects malformed/oversized input at the
 * Zod boundary instead of letting a non-uuid reach the repo's uuid-column
 * comparison (which would 500) or an unbounded list drive an unbounded query. */
const MAX_ESTIMATE_AGENT_IDS = 20;
const EstimateQuery = z.object({
  agent_ids: z
    .string()
    .min(1)
    .transform((raw) =>
      raw
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().uuid()).min(1).max(MAX_ESTIMATE_AGENT_IDS)),
});

export default async function multiAgentRunsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new MultiAgentRunsService(container);

  // ---- Launch a fan-out run over N agents ---------------------------------
  // Same 10/min budget as `POST /pulls/:id/review` (Rec 1) — each call fans
  // out to N model-backed runs.
  app.post(
    '/pulls/:id/multi-agent-run',
    {
      schema: {
        params: IdParams,
        body: MultiAgentRunLaunchBody,
        response: { 200: MultiAgentRunLaunchResult },
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.launch(workspaceId, req.params.id, req.body.agent_ids);
    },
  );

  // ---- Read one multi-agent run by id (reload-safe results surface) -------
  app.get(
    '/multi-agent-runs/:id',
    { schema: { params: IdParams, response: { 200: MultiAgentRun } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getRun(workspaceId, req.params.id);
    },
  );

  // ---- Latest multi-agent run for a PR -------------------------------------
  app.get(
    '/pulls/:id/multi-agent',
    { schema: { params: IdParams, response: { 200: MultiAgentRun } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getLatest(workspaceId, req.params.id);
    },
  );

  // ---- Pre-run per-agent + summary estimate --------------------------------
  app.get(
    '/pulls/:id/multi-agent/estimate',
    {
      schema: {
        params: IdParams,
        querystring: EstimateQuery,
        response: { 200: MultiAgentEstimate },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.estimate(workspaceId, req.query.agent_ids);
    },
  );
}
