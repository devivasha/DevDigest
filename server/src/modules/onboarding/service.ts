import { stat } from "node:fs/promises";
import { eq } from "drizzle-orm";
import type { Container } from "../../platform/container.js";
import type { OnboardingSections, OnboardingTour } from "@devdigest/shared";
import * as t from "../../db/schema.js";
import { NotFoundError } from "../../platform/errors.js";
import { OnboardingRepository } from "./repository.js";
import { collectFacts } from "./facts.js";
import { buildSkeleton } from "./skeleton.js";
import { generateSections } from "./extractor.js";
import { resolveFeatureModel } from "../settings/feature-models.js";

/**
 * Onboarding Tour orchestration (AC-2, AC-4, AC-5, AC-11, AC-12, AC-14,
 * AC-15, AC-16). Mirrors `conventions/service.ts`'s shape: the service owns
 * repo-row lookup + clone-dir guard + model resolution; `facts.ts` /
 * `skeleton.ts` / `extractor.ts` stay pure and container-free (extractor only
 * receives an already-resolved `llm`/`model`).
 */
export class OnboardingService {
  private repo: OnboardingRepository;

  constructor(private container: Container) {
    this.repo = new OnboardingRepository(container.db);
  }

  /**
   * Re-serves a stored tour with ZERO LLM calls (AC-14) — never regenerates
   * just because `getTour` was called. `stale` is computed ON READ (AC-16) by
   * comparing the CURRENT index `updatedAt` (a repoIntel facade read, not an
   * LLM call) against the stored tour's own `indexUpdatedAt`. Falls back to
   * `generate` only when no tour has ever been persisted for this
   * (workspace, repo) pair.
   */
  async getTour(workspaceId: string, repoId: string): Promise<OnboardingTour> {
    const row = await this.repo.get(workspaceId, repoId);
    if (!row) return this.generate(workspaceId, repoId);

    const dto = this.repo.toDto(row);
    // AC-2 header semantics: "last refreshed" reflects the tour's own
    // `generatedAt` (when it was last (re)generated) — NOT the raw index
    // `updatedAt`, which drives the `stale` compare below instead.
    dto.lastRefreshedAt = row.generatedAt.toISOString();

    const indexState = await this.container.repoIntel.getIndexState(repoId);
    dto.stale = row.indexUpdatedAt
      ? indexState.updatedAt.getTime() > row.indexUpdatedAt.getTime()
      : false;

    return dto;
  }

  /**
   * Generates (or regenerates — this is also the Regenerate path) the tour.
   * Degraded index state OR a missing clone directory NEVER reach the LLM —
   * a deterministic skeleton is built and persisted instead (AC-11/12), and
   * this method NEVER triggers `indexRepo`/`refreshIndex`/clone (AC-15), even
   * on regenerate. A schema-invalid model response also falls back to the
   * skeleton (AC-5). Exactly one `completeStructured` call happens per
   * non-degraded generation (AC-4).
   */
  async generate(workspaceId: string, repoId: string): Promise<OnboardingTour> {
    const [repoRow] = await this.container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    if (!repoRow) throw new NotFoundError("Repository not found");

    const facts = await collectFacts(this.container, repoId);

    // Guard the clone dir exists (stat), like conventions — a missing clone
    // is a degraded skeleton, not a 500 (AC-12).
    const clonePath = repoRow.clonePath;
    const cloneDirOk = clonePath
      ? await stat(clonePath)
          .then((s) => s.isDirectory())
          .catch(() => false)
      : false;

    const isDegraded = facts.header.degraded || !cloneDirOk;

    let sections: OnboardingSections;
    if (isDegraded) {
      sections = buildSkeleton(facts, {
        degraded: true,
        degradedReason: facts.header.degradedReason,
      });
    } else {
      // `cloneDirOk` is only true when `clonePath` is a truthy string (see
      // the ternary above), so this is a safe non-null read — same pattern
      // `repo-intel/pipeline/full.ts` uses for the same invariant.
      const { provider, model } = await resolveFeatureModel(
        this.container,
        workspaceId,
        "onboarding",
      );
      const llm = await this.container.llm(provider);
      const result = await generateSections({
        facts,
        clonePath: clonePath!,
        llm,
        model,
      });

      if ("invalid" in result) {
        // Schema-invalid model output falls back to the skeleton (AC-5).
        sections = buildSkeleton(facts, {
          degraded: facts.header.degraded,
          degradedReason: facts.header.degradedReason,
        });
      } else {
        sections = result.sections;
      }
    }

    const row = await this.repo.upsert(workspaceId, repoId, {
      sections,
      repoName: repoRow.name,
      indexFileCount: facts.header.filesIndexed,
      indexUpdatedAt: facts.header.indexUpdatedAt,
      degraded: isDegraded,
      degradedReason: facts.header.degradedReason,
    });

    const dto = this.repo.toDto(row);
    // Same AC-2 header semantics as `getTour` above — the header always
    // reflects this tour's own `generatedAt`.
    dto.lastRefreshedAt = row.generatedAt.toISOString();
    return dto;
  }
}
