import type { IconName } from "@devdigest/ui";

/** The 5 sections, in render/anchor-nav order (spec: Architecture overview,
    Critical paths, How to run locally, Guided reading path, First tasks). */
export const SECTION_IDS = [
  "architecture",
  "criticalPaths",
  "howToRun",
  "readingPath",
  "firstTasks",
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** Icon per section header — mirrors the design's per-section glyph. */
export const SECTION_ICON: Record<SectionId, IconName> = {
  architecture: "Layers",
  criticalPaths: "Workflow",
  howToRun: "Command",
  readingPath: "ListChecks",
  firstTasks: "CheckCircle",
};

export const SKELETON_SECTION_COUNT = 3;

/** How long the "Copied" / "Link copied" confirmation stays visible. */
export const COPY_FEEDBACK_MS = 1500;
