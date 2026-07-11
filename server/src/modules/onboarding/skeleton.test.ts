/**
 * skeleton.test.ts — hermetic unit test (NOT *.it.test.ts, no real Postgres).
 *
 * Derived from the SPEC's degraded/skeleton acceptance criteria
 * (specs/2026-07-11-onboarding-generator.md AC-5, AC-11, AC-12) — NOT from
 * reading skeleton.ts's own template logic beyond what's needed to know its
 * call surface (`buildSkeleton(facts, opts): OnboardingSections`).
 *
 * AC-11: a degraded index renders a deterministic skeleton built from
 *   whatever facts the facade returned, with no LLM call and no fabricated
 *   narrative.
 * AC-12: `no_data` / no-clone renders the skeleton with an explicit
 *   call-to-action pointing at the index flow.
 * AC-5: the skeleton is the schema-valid fallback shape used both for the
 *   degraded path and for a schema-invalid model response.
 * Edge case (spec "Edge cases"): an empty repo (index present, zero ranked
 *   files) renders empty-state placeholders, never fabricated files.
 */
import { describe, it, expect } from "vitest";
import { OnboardingSectionsSchema, type DegradedReason } from "@devdigest/shared";
import { buildSkeleton } from "./skeleton.js";
import type { OnboardingFacts } from "./facts.js";

function makeFacts(overrides: Partial<OnboardingFacts> = {}): OnboardingFacts {
  return {
    header: {
      filesIndexed: 10,
      indexUpdatedAt: new Date("2026-07-01T00:00:00Z"),
      degraded: false,
      ...overrides.header,
    },
    readingPath: overrides.readingPath ?? [],
    criticalCandidates: overrides.criticalCandidates ?? [],
    routeInventory: overrides.routeInventory ?? [],
    stack: overrides.stack ?? { languages: [], frameworks: [] },
    commands: overrides.commands ?? [],
    repoMapText: overrides.repoMapText ?? "",
  };
}

describe("buildSkeleton", () => {
  it("degraded facts (with partial data available) produce a full 5-section, schema-valid skeleton whose narrative reflects the degraded reason; the builder is synchronous, so it structurally cannot make a provider call (AC-11)", () => {
    const facts = makeFacts({
      header: {
        filesIndexed: 12,
        indexUpdatedAt: new Date("2026-07-01T00:00:00Z"),
        degraded: true,
        degradedReason: "index_partial",
      },
      readingPath: [{ path: "src/a.ts", rank: 5, pagerank: 5, hotness: 0, percentile: 90 }],
      criticalCandidates: [{ path: "src/a.ts", rank: 5, callerCount: 2 }],
      commands: [{ command: "npm install" }],
    });

    const result = buildSkeleton(facts, { degraded: true, degradedReason: "index_partial" });

    // `buildSkeleton`'s return type is `OnboardingSections`, not a Promise —
    // it structurally cannot `await` an LLM call (AC-11's "shall not issue
    // the LLM narrative call").
    expect(result).not.toHaveProperty("then");

    // Full 5-section skeleton.
    expect(Object.keys(result).sort()).toEqual(
      ["architecture", "criticalPaths", "howToRun", "readingPath", "firstTasks"].sort(),
    );
    expect(() => OnboardingSectionsSchema.parse(result)).not.toThrow();

    // No fabricated paths — every code ref / critical / reading entry is
    // copied verbatim from the given facts, never invented (AC-11 "shall not
    // fabricate narrative text").
    expect(result.architecture.codeRefs.map((r) => r.path)).toEqual(["src/a.ts"]);
    expect(result.criticalPaths.map((c) => c.path)).toEqual(["src/a.ts"]);
    expect(result.readingPath.map((r) => r.path)).toEqual(["src/a.ts"]);

    // The degraded reason materially changes the narrative — a differential
    // check (not pinned to exact copy) that the reason is actually
    // incorporated rather than silently ignored.
    const nonDegraded = buildSkeleton(facts, { degraded: false });
    expect(nonDegraded.architecture.narrative).not.toBe(result.architecture.narrative);
  });

  it("no_data / no-clone facts render a full skeleton with an indexing call-to-action and no invented content (AC-12)", () => {
    const facts = makeFacts({
      header: {
        filesIndexed: 0,
        indexUpdatedAt: new Date("2026-07-01T00:00:00Z"),
        degraded: true,
        degradedReason: "no_data" as DegradedReason,
      },
    });

    const result = buildSkeleton(facts, { degraded: true, degradedReason: "no_data" });

    expect(() => OnboardingSectionsSchema.parse(result)).not.toThrow();

    // No facts were available — every path-bearing list stays empty; nothing
    // is fabricated (AC-11's "no invented content" carries into AC-12).
    expect(result.architecture.codeRefs).toEqual([]);
    expect(result.criticalPaths).toEqual([]);
    expect(result.readingPath).toEqual([]);
    expect(result.architecture.diagram).toBeNull();

    // AC-12's "explicit call-to-action pointing to the ... index flow" —
    // firstTasks carries an entry that guides the user to index the repo.
    expect(
      result.firstTasks.some(
        (task) => /index/i.test(task.title) || /index/i.test(task.detail ?? ""),
      ),
    ).toBe(true);
  });

  it("empty facts (a healthy but empty repo — index present, zero ranked files) yield placeholder sections instead of throwing", () => {
    const facts = makeFacts({
      header: { filesIndexed: 0, indexUpdatedAt: new Date("2026-07-01T00:00:00Z"), degraded: false },
    });

    expect(() => buildSkeleton(facts, { degraded: false })).not.toThrow();
    const result = buildSkeleton(facts, { degraded: false });

    expect(() => OnboardingSectionsSchema.parse(result)).not.toThrow();
    // Placeholder, not an empty/broken firstTasks list.
    expect(result.firstTasks.length).toBeGreaterThan(0);
    expect(result.criticalPaths).toEqual([]);
    expect(result.readingPath).toEqual([]);
    expect(result.howToRun).toEqual([]);
  });

  it("produces a schema-valid OnboardingSections for typical (non-degraded) facts — the AC-5 fallback shape", () => {
    const facts = makeFacts({
      readingPath: [
        { path: "src/a.ts", rank: 9, pagerank: 9, hotness: 0, percentile: 99 },
        { path: "src/b.ts", rank: 5, pagerank: 5, hotness: 0, percentile: 80 },
      ],
      criticalCandidates: [{ path: "src/a.ts", rank: 9, callerCount: 3 }],
      commands: [{ command: "npm install" }, { command: "npm run dev" }],
      stack: { languages: ["TypeScript"], frameworks: ["Fastify"] },
    });

    const result = buildSkeleton(facts, { degraded: false });
    const parsed = OnboardingSectionsSchema.safeParse(result);

    expect(parsed.success).toBe(true);
    expect(result.readingPath.map((r) => r.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(result.howToRun.map((c) => c.command)).toEqual(["npm install", "npm run dev"]);
    expect(result.criticalPaths.map((c) => c.path)).toEqual(["src/a.ts"]);
  });
});
