import { z } from 'zod';
import { ChangedSymbol, DownstreamImpact, PrHistoryItem } from './brief.js';

/**
 * Blast Radius API contract — payload of `GET /pulls/:id/blast`.
 *
 * Composed from the existing brief building blocks (`ChangedSymbol`,
 * `DownstreamImpact`, `PrHistoryItem`) plus the fields the card needs that
 * `BlastRadius` does not carry:
 *   - `impacted_endpoints` / `impacted_crons`: flat top-level unions so the
 *     summary-strip counts populate even on the degraded index path (where
 *     per-symbol `factsByFile` attribution is unavailable).
 *   - `status` / `degraded` / `degraded_reason`: drive the honest
 *     partial/degraded badge instead of an empty screen.
 *   - `history`: prior PRs touching the same files ("Prior PRs" accordion).
 *   - `summary`: a DETERMINISTIC one-liner (no LLM).
 *
 * Field names are snake_case (contract convention); the facade's camelCase
 * `BlastResult` is mapped into this shape inside `blast/service.ts`.
 */
export const BlastStatus = z.enum(['full', 'partial', 'degraded', 'failed']);
export type BlastStatus = z.infer<typeof BlastStatus>;

export const BlastResponse = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  impacted_endpoints: z.array(z.string()),
  impacted_crons: z.array(z.string()),
  status: BlastStatus,
  degraded: z.boolean(),
  degraded_reason: z.string().nullish(),
  history: z.array(PrHistoryItem),
  summary: z.string(),
});
export type BlastResponse = z.infer<typeof BlastResponse>;
