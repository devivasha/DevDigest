import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';

const RepoParams = z.object({ repoId: z.string().uuid() });
const ConventionParams = z.object({ id: z.string().uuid() });
const UpdateRuleBody = z.object({ rule: z.string().min(1) });

/**
 * Conventions module.
 *   GET  /repos/:repoId/conventions          → list all candidates for the repo
 *   POST /repos/:repoId/conventions/scan     → trigger LLM scan (sync)
 *   POST /conventions/:id/accept             → mark accepted=true
 *   POST /conventions/:id/reject             → mark accepted=false
 *   PATCH /conventions/:id/rule              → inline edit rule text
 *   GET  /repos/:repoId/conventions/skill    → return pre-rendered skill body
 */
export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  app.get(
    '/repos/:repoId/conventions',
    { schema: { params: RepoParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.list(workspaceId, req.params.repoId);
    },
  );

  // POST /repos/:repoId/conventions/scan must be before /repos/:repoId/conventions/:id
  app.post(
    '/repos/:repoId/conventions/scan',
    { schema: { params: RepoParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const candidates = await service.scan(workspaceId, req.params.repoId);
      reply.status(201);
      return candidates;
    },
  );

  app.get(
    '/repos/:repoId/conventions/skill',
    { schema: { params: RepoParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const body = await service.buildSkillBodyForRepo(workspaceId, req.params.repoId);
      return { body };
    },
  );

  app.post(
    '/conventions/:id/accept',
    { schema: { params: ConventionParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.setAccepted(workspaceId, req.params.id, true);
      if (!result) throw new NotFoundError('Convention not found');
      return result;
    },
  );

  app.post(
    '/conventions/:id/reject',
    { schema: { params: ConventionParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.setAccepted(workspaceId, req.params.id, false);
      if (!result) throw new NotFoundError('Convention not found');
      return result;
    },
  );

  app.patch(
    '/conventions/:id/rule',
    { schema: { params: ConventionParams, body: UpdateRuleBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.updateRule(workspaceId, req.params.id, req.body.rule);
      if (!result) throw new NotFoundError('Convention not found');
      return result;
    },
  );
}
