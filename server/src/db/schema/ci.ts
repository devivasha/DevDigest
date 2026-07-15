import { pgTable, uuid, text, integer, timestamp, doublePrecision, unique, index } from 'drizzle-orm/pg-core';
import { agents } from './agents';

export const ciInstallations = pgTable(
  'ci_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repo: text('repo').notNull(),
    targetType: text('target_type', { enum: ['gha', 'circle', 'jenkins', 'cli'] }).notNull(),
    installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
    ingestSecretHash: text('ingest_secret_hash'),
    version: integer('version'),
  },
  (t) => [
    // FK index — `agentId` has no unique constraint of its own, and read
    // paths filter/join on it directly (`listAgentInstallations`,
    // `listWorkspaceCiRuns`'s `ci_installations -> agents` join).
    index('ci_installations_agent_idx').on(t.agentId),
  ]
);

export const ciRuns = pgTable(
  'ci_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, {
      onDelete: 'set null',
    }),
    prNumber: integer('pr_number'),
    ranAt: timestamp('ran_at', { withTimezone: true }),
    status: text('status'),
    findingsCount: integer('findings_count'),
    costUsd: doublePrecision('cost_usd'),
    githubUrl: text('github_url'),
    source: text('source'),
    durationMs: integer('duration_ms'),
  },
  (t) => [
    // NULLS NOT DISTINCT so replayed ingests with the same (installation, PR, ran_at)
    // collide even when pr_number/ran_at are null — drizzle-orm 0.38's `uniqueIndex()`
    // builder has no `.nullsNotDistinct()` method (only the table-level `unique()`
    // constraint builder does), so this is expressed as a UNIQUE CONSTRAINT rather
    // than a `uniqueIndex()` call. Postgres backs a UNIQUE constraint with a unique
    // index either way, so the collision guarantee is identical.
    unique('ci_runs_installation_pr_ranat_uq')
      .on(t.ciInstallationId, t.prNumber, t.ranAt)
      .nullsNotDistinct(),
  ]
);
