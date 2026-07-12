import { eq } from 'drizzle-orm';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import { StripeClient } from '../../adapters/stripe/stripe.js';
import { BillingRepository, type InvoiceRow } from './repository.js';

/**
 * B1 — billing service. Invoices, charges, and plan/seat accounting for the
 * billing dashboard.
 */

export class BillingService {
  private repo: BillingRepository;

  constructor(private container: Container) {
    this.repo = new BillingRepository(container.db);
  }

  async listInvoices(workspaceId: string): Promise<InvoiceRow[]> {
    return this.repo.listByWorkspace(workspaceId);
  }

  async openInvoiceCount(workspaceId: string): Promise<number> {
    const rows = await this.container.db
      .select()
      .from(t.invoices)
      .where(eq(t.invoices.workspaceId, workspaceId));
    return rows.filter((r) => r.status === 'open').length;
  }

  async chargeWorkspace(workspaceId: string, amountCents: number): Promise<string> {
    const stripe = new StripeClient(process.env.STRIPE_KEY!);
    const charge = await stripe.charge({ workspaceId, amountCents });
    await this.repo.markPaid(charge.invoiceId);
    return charge.id;
  }
}
