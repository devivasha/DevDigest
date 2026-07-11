/**
 * onboarding-facade.it.test.ts — integration test (real Postgres via
 * testcontainers).
 *
 * Derived from the SPEC's fact-collection acceptance criteria
 * (specs/2026-07-11-onboarding-generator.md AC-3, AC-7, AC-9) over a
 * directly-seeded `file_rank`/`file_edges`/`file_facts` index — NOT from
 * reading the facade's query implementation beyond its documented call
 * surface (`getTopFilesByRankDetailed` / `getFileImporterCounts` /
 * `getRouteInventory`).
 *
 *   AC-7/AC-9: `getTopFilesByRankDetailed` must return files ordered by
 *     `file_rank.rank` DESC (the pinned reading-path / critical-score input).
 *   AC-7: `getFileImporterCounts` must equal `file_edges` fan-in (COUNT(*)
 *     grouped by the importing file's target).
 *   AC-3: `getRouteInventory` must equal the union (deduped) of every
 *     indexed file's `file_facts.endpoints`, repo-wide.
 *
 * Follows the `conventions.it.test.ts` convention: one shared testcontainer
 * per `describe` block, Docker-gated via `dockerAvailable()`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Container } from "../../platform/container.js";
import { RepoIntelService } from "./service.js";
import { seed } from "../../db/seed.js";
import * as t from "../../db/schema.js";
import { startPg, dockerAvailable, type PgFixture } from "../../../test/helpers/pg.js";

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn("[onboarding-facade.it] Docker not available — skipping.");
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

d("RepoIntel onboarding facade extensions (Testcontainers)", () => {
  let pg: PgFixture;
  let workspaceId: string;
  let service: RepoIntelService;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
    const container = {
      db: pg.handle.db,
      config: { repoIntelEnabled: true },
    } as unknown as Container;
    service = new RepoIntelService(container);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it("getFileImporterCounts equals the file_edges fan-in (COUNT(*) grouped by importing target) (AC-7)", async () => {
    const repoId = await seedRepo(pg.handle.db, workspaceId, "test-org/facade-importers");

    // target.ts is imported by 3 distinct files; other.ts by 1; lonely.ts by none.
    await pg.handle.db.insert(t.fileEdges).values([
      { repoId, fromFile: "src/a.ts", toFile: "src/target.ts" },
      { repoId, fromFile: "src/b.ts", toFile: "src/target.ts" },
      { repoId, fromFile: "src/c.ts", toFile: "src/target.ts" },
      { repoId, fromFile: "src/d.ts", toFile: "src/other.ts" },
    ]);

    const counts = await service.getFileImporterCounts(repoId, [
      "src/target.ts",
      "src/other.ts",
      "src/lonely.ts",
    ]);

    expect(counts["src/target.ts"]).toBe(3);
    expect(counts["src/other.ts"]).toBe(1);
    // A file with zero importers is simply absent from the map (callers
    // treat a missing key as 0), never a bogus 0 entry.
    expect(counts["src/lonely.ts"]).toBeUndefined();
  });

  it("getRouteInventory equals the deduped union of every indexed file's file_facts.endpoints, repo-wide (AC-3)", async () => {
    const repoId = await seedRepo(pg.handle.db, workspaceId, "test-org/facade-routes");

    await pg.handle.db.insert(t.fileFacts).values([
      { repoId, filePath: "src/routes-a.ts", endpoints: ["GET /a", "POST /b"], crons: [] },
      { repoId, filePath: "src/routes-b.ts", endpoints: ["POST /b", "GET /c"], crons: [] },
      { repoId, filePath: "src/routes-c.ts", endpoints: [], crons: [] },
    ]);

    const routes = await service.getRouteInventory(repoId);

    // Deduped union of every row's endpoints, sorted deterministically.
    expect(routes).toEqual(["GET /a", "GET /c", "POST /b"]);
  });

  it("getTopFilesByRankDetailed returns files ordered by file_rank.rank DESC (AC-7/AC-9)", async () => {
    const repoId = await seedRepo(pg.handle.db, workspaceId, "test-org/facade-rank");

    // Insert deliberately NOT in rank order and NOT alphabetically
    // correlated with rank — proves the facade sorts by rank, not insertion
    // order or path.
    await pg.handle.db.insert(t.fileRank).values([
      { repoId, filePath: "src/mid.ts", pagerank: 4.0, hotness: 0, rank: 4.0, percentile: 50 },
      { repoId, filePath: "src/top.ts", pagerank: 9.0, hotness: 0, rank: 9.0, percentile: 99 },
      { repoId, filePath: "src/low.ts", pagerank: 1.0, hotness: 0, rank: 1.0, percentile: 10 },
      { repoId, filePath: "src/high.ts", pagerank: 7.0, hotness: 0, rank: 7.0, percentile: 90 },
    ]);

    const ranked = await service.getTopFilesByRankDetailed(repoId, 10);

    expect(ranked.map((f) => f.path)).toEqual([
      "src/top.ts",
      "src/high.ts",
      "src/mid.ts",
      "src/low.ts",
    ]);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]!.rank).toBeGreaterThanOrEqual(ranked[i]!.rank);
    }
  });
});
