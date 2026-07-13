import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  doublePrecision,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Eval / Conformance / Compose

export const evalCases = pgTable(
  'eval_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    inputDiff: text('input_diff'),
    inputFiles: jsonb('input_files'),
    inputMeta: jsonb('input_meta'),
    expectedOutput: jsonb('expected_output'),
    notes: text('notes'),
  },
  (t) => ({
    // Idempotent-seed target (ON CONFLICT DO NOTHING) — cross-model finding #3.
    ownerNameUq: uniqueIndex('eval_cases_owner_name_uq').on(t.workspaceId, t.ownerId, t.name),
  }),
);

/**
 * `eval_set_runs` — one row per `POST …/eval-runs` set-level aggregate. Also
 * carries the reproducibility snapshot (agent version + exact system prompt +
 * model) pinned at run time, so "old prompt vs new prompt" compares are
 * apples-to-apples (AC-12, AC-13).
 */
export const evalSetRuns = pgTable(
  'eval_set_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    agentVersion: integer('agent_version'),
    systemPrompt: text('system_prompt'),
    model: text('model'),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    tracesPassed: integer('traces_passed'),
    tracesTotal: integer('traces_total'),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
    underMin: boolean('under_min'),
  },
  (t) => ({
    wsIdx: index('eval_set_runs_ws_idx').on(t.workspaceId),
  }),
);

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => evalCases.id, { onDelete: 'cascade' }),
    // Structural tenancy — cross-model finding #1. Every eval_runs query must
    // filter by this directly, not only transitively via set_run_id.
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    setRunId: uuid('set_run_id').references(() => evalSetRuns.id, { onDelete: 'cascade' }),
    agentVersion: integer('agent_version'),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    actualOutput: jsonb('actual_output'),
    pass: boolean('pass'),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
  },
  (t) => ({
    setRunIdx: index('eval_runs_set_run_idx').on(t.setRunId),
    wsIdx: index('eval_runs_ws_idx').on(t.workspaceId),
  }),
);

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});
