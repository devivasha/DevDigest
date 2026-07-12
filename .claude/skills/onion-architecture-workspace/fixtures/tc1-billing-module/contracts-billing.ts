import { z } from 'zod';

/**
 * B1 — billing contracts. Shared invoice + plan types used by the billing
 * module (service/repo) and the client billing dashboard.
 */

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void';
export type PlanTier = 'free' | 'pro' | 'enterprise';

export interface Invoice {
  id: string;
  workspaceId: string;
  amountCents: number;
  status: InvoiceStatus;
  createdAt: string;
}

export const InvoiceSchema = z.object({
  id: z.string().uuid(),
  amount_cents: z.number().int().nonnegative(),
  status: z.enum(['draft', 'open', 'paid', 'void']),
});

export interface Subscription {
  workspaceId: string;
  tier: PlanTier;
  seats: number;
}
