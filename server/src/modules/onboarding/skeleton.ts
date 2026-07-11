import type {
  DegradedReason,
  OnboardingCriticalPath,
  OnboardingFirstTask,
  OnboardingHowToRunStep,
  OnboardingReadingPathItem,
  OnboardingSections,
} from "@devdigest/shared";
import type { OnboardingFacts } from "./facts.js";
import {
  CRITICAL_MAX,
  COMMANDS_MAX,
  DIAGRAM_NODES_MAX,
  FIRST_TASKS_MAX,
  NARRATIVE_MAX,
  READING_MAX,
} from "./constants.js";

/**
 * Deterministic skeleton builder (AC-5, AC-11, AC-12). Turns an already-capped
 * `OnboardingFacts` bundle into a full, schema-valid `OnboardingSections`
 * payload with ZERO LLM calls and ZERO invented file paths — every path that
 * appears below is copied verbatim from `facts`, never synthesized.
 *
 * This is both:
 *  1. The first-class degraded/no-data render path (AC-11/AC-12), and
 *  2. The schema-invalid-model-output fallback (AC-5) — `extractor.ts` (T6)
 *     calls this same function when `completeStructured` returns malformed
 *     JSON.
 *
 * CTA marker (AC-12): this function does NOT invent a special field inside
 * `OnboardingSections` for the "index this repo" call-to-action — the schema
 * has no such field and any extra property would be silently stripped by
 * `OnboardingSectionsSchema.parse()` (zod's default `strip` mode). Instead,
 * the CTA marker IS `opts.degradedReason === 'no_data'`, the same value the
 * caller (T8's service) copies onto the persisted/served `OnboardingTour`'s
 * top-level `degraded`/`degradedReason` fields (see
 * `onboarding/repository.ts`'s `toDto`). The client (T10) renders the CTA by
 * checking `tour.degraded && tour.degradedReason === 'no_data'` — NOT by
 * inspecting `tour.sections`. This function still tailors its own section
 * CONTENT for the no_data case (see `buildFirstTasks` below) so the skeleton
 * reads sensibly on its own, but that content is supplementary copy, not the
 * click target.
 */
export function buildSkeleton(
  facts: OnboardingFacts,
  opts: { degraded: boolean; degradedReason?: DegradedReason },
): OnboardingSections {
  return {
    architecture: buildArchitecture(facts, opts),
    criticalPaths: buildCriticalPaths(facts),
    howToRun: buildHowToRun(facts),
    readingPath: buildReadingPath(facts),
    firstTasks: buildFirstTasks(facts, opts),
  };
}

// ---------------------------------------------------------------------------
// Architecture
// ---------------------------------------------------------------------------

const DEGRADED_NARRATIVE_NOTES: Record<DegradedReason, string> = {
  flag_off:
    "Repository intelligence is currently disabled for this workspace, so this overview is limited.",
  index_failed:
    "The last indexing attempt failed, so this overview reflects only partial or stale data.",
  index_partial:
    "Indexing is still in progress, so this overview reflects partial data.",
  repo_too_large:
    "This repo is large — showing results from the top-ranked files only.",
  no_data:
    "This repository has not been indexed yet. Add or refresh the index to see the full architecture overview.",
};

function buildArchitecture(
  facts: OnboardingFacts,
  opts: { degraded: boolean; degradedReason?: DegradedReason },
): OnboardingSections["architecture"] {
  return {
    narrative: buildNarrative(facts, opts),
    codeRefs: facts.readingPath.slice(0, READING_MAX).map((f) => ({ path: f.path })),
    diagram: buildDiagram(facts),
  };
}

function buildNarrative(
  facts: OnboardingFacts,
  opts: { degraded: boolean; degradedReason?: DegradedReason },
): string {
  const { stack, routeInventory, readingPath } = facts;
  const languages = stack.languages.length > 0 ? stack.languages.join(", ") : null;
  const frameworks = stack.frameworks.length > 0 ? stack.frameworks.join(", ") : null;

  const parts: string[] = [];
  if (languages) {
    parts.push(
      `This repository uses ${languages}${frameworks ? `, built with ${frameworks}` : ""}.`,
    );
  } else {
    parts.push("This repository's stack could not be determined from the available facts.");
  }
  if (stack.packageManager) {
    parts.push(`Dependencies are managed with ${stack.packageManager}.`);
  }
  if (routeInventory.length > 0) {
    parts.push(
      `It exposes ${routeInventory.length} route${routeInventory.length === 1 ? "" : "s"} across its indexed files.`,
    );
  }
  if (readingPath.length > 0) {
    parts.push(`The highest-ranked file is \`${readingPath[0]!.path}\`.`);
  }
  if (opts.degraded) {
    const reason = opts.degradedReason;
    parts.push(reason ? DEGRADED_NARRATIVE_NOTES[reason] : DEGRADED_NARRATIVE_NOTES.index_failed);
  }

  const narrative = parts.join(" ");
  return narrative.length > NARRATIVE_MAX ? narrative.slice(0, NARRATIVE_MAX) : narrative;
}

/** Escapes characters that would break a quoted mermaid node label. */
function escapeMermaidLabel(label: string): string {
  return label.replace(/"/g, "'").replace(/[\r\n]+/g, " ");
}

/**
 * Trivially-valid `flowchart` mermaid string built ONLY from ranked file
 * paths already present in `facts` (no invented nodes) — a linear chain in
 * rank-DESC order, capped to `DIAGRAM_NODES_MAX`. Returns `null` when there
 * is nothing to diagram (empty repo / no_data / degraded with zero facts).
 */
function buildDiagram(facts: OnboardingFacts): string | null {
  const files = facts.readingPath.slice(0, DIAGRAM_NODES_MAX);
  if (files.length === 0) return null;

  const lines = ["flowchart TD"];
  const nodeIds = files.map((_, i) => `N${i + 1}`);
  files.forEach((f, i) => {
    const label = escapeMermaidLabel(f.path.split("/").pop() ?? f.path);
    lines.push(`  ${nodeIds[i]}["${label}"]`);
  });
  for (let i = 0; i < nodeIds.length - 1; i++) {
    lines.push(`  ${nodeIds[i]} --> ${nodeIds[i + 1]}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Critical paths (AC-7)
// ---------------------------------------------------------------------------

function buildCriticalPaths(facts: OnboardingFacts): OnboardingCriticalPath[] {
  return facts.criticalCandidates.slice(0, CRITICAL_MAX).map((c) => ({
    path: c.path,
    why:
      c.callerCount > 0
        ? `High-rank file; imported by ${c.callerCount} file${c.callerCount === 1 ? "" : "s"}.`
        : `High-rank file (rank ${c.rank.toFixed(2)}) with no detected importers.`,
    callerCount: c.callerCount,
  }));
}

// ---------------------------------------------------------------------------
// How-to-run (AC-8)
// ---------------------------------------------------------------------------

function buildHowToRun(facts: OnboardingFacts): OnboardingHowToRunStep[] {
  return facts.commands.slice(0, COMMANDS_MAX).map((c, i) => ({
    order: i + 1,
    command: c.command,
    note: c.note,
  }));
}

// ---------------------------------------------------------------------------
// Guided reading path (AC-9)
// ---------------------------------------------------------------------------

function buildReadingPath(facts: OnboardingFacts): OnboardingReadingPathItem[] {
  return facts.readingPath.slice(0, READING_MAX).map((f, i) => ({
    order: i + 1,
    path: f.path,
    rationale: `Ranked #${i + 1} by file importance (rank ${f.rank.toFixed(2)}).`,
  }));
}

// ---------------------------------------------------------------------------
// First tasks (AC-10)
// ---------------------------------------------------------------------------

function buildFirstTasks(
  facts: OnboardingFacts,
  opts: { degraded: boolean; degradedReason?: DegradedReason },
): OnboardingFirstTask[] {
  const tasks: OnboardingFirstTask[] = [];

  if (opts.degradedReason === "no_data") {
    tasks.push({
      title: "Index this repository",
      detail:
        "This repo has not been indexed yet. Add or refresh the repo index to unlock the full onboarding tour.",
    });
    return tasks.slice(0, FIRST_TASKS_MAX);
  }

  const topFile = facts.readingPath[0];
  if (topFile) {
    tasks.push({
      title: `Read the top-ranked file \`${topFile.path}\``,
      detail: "This file has the highest rank in the repo and is a strong starting point.",
    });
  }

  const testCommand = facts.commands.find((c) => /test/i.test(c.command));
  if (testCommand) {
    tasks.push({
      title: "Run the test command",
      detail: testCommand.command,
    });
  }

  const setupCommand = facts.commands.find(
    (c) => /install|setup/i.test(c.command) && c !== testCommand,
  );
  if (setupCommand) {
    tasks.push({
      title: "Install dependencies",
      detail: setupCommand.command,
    });
  }

  const secondFile = facts.readingPath[1];
  if (secondFile) {
    tasks.push({
      title: `Explore \`${secondFile.path}\``,
      detail: "Second highest-ranked file in the repo.",
    });
  }

  if (tasks.length === 0) {
    tasks.push({
      title: "Explore the repository",
      detail: "No ranked files or commands were found yet — browse the codebase to get familiar with it.",
    });
  }

  return tasks.slice(0, FIRST_TASKS_MAX);
}
