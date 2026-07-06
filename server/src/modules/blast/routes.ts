import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq } from 'drizzle-orm';
import type { BlastResponse } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { BlastService } from './service.js';

/**
 * Blast Radius (T3). Thin presentation-layer plugin: validate params,
 * resolve the PR (scoped to workspace), dedupe its changed paths, delegate
 * ALL orchestration to `BlastService`. No business logic lives here.
 *
 *   GET /pulls/:id/blast -> BlastResponse
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get('/pulls/:id/blast', { schema: { params: IdParams } }, async (req): Promise<BlastResponse> => {
    const { workspaceId } = await getContext(container, req);
    const [pr] = await container.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, req.params.id)));
    if (!pr) throw new NotFoundError('Pull request not found');

    const rawFiles = await container.db.select().from(t.prFiles).where(eq(t.prFiles.prId, pr.id));
    // Deduplicate by path — mirrors the smart-diff route's guard against
    // duplicate `prFiles` rows from seed data / concurrent GitHub syncs.
    const changedPaths = [...new Set(rawFiles.map((f) => f.path))];

    const service = new BlastService(container);
    return service.getBlast(workspaceId, pr, changedPaths);
  });
}
