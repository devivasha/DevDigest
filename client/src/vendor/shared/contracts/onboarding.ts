import { z } from 'zod';

/**
 * Onboarding Tour contract (server -> client).
 *
 * Facts are collected deterministically via `container.repoIntel` (AC-1); the
 * five `sections` below are produced by exactly one `completeStructured` call
 * when not degraded (AC-4), or by a deterministic skeleton when degraded
 * (AC-5, AC-11, AC-12). `OnboardingSectionsSchema` is the SAME schema the
 * extractor passes to `completeStructured` — single source of truth for both
 * the model contract and the persisted/served shape.
 *
 * Every array below carries an explicit `.max(n)` cap mirroring the AC-19
 * bounds (Critical paths <= 7, Reading path <= 7, How-to-run <= 10,
 * First tasks <= 5, Architecture code refs <= 12). These caps are the
 * first-line defense; the extractor additionally slices post-grounding.
 *
 * `architecture.diagram` is a mermaid `flowchart` string (or `null`), NOT a
 * `{ nodes, edges }` object — it feeds the existing `MermaidDiagram({ chart })`
 * component directly.
 *
 * `DegradedReason` mirrors `repo-intel/types.ts` (server-only) so the client
 * can render the degraded reason without importing server internals.
 */

// ---- Degraded reason ----
export const DegradedReason = z.enum([
  'flag_off',
  'index_failed',
  'index_partial',
  'repo_too_large',
  'no_data',
]);
export type DegradedReason = z.infer<typeof DegradedReason>;

// ---- Architecture ----
export const OnboardingCodeRef = z.object({
  path: z.string(),
  label: z.string().optional(),
});
export type OnboardingCodeRef = z.infer<typeof OnboardingCodeRef>;

export const OnboardingArchitecture = z.object({
  narrative: z.string().max(1200),
  codeRefs: z.array(OnboardingCodeRef).max(12),
  diagram: z.string().nullable(),
});
export type OnboardingArchitecture = z.infer<typeof OnboardingArchitecture>;

// ---- Critical paths ----
export const OnboardingCriticalPath = z.object({
  path: z.string(),
  why: z.string(),
  callerCount: z.number().int().optional(),
});
export type OnboardingCriticalPath = z.infer<typeof OnboardingCriticalPath>;

// ---- How-to-run ----
export const OnboardingHowToRunStep = z.object({
  order: z.number().int(),
  command: z.string(),
  note: z.string().optional(),
});
export type OnboardingHowToRunStep = z.infer<typeof OnboardingHowToRunStep>;

// ---- Reading path ----
export const OnboardingReadingPathItem = z.object({
  order: z.number().int(),
  path: z.string(),
  rationale: z.string(),
});
export type OnboardingReadingPathItem = z.infer<typeof OnboardingReadingPathItem>;

// ---- First tasks ----
export const OnboardingFirstTask = z.object({
  title: z.string(),
  detail: z.string().optional(),
});
export type OnboardingFirstTask = z.infer<typeof OnboardingFirstTask>;

// ---- Composed sections (the exact schema passed to completeStructured) ----
export const OnboardingSectionsSchema = z.object({
  architecture: OnboardingArchitecture,
  criticalPaths: z.array(OnboardingCriticalPath).max(7),
  howToRun: z.array(OnboardingHowToRunStep).max(10),
  readingPath: z.array(OnboardingReadingPathItem).max(7),
  firstTasks: z.array(OnboardingFirstTask).max(5),
});
export type OnboardingSections = z.infer<typeof OnboardingSectionsSchema>;

// ---- Onboarding Tour (persisted + served payload) ----
export const OnboardingTour = z.object({
  repoId: z.string(),
  repoName: z.string(),
  generatedAt: z.string(),
  indexFileCount: z.number().int(),
  lastRefreshedAt: z.string(),
  degraded: z.boolean(),
  degradedReason: DegradedReason.optional(),
  stale: z.boolean().optional(),
  sections: OnboardingSectionsSchema,
});
export type OnboardingTour = z.infer<typeof OnboardingTour>;
