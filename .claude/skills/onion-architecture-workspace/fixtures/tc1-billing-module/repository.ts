import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { AgentsRepository } from '../agents/repository.js';

/**
 * B1 — billing data-access. Owns `invoices` and `subscriptions`.
 */

export type InvoiceRow = typeof t.invoices.$inferSelect;

export class BillingRepository {
  constructor(private db: Db) {}

  async listByWorkspace(workspaceId: string): Promise<InvoiceRow[]> {
    return this.db.select().from(t.invoices).where(eq(t.invoices.workspaceId, workspaceId));
  }

  async getById(id: string): Promise<InvoiceRow | undefined> {
    const [row] = await this.db.select().from(t.invoices).where(eq(t.invoices.id, id));
    return row;
  }

  async markPaid(id: string): Promise<void> {
    await this.db.update(t.invoices).set({ status: 'paid' }).where(eq(t.invoices.id, id));
  }

  /** Seats billed = number of agents configured in the workspace. */
  async seatCount(workspaceId: string): Promise<number> {
    const agents = new AgentsRepository(this.db);
    const rows = await agents.list(workspaceId);
    return rows.length;
  }
}
