/**
 * service.test.ts — hermetic unit test (NOT *.it.test.ts, no real Postgres).
 *
 * Derived from the SPEC's orchestration acceptance criteria
 * (specs/2026-07-11-onboarding-generator.md AC-2, AC-4, AC-11, AC-12, AC-14,
 * AC-15, AC-16) — NOT from reading service.ts's own branching logic beyond
 * what's needed to know its call surface (`getTour`/`generate`).
 *
 * There is no shared `RepoIntel` mock and `OnboardingService` always
 * constructs its OWN `OnboardingRepository(container.db)` internally (it is
 * not separately injectable) — so this file drives the real repository
 * through a hand-written fake Drizzle `db` implementing just the
 * select/insert chains the service's code path touches (`t.repos`,
 * `t.settings`, `t.onboardingTours`), following the same
 * "only what this code path reads, cast `as unknown as X`" pattern already
 * used in `blast/service.test.ts` and
 * `reviews/project-context-injection.test.ts`.
 *
 * Uses `vi.useFakeTimers({ toFake: ['Date'] })` so `generatedAt` bumps are
 * deterministic (no real-clock race), per the hard rule against real-clock
 * assertions in hermetic tests. Only `Date` is faked — real fs/timer I/O
 * (mkdtemp, stat) is left alone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Container } from "../../platform/container.js";
import type { Db } from "../../db/client.js";
import type { OnboardingTourRow } from "../../db/rows.js";
import * as t from "../../db/schema.js";
import { MockLLMProvider } from "../../adapters/mocks.js";
import type { IndexState, RepoIntel } from "../repo-intel/types.js";
import { OnboardingService } from "./service.js";
import type { OnboardingSections } from "@devdigest/shared";

const WORKSPACE_ID = "ws-1";

function fullState(overrides: Partial<IndexState> = {}): IndexState {
  return {
    repoId: "repo-1",
    status: "full",
    filesIndexed: 25,
    filesSkipped: 0,
    durationMs: 100,
    lastIndexedSha: "sha1",
    indexerVersion: 1,
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    degraded: false,
    ...overrides,
  };
}

/** Hand-written RepoIntel stub — no shared mock exists (per INSIGHTS.md). */
function makeRepoIntel(state: IndexState): RepoIntel {
  return {
    indexRepo: vi.fn(),
    refreshIndex: vi.fn(),
    getIndexState: vi.fn().mockResolvedValue(state),
    getBlastRadius: vi.fn(),
    getRepoMap: vi.fn().mockResolvedValue({ text: "", tokens: 0, cached: false }),
    getFileRank: vi.fn(),
    getSymbolsInFiles: vi.fn(),
    getCallerSignatures: vi.fn(),
    getUnresolvedReferences: vi.fn(),
    getConventionSamples: vi.fn(),
    getTopFilesByRank: vi.fn(),
    getCriticalPaths: vi.fn(),
    getTopFilesByRankDetailed: vi.fn().mockResolvedValue([]),
    getFileImporterCounts: vi.fn().mockResolvedValue({}),
    getRouteInventory: vi.fn().mockResolvedValue([]),
    getStackFacts: vi.fn().mockResolvedValue({ languages: [], frameworks: [] }),
    getSetupCommands: vi.fn().mockResolvedValue({ commands: [] }),
  } as unknown as RepoIntel;
}

function makeRepoRow(overrides: Partial<typeof t.repos.$inferSelect> = {}): typeof t.repos.$inferSelect {
  return {
    id: "repo-1",
    workspaceId: WORKSPACE_ID,
    owner: "acme",
    name: "widgets",
    fullName: "acme/widgets",
    defaultBranch: "main",
    clonePath: null,
    lastPolledAt: null,
    createdBy: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as typeof t.repos.$inferSelect;
}

function validSectionsFixture(): OnboardingSections {
  return {
    architecture: { narrative: "narrative", codeRefs: [], diagram: null },
    criticalPaths: [],
    howToRun: [],
    readingPath: [],
    firstTasks: [{ title: "Explore the repo" }],
  };
}

/**
 * A fake Drizzle `db` supporting exactly the 3 chains
 * `OnboardingService`/`OnboardingRepository` touch: `select().from(t.repos)`,
 * `select({...}).from(t.settings)` (via `resolveFeatureModel`), and both
 * `select().from(t.onboardingTours)` + the upsert `insert(...)` chain,
 * backed by an in-memory single-row store (mirrors the real
 * `ON CONFLICT (workspace_id, repo_id) DO UPDATE`).
 */
function makeDb(repoRow: typeof t.repos.$inferSelect): {
  db: Db;
  getStoredRow: () => OnboardingTourRow | undefined;
} {
  let storedRow: OnboardingTourRow | undefined;
  let idCounter = 0;

  const db = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => {
        if (table === t.repos) {
          return { where: async () => [repoRow] };
        }
        if (table === t.settings) {
          return { where: async () => [] };
        }
        if (table === t.onboardingTours) {
          return { where: async () => (storedRow ? [storedRow] : []) };
        }
        throw new Error(`unexpected table in select().from(): ${String(table)}`);
      },
    }),
    insert: (table: unknown) => {
      if (table !== t.onboardingTours) {
        throw new Error(`unexpected table in insert(): ${String(table)}`);
      }
      return {
        values: (values: Record<string, unknown>) => ({
          onConflictDoUpdate: (_args: unknown) => ({
            returning: async () => {
              idCounter += 1;
              storedRow = {
                id: storedRow?.id ?? `tour-${idCounter}`,
                ...values,
              } as OnboardingTourRow;
              return [storedRow];
            },
          }),
        }),
      };
    },
  } as unknown as Db;

  return { db, getStoredRow: () => storedRow };
}

function makeContainer(repoIntel: RepoIntel, db: Db, llm: MockLLMProvider): Container {
  return {
    db,
    repoIntel,
    llm: vi.fn().mockResolvedValue(llm),
  } as unknown as Container;
}

let cloneRoot: string;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-01T00:00:00Z"));
  cloneRoot = await mkdtemp(join(tmpdir(), "dd-onboarding-service-"));
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(cloneRoot, { recursive: true, force: true });
});

describe("OnboardingService", () => {
  it("a healthy (non-degraded) generate makes exactly one completeStructured call (AC-4)", async () => {
    const repoRow = makeRepoRow({ clonePath: cloneRoot });
    const repoIntel = makeRepoIntel(fullState());
    const llm = new MockLLMProvider("openai", { structured: validSectionsFixture() });
    const { db } = makeDb(repoRow);
    const service = new OnboardingService(makeContainer(repoIntel, db, llm));

    const tour = await service.generate(WORKSPACE_ID, repoRow.id);

    expect(llm.calls.filter((c) => c.method === "completeStructured")).toHaveLength(1);
    expect(tour.degraded).toBe(false);
  });

  it("a degraded index yields the deterministic skeleton (badge fields set) and makes zero provider calls (AC-11)", async () => {
    const repoRow = makeRepoRow({ clonePath: cloneRoot });
    const repoIntel = makeRepoIntel(
      fullState({ degraded: true, degradedReason: "index_partial" }),
    );
    const llm = new MockLLMProvider("openai", { structured: validSectionsFixture() });
    const { db } = makeDb(repoRow);
    const service = new OnboardingService(makeContainer(repoIntel, db, llm));

    const tour = await service.generate(WORKSPACE_ID, repoRow.id);

    expect(tour.degraded).toBe(true);
    expect(tour.degradedReason).toBe("index_partial");
    expect(llm.calls).toHaveLength(0);
  });

  it("a no_data index (missing clone directory) yields the CTA skeleton and starts no clone/index job (AC-12)", async () => {
    const repoRow = makeRepoRow({ clonePath: "/nonexistent/dd-onboarding-no-clone-xyz" });
    const repoIntel = makeRepoIntel(fullState({ degraded: true, degradedReason: "no_data" }));
    const llm = new MockLLMProvider("openai", { structured: validSectionsFixture() });
    const { db } = makeDb(repoRow);
    const service = new OnboardingService(makeContainer(repoIntel, db, llm));

    const tour = await service.generate(WORKSPACE_ID, repoRow.id);

    expect(tour.degraded).toBe(true);
    expect(tour.degradedReason).toBe("no_data");
    expect(llm.calls).toHaveLength(0);
    // AC-12: this feature never triggers cloning or (re)indexing itself.
    expect(repoIntel.indexRepo).not.toHaveBeenCalled();
    expect(repoIntel.refreshIndex).not.toHaveBeenCalled();
  });

  it("a second getTour call re-serves the stored tour with zero LLM calls (AC-14)", async () => {
    const repoRow = makeRepoRow({ clonePath: cloneRoot });
    const repoIntel = makeRepoIntel(fullState());
    const llm = new MockLLMProvider("openai", { structured: validSectionsFixture() });
    const { db } = makeDb(repoRow);
    const service = new OnboardingService(makeContainer(repoIntel, db, llm));

    // No stored tour yet -> getTour generates once.
    const first = await service.getTour(WORKSPACE_ID, repoRow.id);
    expect(llm.calls.filter((c) => c.method === "completeStructured")).toHaveLength(1);

    // A stored tour now exists -> getTour re-serves without regenerating.
    const second = await service.getTour(WORKSPACE_ID, repoRow.id);
    expect(llm.calls.filter((c) => c.method === "completeStructured")).toHaveLength(1);
    expect(second.generatedAt).toBe(first.generatedAt);
  });

  it("Regenerate replaces the stored tour and bumps generatedAt without triggering a clone/index job (AC-15)", async () => {
    const repoRow = makeRepoRow({ clonePath: cloneRoot });
    const repoIntel = makeRepoIntel(fullState());
    const llm = new MockLLMProvider("openai", { structured: validSectionsFixture() });
    const { db } = makeDb(repoRow);
    const service = new OnboardingService(makeContainer(repoIntel, db, llm));

    const first = await service.generate(WORKSPACE_ID, repoRow.id);

    vi.setSystemTime(new Date("2026-07-01T00:05:00Z"));
    const second = await service.generate(WORKSPACE_ID, repoRow.id); // Regenerate

    expect(new Date(second.generatedAt).getTime()).toBeGreaterThan(
      new Date(first.generatedAt).getTime(),
    );
    expect(repoIntel.indexRepo).not.toHaveBeenCalled();
    expect(repoIntel.refreshIndex).not.toHaveBeenCalled();
  });

  it("a stored tour older than the latest index update reports stale: true on read (AC-16)", async () => {
    const repoRow = makeRepoRow({ clonePath: cloneRoot });
    const repoIntel = makeRepoIntel(fullState({ updatedAt: new Date("2026-07-01T00:00:00Z") }));
    const llm = new MockLLMProvider("openai", { structured: validSectionsFixture() });
    const { db } = makeDb(repoRow);
    const service = new OnboardingService(makeContainer(repoIntel, db, llm));

    await service.generate(WORKSPACE_ID, repoRow.id); // persists indexUpdatedAt = 2026-07-01

    // The facade later reports a NEWER index refresh than the stored tour.
    repoIntel.getIndexState = vi
      .fn()
      .mockResolvedValue(fullState({ updatedAt: new Date("2026-07-02T00:00:00Z") }));

    const tour = await service.getTour(WORKSPACE_ID, repoRow.id);
    expect(tour.stale).toBe(true);
  });

  it("a stored tour NOT older than the index reports stale: false on read (AC-16 negative case)", async () => {
    const repoRow = makeRepoRow({ clonePath: cloneRoot });
    const repoIntel = makeRepoIntel(fullState({ updatedAt: new Date("2026-07-01T00:00:00Z") }));
    const llm = new MockLLMProvider("openai", { structured: validSectionsFixture() });
    const { db } = makeDb(repoRow);
    const service = new OnboardingService(makeContainer(repoIntel, db, llm));

    await service.generate(WORKSPACE_ID, repoRow.id);

    const tour = await service.getTour(WORKSPACE_ID, repoRow.id);
    expect(tour.stale).toBe(false);
  });

  it("lastRefreshedAt mirrors the tour's own generatedAt, per the spec's header ASSUMPTION (AC-2)", async () => {
    const repoRow = makeRepoRow({ clonePath: cloneRoot });
    const repoIntel = makeRepoIntel(fullState());
    const llm = new MockLLMProvider("openai", { structured: validSectionsFixture() });
    const { db } = makeDb(repoRow);
    const service = new OnboardingService(makeContainer(repoIntel, db, llm));

    const tour = await service.generate(WORKSPACE_ID, repoRow.id);

    expect(tour.lastRefreshedAt).toBe(tour.generatedAt);
  });
});
