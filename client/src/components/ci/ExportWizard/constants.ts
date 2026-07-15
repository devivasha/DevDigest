/* constants.ts — literal values shared across the Export Wizard's steps.
   The shipped bundle bytes always come from the server (`useExportCi` /
   `usePreviewCi`, see InstallStep/PreviewStep) — these constants only
   identify well-known values the client needs to reference locally
   (supported trigger set, the generated workflow file's path). */

export const SUPPORTED_TRIGGERS = ["opened", "synchronize", "reopened"] as const;
export type SupportedTrigger = (typeof SUPPORTED_TRIGGERS)[number];

/** Matches `CiExportInput.triggers`'s default (AC-1). */
export const DEFAULT_TRIGGERS: SupportedTrigger[] = ["opened", "synchronize", "reopened"];

export const WORKFLOW_PATH = ".github/workflows/devdigest-review.yml";

/* Bundle layout prefixes — mirror `server/src/modules/ci/constants.ts`
   (AGENTS_DIR / SKILLS_DIR / MEMORY_PATH / RUNNER_ENTRY_PATH). The Preview step
   classifies each fetched `CiFile` by these so it can group the bundle into
   semantic sections (manifest, linked skills, memory log, runner) rather than
   one raw card per path. */
export const AGENTS_DIR = ".devdigest/agents/";
export const SKILLS_DIR = ".devdigest/skills/";
export const MEMORY_PATH = ".devdigest/memory.jsonl";
export const RUNNER_DIR = ".devdigest/runner/";

/* Secret env names referenced by the generated GHA workflow's `env:` block
   (see `server/src/modules/ci/workflow.ts`). The Configure step lists these so
   the user knows what the exported runner needs: the provider key must be added
   to the repo's Actions secrets, while `GITHUB_TOKEN` is auto-provided by GitHub
   Actions. `DEVDIGEST_INGEST_TOKEN` is intentionally omitted here — it's revealed
   once on the Install step (see `SecretReveal`), not something the user supplies. */
export const PROVIDER_SECRET_NAME = "OPENROUTER_API_KEY";
export const GITHUB_TOKEN_SECRET_NAME = "GITHUB_TOKEN";
