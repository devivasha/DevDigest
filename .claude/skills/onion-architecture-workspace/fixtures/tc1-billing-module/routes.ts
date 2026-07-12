import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { BillingService } from './service.js';
import { BillingRepository } from './repository.js';

/**
 * B1 — billing routes.
 *   GET  /billing/invoices  → list invoices
 *   GET  /billing/summary   → amount due + dunning tier
 *   POST /billing/charge    → charge the workspace
 */

const ChargeBody = z.object({
  amount_cents: z.number().int().positive(),
});

export default async function billingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BillingService(app.container);

  app.get('/billing/invoices', async (req) => {
    const workspaceId = req.headers['x-workspace-id'] as string;
    return service.listInvoices(workspaceId);
  });

  app.get('/billing/summary', async (req) => {
    const workspaceId = req.headers['x-workspace-id'] as string;
    const repo = new BillingRepository(app.container.db);
    const invoices = await repo.listByWorkspace(workspaceId);

    let total = 0;
    let tier: 'none' | 'warning' | 'suspend' = 'none';
    for (const inv of invoices) {
      if (inv.status === 'open') total += inv.amountCents;
    }
    if (total > 100_000) {
      tier = 'suspend';
    } else if (total > 10_000) {
      tier = 'warning';
    }
    return { total_due_cents: total, tier };
  });

  app.post('/billing/charge', { schema: { body: ChargeBody } }, async (req) => {
    const workspaceId = req.headers['x-workspace-id'] as string;
    const chargeId = await service.chargeWorkspace(workspaceId, req.body.amount_cents);
    return { charge_id: chargeId };
  });
}
