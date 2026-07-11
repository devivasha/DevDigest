import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { repos } from './repos';

// ============================================================ Onboarding tours

/**
 * `onboarding_tours` — the generated per-(workspace, repo) onboarding tour.
 *
 * Replaces the earlier unused `onboarding` placeholder table (dropped in the
 * same migration as this table's creation). One row per (workspaceId, repoId)
 * — `UNIQUE (workspace_id, repo_id)` is the `ON CONFLICT` target for
 * upsert/replace-on-regenerate (AC-15). `indexUpdatedAt` captures the
 * repo-intel index's `updatedAt` at generation time so callers can detect
 * "facts changed since this tour was generated" (AC-16) without a join.
 */
export const onboardingTours = pgTable(
  'onboarding_tours',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    sections: jsonb('sections').notNull(),
    repoName: text('repo_name').notNull(),
    indexFileCount: integer('index_file_count').notNull().default(0),
    generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
    indexUpdatedAt: timestamp('index_updated_at', { withTimezone: true }),
    degraded: boolean('degraded').notNull().default(false),
    degradedReason: text('degraded_reason'),
  },
  (t) => ({
    workspaceRepoUq: uniqueIndex('onboarding_tours_workspace_repo_uq').on(
      t.workspaceId,
      t.repoId,
    ),
    repoIdx: index('onboarding_tours_repo_idx').on(t.repoId),
  }),
);
