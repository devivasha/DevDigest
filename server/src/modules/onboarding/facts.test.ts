/**
 * facts.test.ts — hermetic unit test (NOT *.it.test.ts, no real Postgres).
 *
 * Derived from the SPEC's acceptance criteria
 * (specs/2026-07-11-onboarding-generator.md) and the plan's pinned AC-7
 * formula (docs/plans/onboarding-generator.md, T4), NOT from reading
 * facts.ts's own implementation logic. Expected values below are computed by
 * hand from the pinned formula on fixtures this file owns.
 *
 * AC-1: fact collection uses ONLY `container.repoIntel` — zero db/llm/fetch
 *   calls. Proven by handing `collectFacts` a container whose `db` is a
 *   throwing Proxy and whose `llm` throws when invoked; a passing test means
 *   neither was ever touched.
 * AC-2: header facts (filesIndexed, indexUpdatedAt, degraded/reason) are
 *   deterministic, sourced from `getIndexState()`.
 * AC-9: the Guided reading path is ordered by file rank DESC.
 * AC-7: "critical" is decided by rank + importer/caller count via the pinned
 *   formula `score(f) = rank(f) * (1 + imp(f)/maxImp)`, tie-break rank DESC
 *   then path ASC.
 * AC-19: work is bounded to the top-200 ranked files; every section respects
 *   its cap.
 *
 * There is no shared `RepoIntel` mock (per server/insights/INSIGHTS.md,
 * 2026-07-11) — this file hand-writes one implementing every facade method,
 * per module CLAUDE.md / test-writer convention.
 */
import { describe, it, expect, vi } from "vitest";
import type { Container } from "../../platform/container.js";
import type {
  FileRankDetail,
  IndexState,
  RepoIntel,
  SetupCommandsResult,
  StackFacts,
} from "../repo-intel/types.js";
import { collectFacts } from "./facts.js";
import { CRITICAL_MAX, COMMANDS_MAX, READING_MAX, TOP_N } from "./constants.js";

const REPO_ID = "repo-1";

function makeIndexState(overrides: Partial<IndexState> = {}): IndexState {
  return {
    repoId: REPO_ID,
    status: "full",
    filesIndexed: 42,
    filesSkipped: 0,
    durationMs: 100,
    lastIndexedSha: "sha1",
    indexerVersion: 1,
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    degraded: false,
    ...overrides,
  };
}

/**
 * Hand-written `RepoIntel` stub. Only the 7 methods `collectFacts` is
 * documented to call get real fixture behavior; every other facade method is
 * a bare `vi.fn()` that returns `undefined` — if `collectFacts` ever called
 * one of those, the resulting `undefined` would blow up the `await
 * Promise.all([...])`/property access downstream, so a passing test is
 * itself evidence the call surface is exactly what AC-1 documents.
 */
function makeRepoIntel(fixtures: {
  indexState: IndexState;
  rankedFiles: FileRankDetail[];
  importerCounts: Record<string, number>;
  routeInventory?: string[];
  stack?: StackFacts;
  setupCommands?: SetupCommandsResult;
  repoMapText?: string;
}): RepoIntel {
  return {
    indexRepo: vi.fn(),
    refreshIndex: vi.fn(),
    getIndexState: vi.fn().mockResolvedValue(fixtures.indexState),
    getBlastRadius: vi.fn(),
    getRepoMap: vi
      .fn()
      .mockResolvedValue({ text: fixtures.repoMapText ?? "", tokens: 0, cached: false }),
    getFileRank: vi.fn(),
    getSymbolsInFiles: vi.fn(),
    getCallerSignatures: vi.fn(),
    getUnresolvedReferences: vi.fn(),
    getConventionSamples: vi.fn(),
    getTopFilesByRank: vi.fn(),
    getCriticalPaths: vi.fn(),
    getTopFilesByRankDetailed: vi.fn().mockResolvedValue(fixtures.rankedFiles),
    getFileImporterCounts: vi.fn().mockResolvedValue(fixtures.importerCounts),
    getRouteInventory: vi.fn().mockResolvedValue(fixtures.routeInventory ?? []),
    getStackFacts: vi
      .fn()
      .mockResolvedValue(fixtures.stack ?? { languages: [], frameworks: [] }),
    getSetupCommands: vi
      .fn()
      .mockResolvedValue(fixtures.setupCommands ?? { commands: [] }),
  } as unknown as RepoIntel;
}

/**
 * A container whose `db` throws on ANY property access and whose `llm`
 * throws when called — so a passing `collectFacts` call is direct proof
 * neither was ever touched (AC-1's "zero LLM, embedding, or network call
 * during fact collection").
 */
function makeThrowingContainer(repoIntel: RepoIntel): Container {
  const throwingDb = new Proxy(
    {},
    {
      get() {
        throw new Error("collectFacts must not touch container.db (AC-1)");
      },
    },
  );
  const throwingLlm = () => {
    throw new Error("collectFacts must not touch container.llm (AC-1)");
  };
  return { repoIntel, db: throwingDb, llm: throwingLlm } as unknown as Container;
}

describe("collectFacts", () => {
  it("collects exclusively via container.repoIntel — zero db/llm/fetch calls (AC-1); header carries filesIndexed (AC-2)", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const indexState = makeIndexState({ filesIndexed: 137, degraded: false });
    const repoIntel = makeRepoIntel({
      indexState,
      rankedFiles: [
        { path: "src/a.ts", rank: 5, pagerank: 5, hotness: 0, percentile: 90 },
      ],
      importerCounts: {},
    });
    const container = makeThrowingContainer(repoIntel);

    const facts = await collectFacts(container, REPO_ID);

    // AC-2: header facts are deterministic, sourced only from getIndexState().
    expect(facts.header.filesIndexed).toBe(137);
    expect(facts.header.degraded).toBe(false);
    expect(facts.header.indexUpdatedAt).toEqual(indexState.updatedAt);

    // AC-1: no outbound network call was made either (db/llm proved above by
    // the fact this call didn't throw).
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("passes through the degraded/reason facts verbatim from getIndexState() (AC-2)", async () => {
    const indexState = makeIndexState({
      filesIndexed: 0,
      degraded: true,
      degradedReason: "repo_too_large",
    });
    const repoIntel = makeRepoIntel({ indexState, rankedFiles: [], importerCounts: {} });
    const container = makeThrowingContainer(repoIntel);

    const facts = await collectFacts(container, REPO_ID);

    expect(facts.header.degraded).toBe(true);
    expect(facts.header.degradedReason).toBe("repo_too_large");
  });

  it("reading path preserves the facade's rank-DESC order verbatim, capped to READING_MAX (AC-9)", async () => {
    // Deliberately NOT alphabetical — proves collectFacts trusts the
    // facade's rank ordering rather than re-sorting by path (AC-9 requires
    // rank DESC, not alphabetical/date).
    const rankedFiles: FileRankDetail[] = [
      { path: "src/zebra.ts", rank: 9.5, pagerank: 9.5, hotness: 0, percentile: 99 },
      { path: "src/mango.ts", rank: 7.2, pagerank: 7.2, hotness: 0, percentile: 90 },
      { path: "src/apple.ts", rank: 4.1, pagerank: 4.1, hotness: 0, percentile: 70 },
      { path: "src/kiwi.ts", rank: 2.0, pagerank: 2.0, hotness: 0, percentile: 40 },
      { path: "src/fig.ts", rank: 1.5, pagerank: 1.5, hotness: 0, percentile: 30 },
      { path: "src/pear.ts", rank: 1.0, pagerank: 1.0, hotness: 0, percentile: 20 },
      { path: "src/date.ts", rank: 0.5, pagerank: 0.5, hotness: 0, percentile: 10 },
      // 8th item — must NOT survive the READING_MAX(7) cap.
      { path: "src/beyond-cap.ts", rank: 0.1, pagerank: 0.1, hotness: 0, percentile: 5 },
    ];
    const repoIntel = makeRepoIntel({
      indexState: makeIndexState(),
      rankedFiles,
      importerCounts: {},
    });
    const container = makeThrowingContainer(repoIntel);

    const facts = await collectFacts(container, REPO_ID);

    expect(facts.readingPath).toHaveLength(READING_MAX);
    expect(facts.readingPath.map((f) => f.path)).toEqual([
      "src/zebra.ts",
      "src/mango.ts",
      "src/apple.ts",
      "src/kiwi.ts",
      "src/fig.ts",
      "src/pear.ts",
      "src/date.ts",
    ]);
    // No accidental re-sort — every entry's rank is >= the next entry's rank.
    for (let i = 1; i < facts.readingPath.length; i++) {
      expect(facts.readingPath[i - 1]!.rank).toBeGreaterThanOrEqual(facts.readingPath[i]!.rank);
    }
  });

  it("critical order matches the pinned AC-7 formula (score = rank * (1 + normImp), tie-break rank DESC then path ASC); callerCount is populated", async () => {
    // Hand-computed expected order per docs/plans/onboarding-generator.md T4's
    // pinned formula — NOT derived from reading facts.ts:
    //   maxImp = 8 (src/d.ts and src/g.ts both have importer count 8)
    //   score(src/a.ts) = 10 * (1 + 0/8) = 10.0
    //   score(src/b.ts) = 8  * (1 + 4/8) = 12.0
    //   score(src/c.ts) = 8  * (1 + 2/8) = 10.0
    //   score(src/d.ts) = 5  * (1 + 8/8) = 10.0
    //   score(src/g.ts) = 5  * (1 + 8/8) = 10.0
    //   score(src/e.ts) = 3  * (1 + 0/8) = 3.0
    //   score(src/f.ts) = 1  * (1 + 0/8) = 1.0
    // DESC by score: b (12) > {a, c, d, g} (10, tied) > e (3) > f (1)
    // Tie-break rank DESC among the 10.0 ties: a(rank10) > c(rank8) > {d, g}(rank5, tied)
    // Final tie-break path ASC among d/g: "src/d.ts" < "src/g.ts"
    // => expected order: b, a, c, d, g, e, f (all 7 fit within CRITICAL_MAX)
    const rankedFiles: FileRankDetail[] = [
      { path: "src/a.ts", rank: 10, pagerank: 10, hotness: 0, percentile: 99 },
      { path: "src/b.ts", rank: 8, pagerank: 8, hotness: 0, percentile: 95 },
      { path: "src/c.ts", rank: 8, pagerank: 8, hotness: 0, percentile: 95 },
      { path: "src/d.ts", rank: 5, pagerank: 5, hotness: 0, percentile: 80 },
      { path: "src/g.ts", rank: 5, pagerank: 5, hotness: 0, percentile: 80 },
      { path: "src/e.ts", rank: 3, pagerank: 3, hotness: 0, percentile: 50 },
      { path: "src/f.ts", rank: 1, pagerank: 1, hotness: 0, percentile: 10 },
    ];
    const importerCounts: Record<string, number> = {
      "src/b.ts": 4,
      "src/c.ts": 2,
      "src/d.ts": 8,
      "src/g.ts": 8,
    };
    const repoIntel = makeRepoIntel({
      indexState: makeIndexState(),
      rankedFiles,
      importerCounts,
    });
    const container = makeThrowingContainer(repoIntel);

    const facts = await collectFacts(container, REPO_ID);

    expect(facts.criticalCandidates.map((c) => c.path)).toEqual([
      "src/b.ts",
      "src/a.ts",
      "src/c.ts",
      "src/d.ts",
      "src/g.ts",
      "src/e.ts",
      "src/f.ts",
    ]);
    // callerCount = the file's importer count (AC-7); files with no importer
    // entry default to 0.
    expect(facts.criticalCandidates.find((c) => c.path === "src/b.ts")!.callerCount).toBe(4);
    expect(facts.criticalCandidates.find((c) => c.path === "src/d.ts")!.callerCount).toBe(8);
    expect(facts.criticalCandidates.find((c) => c.path === "src/a.ts")!.callerCount).toBe(0);
  });

  it("requests the TOP_N(200) budget from the facade and caps every per-section list to its AC-19 limit", async () => {
    const rankedFiles: FileRankDetail[] = Array.from({ length: 9 }, (_, i) => ({
      path: `src/file${i}.ts`,
      rank: 9 - i, // strictly descending — already the facade's documented contract
      pagerank: 9 - i,
      hotness: 0,
      percentile: 90 - i * 5,
    }));
    const setupCommands: SetupCommandsResult = {
      commands: Array.from({ length: 15 }, (_, i) => ({ command: `cmd-${i}` })),
    };
    const repoIntel = makeRepoIntel({
      indexState: makeIndexState(),
      rankedFiles,
      importerCounts: {},
      setupCommands,
    });
    const container = makeThrowingContainer(repoIntel);

    const facts = await collectFacts(container, REPO_ID);

    // collectFacts requests exactly the TOP_N=200 budget — the facade owns
    // truncation to the top-200 candidate set (AC-19); this call arg is the
    // observable proof the budget was actually requested.
    expect(vi.mocked(repoIntel.getTopFilesByRankDetailed)).toHaveBeenCalledWith(
      REPO_ID,
      TOP_N,
    );

    expect(facts.readingPath).toHaveLength(READING_MAX);
    expect(facts.criticalCandidates).toHaveLength(CRITICAL_MAX);
    expect(facts.commands).toHaveLength(COMMANDS_MAX);
    // The lowest-ranked (9th) file never survives either per-section cap.
    expect(facts.readingPath.some((f) => f.path === "src/file8.ts")).toBe(false);
    expect(facts.criticalCandidates.some((c) => c.path === "src/file8.ts")).toBe(false);
  });
});
