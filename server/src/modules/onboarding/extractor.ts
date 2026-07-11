import { stat } from "fs/promises";
import { resolve, sep } from "path";
import {
  OnboardingSectionsSchema,
  type LLMProvider,
  type OnboardingSections,
} from "@devdigest/shared";
import { renderPrompt } from "../../platform/prompts.js";
import { wrapUntrusted } from "../../platform/prompt.js";
import type { OnboardingFacts } from "./facts.js";
import {
  CRITICAL_MAX,
  READING_MAX,
  COMMANDS_MAX,
  FIRST_TASKS_MAX,
  DIAGRAM_NODES_MAX,
  NARRATIVE_MAX,
} from "./constants.js";

/**
 * Single-LLM-call narrative extractor for the Onboarding Tour (AC-4, AC-5,
 * AC-6, AC-13, AC-19). Mirrors `conventions/extractor.ts`'s shape: a plain
 * function receiving an already-built `llm`/`model` (never the container),
 * making EXACTLY ONE `completeStructured` call, then grounding the result in
 * code. Never loops or retries per section.
 */

const PROMPT_TEMPLATE = "onboarding.system.md";

/** No caller currently threads a locale through; the product default is
 * English. Revisit if/when the onboarding route gains a language param. */
const DEFAULT_LANGUAGE = "English";

const SECTION_ORDER = [
  "1. architecture",
  "2. criticalPaths",
  "3. howToRun",
  "4. readingPath",
  "5. firstTasks",
].join("\n");

/** How many route-inventory lines to feed the model — the fact itself is
 * intentionally unbounded (repo-wide, per repo-intel's design), but the
 * prompt only needs a representative slice to ground the architecture
 * narrative; this is a token-budget guard, not an AC-19 cap. */
const ROUTES_IN_PROMPT_MAX = 50;

// ---------------------------------------------------------------------------
// Facts -> untrusted user message
// ---------------------------------------------------------------------------

/**
 * Renders `OnboardingFacts` into the single user-message block fed to the
 * model. Every value here is repo-derived (file paths, package.json-sourced
 * stack/commands, repo map text) — third-party content an attacker with repo
 * write access could shape — so the WHOLE block is wrapped via
 * `wrapUntrusted` (mirrors `intent/classifier.ts`'s handling of referenced
 * plans/specs). The system prompt's injection guard governs how the model
 * must treat it: data to analyze, never instructions.
 */
function factsToUserMessage(facts: OnboardingFacts): string {
  const lines: string[] = [];

  lines.push(
    `Stack: languages=${facts.stack.languages.join(", ") || "unknown"}; ` +
      `frameworks=${facts.stack.frameworks.join(", ") || "unknown"}; ` +
      `packageManager=${facts.stack.packageManager ?? "unknown"}`,
  );

  lines.push("");
  lines.push(
    "Top-ranked files (already ordered rank DESC — this IS the reading-path order):",
  );
  for (const f of facts.readingPath) {
    lines.push(`- ${f.path} (rank=${f.rank.toFixed(3)})`);
  }

  lines.push("");
  lines.push(
    "Critical-candidate files (already scored by rank + importer count, ordered DESC):",
  );
  for (const c of facts.criticalCandidates) {
    lines.push(`- ${c.path} (rank=${c.rank.toFixed(3)}, callerCount=${c.callerCount})`);
  }

  lines.push("");
  lines.push("Setup / run commands:");
  for (const cmd of facts.commands) {
    lines.push(`- ${cmd.command}${cmd.note ? ` (${cmd.note})` : ""}`);
  }

  lines.push("");
  lines.push("Route / endpoint inventory (sample):");
  for (const route of facts.routeInventory.slice(0, ROUTES_IN_PROMPT_MAX)) {
    lines.push(`- ${route}`);
  }

  lines.push("");
  lines.push("Repo map:");
  lines.push(facts.repoMapText || "(none available)");

  return wrapUntrusted("onboarding-facts", lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Grounding — every emitted path must exist in the clone (AC-13)
// ---------------------------------------------------------------------------

/**
 * True IFF `relPath` resolves to a real, in-tree FILE under `clonePath`.
 * Mirrors `conventions/extractor.ts`'s `verifyEvidence`, but checks
 * path-existence rather than a quote match (AC-13). Rejects absolute paths
 * and any `..` segment outright, then re-confirms the resolved path is still
 * contained in `clonePath` — so a model-authored path can never escape the
 * clone (out-of-tree paths never survive grounding).
 */
async function isGroundedPath(clonePath: string, relPath: string): Promise<boolean> {
  if (!relPath || relPath.startsWith("/") || relPath.includes("..")) return false;

  const root = resolve(clonePath) + sep;
  const target = resolve(clonePath, relPath);
  if (!target.startsWith(root)) return false;

  try {
    const info = await stat(target);
    return info.isFile();
  } catch {
    return false;
  }
}

async function filterAsync<T>(
  items: T[],
  predicate: (item: T) => Promise<boolean>,
): Promise<T[]> {
  const keep = await Promise.all(items.map(predicate));
  return items.filter((_, i) => keep[i]);
}

/**
 * Drops any unverifiable path from `architecture.codeRefs`, `criticalPaths`,
 * and `readingPath` (AC-13). Grounding can only ever REMOVE items, never add
 * or reorder them.
 */
async function groundSections(
  clonePath: string,
  sections: OnboardingSections,
): Promise<OnboardingSections> {
  const [codeRefs, criticalPaths, readingPath] = await Promise.all([
    filterAsync(sections.architecture.codeRefs, (ref) => isGroundedPath(clonePath, ref.path)),
    filterAsync(sections.criticalPaths, (c) => isGroundedPath(clonePath, c.path)),
    filterAsync(sections.readingPath, (r) => isGroundedPath(clonePath, r.path)),
  ]);

  return {
    ...sections,
    architecture: { ...sections.architecture, codeRefs },
    criticalPaths,
    readingPath,
  };
}

// ---------------------------------------------------------------------------
// Mermaid diagram sanitizer (AC-6, AC-19)
// ---------------------------------------------------------------------------

/** HTML tags, `javascript:` URIs, and inline event handlers are never valid
 * inside a mermaid label — any of these mean the string is unsafe to render
 * as-is, regardless of node count. */
const UNSAFE_DIAGRAM_RE = /<|javascript:|on\w+\s*=/i;

/** Mermaid's `click`/`href`/`linkStyle` directives can attach interactive
 * links (including `javascript:` URIs) to nodes — reject the whole diagram
 * rather than try to strip just the directive line. */
const INTERACTION_DIRECTIVE_RE = /^(click|href)\b/i;

const SKIPPABLE_DIAGRAM_LINE_RE = /^(subgraph|end|classDef|class|style|linkStyle)\b/i;

const ARROW_SPLIT_RE = /-{1,3}>|={1,3}>|-\.->|\.-|--|==/;

const NODE_ID_RE = /^([A-Za-z0-9_]+)/;

/**
 * Sanitizes `architecture.diagram` (AC-6/AC-19): strips ``` fences, requires
 * a `flowchart` prefix, and rejects (-> `null`) any diagram that declares
 * more than `DIAGRAM_NODES_MAX` distinct node ids or contains unsafe label
 * content. This is a second, code-level gate on top of the prompt's own
 * mermaid rules — the client `MermaidDiagram` component re-validates again
 * before render, per the plan's "belt-and-suspenders" design.
 */
function sanitizeDiagram(raw: string | null): string | null {
  if (!raw) return null;

  const stripped = raw
    .replace(/```[a-zA-Z]*\n?/g, "")
    .replace(/```/g, "")
    .trim();
  if (!stripped) return null;
  if (!/^flowchart\b/i.test(stripped)) return null;
  if (UNSAFE_DIAGRAM_RE.test(stripped)) return null;

  const nodeIds = new Set<string>();
  const lines = stripped.split("\n").slice(1); // skip the `flowchart LR/TD` line
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (SKIPPABLE_DIAGRAM_LINE_RE.test(line)) continue;
    if (INTERACTION_DIRECTIVE_RE.test(line)) return null;

    for (const part of line.split(ARROW_SPLIT_RE)) {
      const match = NODE_ID_RE.exec(part.trim());
      if (match?.[1]) nodeIds.add(match[1]);
    }
  }

  if (nodeIds.size === 0 || nodeIds.size > DIAGRAM_NODES_MAX) return null;

  return stripped;
}

// ---------------------------------------------------------------------------
// AC-19 cap slice — belt-and-suspenders over the Zod `.max(n)` in T1
// ---------------------------------------------------------------------------

function applyCaps(sections: OnboardingSections): OnboardingSections {
  return {
    ...sections,
    architecture: {
      ...sections.architecture,
      narrative: sections.architecture.narrative.slice(0, NARRATIVE_MAX),
    },
    criticalPaths: sections.criticalPaths.slice(0, CRITICAL_MAX),
    howToRun: sections.howToRun.slice(0, COMMANDS_MAX),
    readingPath: sections.readingPath.slice(0, READING_MAX),
    firstTasks: sections.firstTasks.slice(0, FIRST_TASKS_MAX),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GenerateSectionsOpts {
  facts: OnboardingFacts;
  clonePath: string;
  llm: LLMProvider;
  /** Model id understood by the injected provider (resolved upstream via
   * `resolveFeatureModel(container, workspaceId, "onboarding")`). */
  model: string;
}

/**
 * Makes EXACTLY ONE `llm.completeStructured` call to produce the 5
 * `OnboardingSections`, then in order: (1) grounds every emitted path
 * against the clone (AC-13), (2) sanitizes `architecture.diagram` (AC-6),
 * (3) slices every capped array to its AC-19 limit. A schema-invalid /
 * parse-failed model response returns `{ invalid: true }` so the caller
 * (service.ts) falls back to the deterministic skeleton (AC-5). Never loops
 * or retries per section — one call, full stop.
 */
export async function generateSections(
  opts: GenerateSectionsOpts,
): Promise<{ sections: OnboardingSections } | { invalid: true }> {
  const { facts, clonePath, llm, model } = opts;

  const systemPrompt = await renderPrompt(PROMPT_TEMPLATE, {
    sections: SECTION_ORDER,
    language: DEFAULT_LANGUAGE,
  });

  let rawSections: OnboardingSections;
  try {
    const result = await llm.completeStructured({
      model,
      schema: OnboardingSectionsSchema,
      schemaName: "OnboardingTour",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: factsToUserMessage(facts) },
      ],
      temperature: 0.2,
      maxTokens: 4096,
    });
    rawSections = result.data;
  } catch {
    return { invalid: true };
  }

  const grounded = await groundSections(clonePath, rawSections);
  const withSanitizedDiagram: OnboardingSections = {
    ...grounded,
    architecture: {
      ...grounded.architecture,
      diagram: sanitizeDiagram(grounded.architecture.diagram),
    },
  };
  const capped = applyCaps(withSanitizedDiagram);

  return { sections: capped };
}
