import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { DocumentContent, SaveDocumentBody } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { ProjectContextService } from './service.js';

const RepoParams = z.object({ repoId: z.string().uuid() });
const DocumentQuery = z.object({ path: z.string().min(1) });

/**
 * Project Context (T7). Thin presentation-layer plugin: validate params via
 * Zod, resolve tenancy context, delegate ALL orchestration to
 * `ProjectContextService`. No business logic (repo lookup, discovery,
 * guarded fs access) lives here.
 *
 *   GET /repos/:repoId/project-context                    -> { documents, summary }
 *   GET /repos/:repoId/project-context/document?path=...   -> DocumentContent
 *   PUT /repos/:repoId/project-context/document            -> DocumentContent
 */
export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get(
    '/repos/:repoId/project-context',
    { schema: { params: RepoParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const service = new ProjectContextService(container);
      return service.listForRepo(workspaceId, req.params.repoId);
    },
  );

  app.get(
    '/repos/:repoId/project-context/document',
    { schema: { params: RepoParams, querystring: DocumentQuery, response: { 200: DocumentContent } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const service = new ProjectContextService(container);
      return service.readDocument(workspaceId, req.params.repoId, req.query.path);
    },
  );

  app.put(
    '/repos/:repoId/project-context/document',
    { schema: { params: RepoParams, body: SaveDocumentBody, response: { 200: DocumentContent } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const service = new ProjectContextService(container);
      return service.saveDocument(workspaceId, req.params.repoId, req.body.path, req.body.text);
    },
  );
}
