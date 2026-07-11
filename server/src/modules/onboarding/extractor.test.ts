/**
 * extractor.test.ts — hermetic unit test (NOT *.it.test.ts, no real Postgres).
 *
 * Derived from the SPEC's single-LLM-call and grounding acceptance criteria
 * (specs/2026-07-11-onboarding-generator.md AC-4, AC-5, AC-6, AC-13, AC-19)
 * plus the plan's T6 mechanism notes for what the extractor is contractually
 * supposed to do — NOT from copying extractor.ts's internal regex/branching
 * into the assertions.
 *
 * AC-4: exactly ONE structured LLM call per generation.
 * AC-13: every emitted file path is grounded against the real clone; an
 *   unverifiable path is dropped/de-linked.
 * AC-19: capped arrays (criticalPaths <=7, readingPath <=7, howToRun <=10,
 *   firstTasks <=5) and the architecture diagram (<=8 nodes).
 * AC-5: a schema-invalid model response falls back to `{ invalid: true }`
 *   (never persisted/rendered as-is).
 * AC-6: the diagram is a mermaid `flowchart` string with clickable code refs;
 *   unsafe/oversized diagrams must not survive as rendered output.
 *
 * `MockLLMProvider` (adapters/mocks.ts) validates its fixture against the
 * EXACT schema passed to `completeStructured` before returning `data` — so
 * it can never itself return an over-cap array (the schema's `.max(n)`
 * would reject the fixture and MockLLMProvider would throw). To exercise the
 * extractor's OWN defensive post-grounding slice (the plan's documented
 * "belt-and-suspenders on top of the Zod .max(n)"), the AC-19 cap-slice test
 * below uses a small custom `LLMProvider` double that returns an
 * intentionally-uncapped payload WITHOUT validating it — simulating a
 * real-world provider/model that doesn't strictly enforce array bounds.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LLMProvider, OnboardingSections, StructuredRequest } from "@devdigest/shared";
import { MockLLMProvider } from "../../adapters/mocks.js";
import { generateSections } from "./extractor.js";
import type { OnboardingFacts } from "./facts.js";
import { CRITICAL_MAX, FIRST_TASKS_MAX, COMMANDS_MAX, NARRATIVE_MAX, READING_MAX } from "./constants.js";

function makeFacts(overrides: Partial<OnboardingFacts> = {}): OnboardingFacts {
  return {
    header: {
      filesIndexed: 10,
      indexUpdatedAt: new Date("2026-07-01T00:00:00Z"),
      degraded: false,
    },
    readingPath: [],
    criticalCandidates: [],
    routeInventory: [],
    stack: { languages: ["TypeScript"], frameworks: [] },
    commands: [],
    repoMapText: "",
    ...overrides,
  };
}

function validSectionsFixture(overrides: Partial<OnboardingSections> = {}): OnboardingSections {
  return {
    architecture: {
      narrative: "This repository is a small TypeScript service.",
      codeRefs: [{ path: "src/exists.ts" }],
      diagram: null,
    },
    criticalPaths: [{ path: "src/exists.ts", why: "Core entry point.", callerCount: 3 }],
    howToRun: [{ order: 1, command: "npm install" }],
    readingPath: [{ order: 1, path: "src/exists.ts", rationale: "Start here." }],
    firstTasks: [{ title: "Read src/exists.ts" }],
    ...overrides,
  };
}

/**
 * A `LLMProvider` double that returns `sections` VERBATIM, without any
 * schema validation — models a provider/model that produced content
 * violating the schema's own array-length bounds (unlike `MockLLMProvider`,
 * which always validates and would reject such a fixture outright). Used
 * ONLY for the AC-19 cap-slice test, to reach `extractor.ts`'s own
 * defensive slicing logic.
 */
function makeOvercapProvider(sections: OnboardingSections): LLMProvider {
  return {
    id: "openai",
    listModels: async () => [],
    complete: async () => {
      throw new Error("complete() should not be called by generateSections");
    },
    completeStructured: async <T>(req: StructuredRequest<T>) => ({
      data: sections as unknown as T,
      model: req.model,
      tokensIn: 10,
      tokensOut: 10,
      costUsd: 0,
      raw: JSON.stringify(sections),
      attempts: 1,
    }),
    embed: async () => [],
  } as unknown as LLMProvider;
}

let cloneRoot: string;

beforeEach(async () => {
  cloneRoot = await mkdtemp(join(tmpdir(), "dd-onboarding-extractor-"));
  await mkdir(join(cloneRoot, "src"), { recursive: true });
});

afterEach(async () => {
  await rm(cloneRoot, { recursive: true, force: true });
});

describe("generateSections", () => {
  it("makes exactly ONE completeStructured call for a non-degraded generation (AC-4)", async () => {
    await writeFile(join(cloneRoot, "src", "exists.ts"), "export const x = 1;", "utf8");
    const llm = new MockLLMProvider("openai", { structured: validSectionsFixture() });

    const result = await generateSections({
      facts: makeFacts(),
      clonePath: cloneRoot,
      llm,
      model: "test-model",
    });

    const structuredCalls = llm.calls.filter((c) => c.method === "completeStructured");
    expect(structuredCalls).toHaveLength(1);
    expect("sections" in result).toBe(true);
  });

  it("drops/de-links any emitted path that does not exist in the clone, keeping only grounded paths (AC-13)", async () => {
    // Only 'src/exists.ts' is actually written to the clone.
    await writeFile(join(cloneRoot, "src", "exists.ts"), "export const x = 1;", "utf8");

    const fixture = validSectionsFixture({
      architecture: {
        narrative: "n",
        codeRefs: [{ path: "src/exists.ts" }, { path: "src/missing.ts" }],
        diagram: null,
      },
      criticalPaths: [
        { path: "src/exists.ts", why: "real" },
        { path: "src/missing2.ts", why: "fabricated" },
      ],
      readingPath: [
        { order: 1, path: "src/exists.ts", rationale: "real" },
        { order: 2, path: "src/missing3.ts", rationale: "fabricated" },
      ],
    });
    const llm = new MockLLMProvider("openai", { structured: fixture });

    const result = await generateSections({
      facts: makeFacts(),
      clonePath: cloneRoot,
      llm,
      model: "test-model",
    });

    expect("sections" in result).toBe(true);
    if (!("sections" in result)) throw new Error("unreachable");

    expect(result.sections.architecture.codeRefs.map((r) => r.path)).toEqual(["src/exists.ts"]);
    expect(result.sections.criticalPaths.map((c) => c.path)).toEqual(["src/exists.ts"]);
    expect(result.sections.readingPath.map((r) => r.path)).toEqual(["src/exists.ts"]);
    // No fabricated path survives, in any of the three grounded lists.
    for (const c of result.sections.criticalPaths) {
      expect(c.path).not.toBe("src/missing2.ts");
    }
    for (const r of result.sections.readingPath) {
      expect(r.path).not.toBe("src/missing3.ts");
    }
  });

  it("slices every over-cap array to its AC-19 limit (belt-and-suspenders over the Zod .max(n))", async () => {
    // Create enough real files so grounding never drops an item — isolates
    // the cap-slice behavior from AC-13's grounding behavior.
    const files = await Promise.all(
      Array.from({ length: 12 }, async (_, i) => {
        const rel = `src/f${i}.ts`;
        await writeFile(join(cloneRoot, rel), `export const f${i} = ${i};`, "utf8");
        return rel;
      }),
    );

    const overcap: OnboardingSections = {
      architecture: {
        // 1500 chars, well beyond NARRATIVE_MAX(1200).
        narrative: "x".repeat(1500),
        codeRefs: [{ path: files[0]! }],
        diagram: null,
      },
      // 12 items, beyond CRITICAL_MAX(7).
      criticalPaths: files.map((path) => ({ path, why: "reason" })),
      // 12 items, beyond COMMANDS_MAX(10).
      howToRun: Array.from({ length: 12 }, (_, i) => ({ order: i + 1, command: `cmd-${i}` })),
      // 9 items, beyond READING_MAX(7).
      readingPath: files
        .slice(0, 9)
        .map((path, i) => ({ order: i + 1, path, rationale: "reason" })),
      // 7 items, beyond FIRST_TASKS_MAX(5).
      firstTasks: Array.from({ length: 7 }, (_, i) => ({ title: `task-${i}` })),
    };

    const llm = makeOvercapProvider(overcap);

    const result = await generateSections({
      facts: makeFacts(),
      clonePath: cloneRoot,
      llm,
      model: "test-model",
    });

    expect("sections" in result).toBe(true);
    if (!("sections" in result)) throw new Error("unreachable");

    expect(result.sections.criticalPaths).toHaveLength(CRITICAL_MAX);
    expect(result.sections.howToRun).toHaveLength(COMMANDS_MAX);
    expect(result.sections.readingPath).toHaveLength(READING_MAX);
    expect(result.sections.firstTasks).toHaveLength(FIRST_TASKS_MAX);
    expect(result.sections.architecture.narrative.length).toBeLessThanOrEqual(NARRATIVE_MAX);
  });

  it("nulls out an architecture diagram declaring more than DIAGRAM_NODES_MAX(8) nodes (AC-6/AC-19)", async () => {
    const overCapDiagramLines = ["flowchart TD"];
    const nodeIds = Array.from({ length: 9 }, (_, i) => `N${i + 1}`);
    for (const [i, id] of nodeIds.entries()) {
      overCapDiagramLines.push(`  ${id}["node${i}"]`);
    }
    for (let i = 0; i < nodeIds.length - 1; i++) {
      overCapDiagramLines.push(`  ${nodeIds[i]} --> ${nodeIds[i + 1]}`);
    }
    const fixture = validSectionsFixture({
      architecture: {
        narrative: "n",
        codeRefs: [],
        diagram: overCapDiagramLines.join("\n"),
      },
      criticalPaths: [],
      readingPath: [],
    });
    const llm = new MockLLMProvider("openai", { structured: fixture });

    const result = await generateSections({
      facts: makeFacts(),
      clonePath: cloneRoot,
      llm,
      model: "test-model",
    });

    expect("sections" in result).toBe(true);
    if (!("sections" in result)) throw new Error("unreachable");
    expect(result.sections.architecture.diagram).toBeNull();
  });

  it("nulls out an architecture diagram containing an unsafe interaction directive (e.g. click/javascript:) (AC-6, security)", async () => {
    const unsafeDiagram = [
      "flowchart TD",
      '  N1["a"]',
      '  click N1 "javascript:alert(1)"',
    ].join("\n");
    const fixture = validSectionsFixture({
      architecture: { narrative: "n", codeRefs: [], diagram: unsafeDiagram },
      criticalPaths: [],
      readingPath: [],
    });
    const llm = new MockLLMProvider("openai", { structured: fixture });

    const result = await generateSections({
      facts: makeFacts(),
      clonePath: cloneRoot,
      llm,
      model: "test-model",
    });

    expect("sections" in result).toBe(true);
    if (!("sections" in result)) throw new Error("unreachable");
    expect(result.sections.architecture.diagram).toBeNull();
  });

  it("preserves a valid, code-fenced flowchart diagram within the node cap (fences alone are not a rejection reason)", async () => {
    // Real models commonly wrap mermaid output in markdown code fences —
    // AC-6 only requires the RENDERED diagram to be a valid, bounded
    // flowchart; nothing in the spec says a fenced-but-otherwise-valid
    // diagram must be discarded.
    const fencedDiagram = ['```mermaid', "flowchart TD", '  A["Auth"] --> B["DB"]', "```"].join(
      "\n",
    );
    const fixture = validSectionsFixture({
      architecture: { narrative: "n", codeRefs: [], diagram: fencedDiagram },
      criticalPaths: [],
      readingPath: [],
    });
    const llm = new MockLLMProvider("openai", { structured: fixture });

    const result = await generateSections({
      facts: makeFacts(),
      clonePath: cloneRoot,
      llm,
      model: "test-model",
    });

    expect("sections" in result).toBe(true);
    if (!("sections" in result)) throw new Error("unreachable");
    expect(result.sections.architecture.diagram).not.toBeNull();
    expect(result.sections.architecture.diagram).not.toContain("```");
  });

  it("a schema-invalid model response falls back to { invalid: true } (AC-5)", async () => {
    // Missing the required `why` field on the criticalPaths item — fails
    // OnboardingSectionsSchema, so MockLLMProvider throws and the extractor
    // must catch it rather than propagate.
    const badFixture = {
      architecture: { narrative: "n", codeRefs: [], diagram: null },
      criticalPaths: [{ path: "src/a.ts" }],
      howToRun: [],
      readingPath: [],
      firstTasks: [],
    };
    const llm = new MockLLMProvider("openai", { structured: badFixture });

    const result = await generateSections({
      facts: makeFacts(),
      clonePath: cloneRoot,
      llm,
      model: "test-model",
    });

    expect(result).toEqual({ invalid: true });
  });
});
