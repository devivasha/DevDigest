/**
 * repository.it.test.ts — integration test (real Postgres via testcontainers).
 *
 * Derived from the SPEC's persistence acceptance criteria
 * (specs/2026-07-11-onboarding-generator.md AC-14, AC-15, AC-16):
 *   AC-14: a generated tour is persisted per (workspace, repo) and re-served.
 *   AC-15: Regenerate replaces the stored tour and bumps `generatedAt`.
 *   AC-16: `indexUpdatedAt` is stored so staleness can be computed on read.
 *
 * Follows the existing `conventions.it.test.ts` convention for this
 * codebase: one shared testcontainer per `describe` block (`beforeAll`
 * /`afterAll`), Docker-gated via `dockerAvailable()`. There is no
 * transaction-per-test helper in this codebase (confirmed: no `.it.test.ts`
 * file uses `db.transaction()` rollback-per-test) — each test here uses its
 * own freshly-seeded repo row so state never leaks across tests.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { OnboardingSections } from "@devdigest/shared";
import { OnboardingRepository } from "./repository.js";
import { seed } from "../../db/seed.js";
import * as t from "../../db/schema.js";
import { startPg, dockerAvailable, type PgFixture } from "../../../test/helpers/pg.js";

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn("[onboarding.repository.it] Docker not available — skipping.");
}

async function seedRepo(
  db: PgFixture["handle"]["db"],
  workspaceId: string,
  fullName: string,
): Promise<string> {
  const [row] = await db
    .insert(t.repos)
    .values({
      workspaceId,
      owner: "test-org",
      name: fullName.split("/")[1]!,
      fullName,
    })
    .returning({ id: t.repos.id });
  return row!.id;
}

function sectionsFixture(overrides: Partial<OnboardingSections> = {}): OnboardingSections {
  return {
    architecture: { narrative: "narrative", codeRefs: [], diagram: null },
    criticalPaths: [],
    howToRun: [],
    readingPath: [],
    firstTasks: [{ title: "Explore" }],
    ...overrides,
  };
}

d("OnboardingRepository (Testcontainers)", () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it("upsert then get round-trips the persisted tour (AC-14)", async () => {
    const repoId = await seedRepo(pg.handle.db, workspaceId, "test-org/tour-round-trip");
    const repo = new OnboardingRepository(pg.handle.db);
    const indexUpdatedAt = new Date("2026-07-01T00:00:00Z");

    const row = await repo.upsert(workspaceId, repoId, {
      sections: sectionsFixture({ firstTasks: [{ title: "Explore the repo" }] }),
      repoName: "widgets",
      indexFileCount: 12,
      indexUpdatedAt,
      degraded: false,
    });
    expect(row.repoName).toBe("widgets");
    expect(row.indexFileCount).toBe(12);
    expect(row.degraded).toBe(false);

    const fetched = await repo.get(workspaceId, repoId);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(row.id);
    expect(fetched!.repoName).toBe("widgets");
    // AC-16: indexUpdatedAt round-trips exactly for the stale compare.
    expect(fetched!.indexUpdatedAt?.toISOString()).toBe(indexUpdatedAt.toISOString());

    const dto = repo.toDto(fetched!);
    expect(dto.sections.firstTasks).toEqual([{ title: "Explore the repo" }]);
    expect(dto.repoId).toBe(repoId);
  });

  it("get returns undefined for a (workspace, repo) pair with no stored tour", async () => {
    const repoId = await seedRepo(pg.handle.db, workspaceId, "test-org/tour-none");
    const repo = new OnboardingRepository(pg.handle.db);

    const fetched = await repo.get(workspaceId, repoId);
    expect(fetched).toBeUndefined();
  });

  it("a second upsert replaces the row (last-write-wins) and bumps generatedAt (AC-15)", async () => {
    const repoId = await seedRepo(pg.handle.db, workspaceId, "test-org/tour-regenerate");
    const repo = new OnboardingRepository(pg.handle.db);

    const first = await repo.upsert(workspaceId, repoId, {
      sections: sectionsFixture(),
      repoName: "widgets-v1",
      indexFileCount: 1,
      indexUpdatedAt: new Date("2026-07-01T00:00:00Z"),
      degraded: false,
    });

    // Ensure a distinct now() tick between the two upserts.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const second = await repo.upsert(workspaceId, repoId, {
      sections: sectionsFixture({ firstTasks: [{ title: "Regenerated" }] }),
      repoName: "widgets-v2",
      indexFileCount: 2,
      indexUpdatedAt: new Date("2026-07-02T00:00:00Z"),
      degraded: false,
    });

    // ON CONFLICT (workspace_id, repo_id) DO UPDATE — same row id, replaced content.
    expect(second.id).toBe(first.id);
    expect(second.repoName).toBe("widgets-v2");
    expect(second.indexFileCount).toBe(2);
    expect(second.generatedAt.getTime()).toBeGreaterThan(first.generatedAt.getTime());
    expect(second.indexUpdatedAt?.toISOString()).toBe(
      new Date("2026-07-02T00:00:00Z").toISOString(),
    );

    const stored = await repo.get(workspaceId, repoId);
    expect(stored!.id).toBe(first.id);
    expect(stored!.repoName).toBe("widgets-v2");
    expect(repo.toDto(stored!).sections.firstTasks).toEqual([{ title: "Regenerated" }]);
  });

  it("upsert persists degraded + degradedReason for the stored badge (AC-11 storage side)", async () => {
    const repoId = await seedRepo(pg.handle.db, workspaceId, "test-org/tour-degraded");
    const repo = new OnboardingRepository(pg.handle.db);

    const row = await repo.upsert(workspaceId, repoId, {
      sections: sectionsFixture(),
      repoName: "widgets",
      indexFileCount: 0,
      indexUpdatedAt: null,
      degraded: true,
      degradedReason: "no_data",
    });

    expect(row.degraded).toBe(true);
    expect(row.degradedReason).toBe("no_data");
    expect(row.indexUpdatedAt).toBeNull();

    const dto = repo.toDto(row);
    expect(dto.degraded).toBe(true);
    expect(dto.degradedReason).toBe("no_data");
  });
});
