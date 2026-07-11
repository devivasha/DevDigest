import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import * as t from "../../db/schema.js";
import type { OnboardingTourRow } from "../../db/rows.js";
import {
  OnboardingSectionsSchema,
  type OnboardingTour,
  type DegradedReason,
} from "@devdigest/shared";
export type { OnboardingTourRow };

export interface UpsertOnboardingTour {
  sections: unknown;
  repoName: string;
  indexFileCount: number;
  indexUpdatedAt: Date | null;
  degraded: boolean;
  degradedReason?: string | null;
}

export class OnboardingRepository {
  constructor(private db: Db) {}

  /** One row per (workspaceId, repoId) — filters on BOTH FK columns. */
  async get(
    workspaceId: string,
    repoId: string,
  ): Promise<OnboardingTourRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.onboardingTours)
      .where(
        and(
          eq(t.onboardingTours.workspaceId, workspaceId),
          eq(t.onboardingTours.repoId, repoId),
        ),
      );
    return row;
  }

  /**
   * Regenerate: `INSERT ... ON CONFLICT (workspace_id, repo_id) DO UPDATE`,
   * last-write-wins (AC-15). Conflict target matches T2's
   * `onboarding_tours_workspace_repo_uq` unique index exactly. `generatedAt`
   * is bumped to `now()` on every call (insert AND update) so callers always
   * see a fresh generation timestamp (AC-15); `indexUpdatedAt` is stored
   * verbatim from the caller for staleness comparisons (AC-16).
   */
  async upsert(
    workspaceId: string,
    repoId: string,
    tour: UpsertOnboardingTour,
  ): Promise<OnboardingTourRow> {
    const now = new Date();
    const values = {
      workspaceId,
      repoId,
      sections: tour.sections,
      repoName: tour.repoName,
      indexFileCount: tour.indexFileCount,
      generatedAt: now,
      indexUpdatedAt: tour.indexUpdatedAt,
      degraded: tour.degraded,
      degradedReason: tour.degradedReason ?? null,
    };
    const [row] = await this.db
      .insert(t.onboardingTours)
      .values(values)
      .onConflictDoUpdate({
        target: [t.onboardingTours.workspaceId, t.onboardingTours.repoId],
        set: {
          sections: values.sections,
          repoName: values.repoName,
          indexFileCount: values.indexFileCount,
          generatedAt: values.generatedAt,
          indexUpdatedAt: values.indexUpdatedAt,
          degraded: values.degraded,
          degradedReason: values.degradedReason,
        },
      })
      .returning();
    if (!row) {
      throw new Error("onboarding_tours upsert returned no row");
    }
    return row;
  }

  /**
   * Row -> DTO mapper. `sections` is validated against
   * `OnboardingSectionsSchema` (the same schema the extractor writes with),
   * so a malformed JSONB blob fails loudly here rather than downstream in
   * the client. `lastRefreshedAt` mirrors the repo-intel index's own
   * `updatedAt` (`indexUpdatedAt`) so the client can detect staleness against
   * `generatedAt`; falls back to `generatedAt` when the index has never
   * reported an `updatedAt` (e.g. degraded/no-data tours).
   */
  toDto(row: OnboardingTourRow): OnboardingTour {
    return {
      repoId: row.repoId,
      repoName: row.repoName,
      generatedAt: row.generatedAt.toISOString(),
      indexFileCount: row.indexFileCount,
      lastRefreshedAt: (row.indexUpdatedAt ?? row.generatedAt).toISOString(),
      degraded: row.degraded,
      degradedReason: (row.degradedReason ?? undefined) as
        | DegradedReason
        | undefined,
      sections: OnboardingSectionsSchema.parse(row.sections),
    };
  }
}
