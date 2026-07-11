import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BriefRecord } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BriefService } from './service.js';

/**
 * brief module routes (T6).
 *
 * GET  /pulls/:id/brief             → lazy compute-if-absent (auto-load on Overview open)
 * POST /pulls/:id/brief/regenerate  → always re-computes (single LLM call, rate-limited)
 *
 * Onion layer: presentation — thin handlers: getContext (tenancy) → one
 * service call → reply. No business logic here.
 *
 * Both routes are rate-limited so AC-19's "11th request in 60s -> 429" holds
 * regardless of entry point — the lazy GET can also trigger the single LLM
 * call on a cache miss.
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  // ---- GET: lazy compute + return cached/computed brief -------------------
  app.get(
    '/pulls/:id/brief',
    {
      schema: { params: IdParams, response: { 200: BriefRecord } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new BriefService(app.container, req.log);
      return service.getOrCompute(workspaceId, req.params.id);
    },
  );

  // ---- POST: force regenerate ----------------------------------------------
  app.post(
    '/pulls/:id/brief/regenerate',
    {
      schema: { params: IdParams, response: { 200: BriefRecord } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new BriefService(app.container, req.log);
      const record = await service.regenerate(workspaceId, req.params.id);
      reply.status(200);
      return record;
    },
  );
}
