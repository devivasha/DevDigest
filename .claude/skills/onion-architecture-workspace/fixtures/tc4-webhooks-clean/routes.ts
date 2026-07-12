import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { WebhooksService } from './service.js';

/**
 * W1 — webhooks routes.
 *   GET    /webhooks            → list (workspace-scoped)
 *   GET    /webhooks/:id        → one
 *   POST   /webhooks            → create
 *   PUT    /webhooks/:id/active → enable/disable
 *   DELETE /webhooks/:id        → remove
 */

const WebhookEventEnum = z.enum(['pull_request', 'push', 'review']);

const CreateWebhookBody = z.object({
  url: z.string().url(),
  events: z.array(WebhookEventEnum).min(1),
});

const SetActiveBody = z.object({
  active: z.boolean(),
});

export default async function webhooksRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new WebhooksService(app.container);

  app.get('/webhooks', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.get('/webhooks/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const webhook = await service.get(workspaceId, req.params.id);
    if (!webhook) throw new NotFoundError('Webhook not found');
    return webhook;
  });

  app.post('/webhooks', { schema: { body: CreateWebhookBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const webhook = await service.create(workspaceId, req.body);
    reply.status(201);
    return webhook;
  });

  app.put(
    '/webhooks/:id/active',
    { schema: { params: IdParams, body: SetActiveBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const webhook = await service.setActive(workspaceId, req.params.id, req.body.active);
      if (!webhook) throw new NotFoundError('Webhook not found');
      return webhook;
    },
  );

  app.delete('/webhooks/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Webhook not found');
    return { ok: true };
  });
}
