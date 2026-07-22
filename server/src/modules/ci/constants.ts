import type { CiTarget } from '@devdigest/shared';

/**
 * Constants for the `ci` module (Export to CI — T3/T4/T5/T6).
 *
 * Pure literals only — no logic that touches the DB, the filesystem, or a
 * network port belongs here. See `generate.ts` (manifest/bundle assembly)
 * and `workflow.ts` (workflow yml assembly) for the functions that consume
 * these paths.
 */

// ---------------------------------------------------------------------------
// Branch / bundle layout
// ---------------------------------------------------------------------------

/** The branch every GHA `open_pr` export commits to — never the base branch directly (AC-10). */
export const CI_BRANCH_NAME = 'devdigest/ci';

/** Directory holding one manifest per exported agent (`<slug>.yaml`). Runner globs `*.yaml` here. */
export const AGENTS_DIR = '.devdigest/agents/';

/** Directory holding one markdown body per linked skill (`<slug>.md`). */
export const SKILLS_DIR = '.devdigest/skills/';

/** Always shipped, always empty in this iteration (AC-4) — memory lands in a later iteration. */
export const MEMORY_PATH = '.devdigest/memory.jsonl';

/** Where the bundled, ncc-compiled agent-runner is embedded in the exported PR. */
export const RUNNER_ENTRY_PATH = '.devdigest/runner/index.js';

/** The generated, user-editable GitHub Actions workflow (AC-6). */
export const WORKFLOW_PATH = '.github/workflows/devdigest-review.yml';

// ---------------------------------------------------------------------------
// Default commit / PR copy (T5 wires these into `commitFiles`/`openPullRequest`)
// ---------------------------------------------------------------------------

export const DEFAULT_COMMIT_MESSAGE = 'Add DevDigest CI review bundle';

export const DEFAULT_PR_TITLE = 'Add DevDigest automated PR review';

export const DEFAULT_PR_BODY =
  'This PR adds a DevDigest-generated review bundle: an agent manifest, any linked skills, ' +
  'an empty memory log, and a GitHub Actions workflow that runs the bundled reviewer directly ' +
  '(no external marketplace action required). Review the workflow file before merging — every ' +
  'generated file is editable.';

// ---------------------------------------------------------------------------
// Target enum helpers (D... / AC-2, AC-3)
// ---------------------------------------------------------------------------

/** Human-facing label per `CiTarget`, in Target-step display order. */
export const CI_TARGET_LABELS: Record<CiTarget, string> = {
  gha: 'GitHub Actions',
  circle: 'CircleCI',
  jenkins: 'Jenkins',
  cli: 'Generic CLI',
};

/** Display order for the Target step (AC-2 — exactly four targets, `gha` first/recommended). */
export const CI_TARGET_ORDER: CiTarget[] = ['gha', 'circle', 'jenkins', 'cli'];

/** Only `gha` gets a real, executable workflow + `open_pr` support (AC-3, D1). */
export const CI_TARGET_RECOMMENDED: CiTarget = 'gha';

/** WHERE the selected target is not `gha`, the workflow is read-only and `open_pr` is unavailable (AC-3). */
export function isGithubActionsTarget(target: CiTarget): boolean {
  return target === 'gha';
}

/** WHERE the selected target is not `gha`, Install step must restrict to the zip-only path (AC-3). */
export function supportsOpenPr(target: CiTarget): boolean {
  return isGithubActionsTarget(target);
}

// ---------------------------------------------------------------------------
// Triggers (AC-8)
// ---------------------------------------------------------------------------

/** The only triggers the Configure step may toggle, in canonical/emitted order. */
export const SUPPORTED_TRIGGERS = ['opened', 'synchronize', 'reopened'] as const;
export type SupportedTrigger = (typeof SUPPORTED_TRIGGERS)[number];

/** Matches `CiExportInput.triggers`'s default. */
export const DEFAULT_TRIGGERS: SupportedTrigger[] = ['opened', 'synchronize', 'reopened'];

// ---------------------------------------------------------------------------
// Run-history read bounds (MEDIUM finding fix — unbounded reads in
// `ci/repository.ts`'s `listWorkspaceCiRuns` / `listAgentCiRuns` / the
// per-installation status lookup inside `listAgentInstallations`)
// ---------------------------------------------------------------------------

/** Default cap on `ci_runs` history reads (`listWorkspaceCiRuns`,
 *  `listAgentCiRuns`) — rows are ordered `ran_at DESC`, so this returns the N
 *  most recent runs. No cursor pagination in this iteration; callers still
 *  get a plain array, not a paginated envelope. */
export const CI_RUN_HISTORY_LIMIT = 200;

/** Per-installation multiplier bounding the joined `ci_runs` read inside
 *  `listAgentInstallations` (used only to derive each installation's latest
 *  run status) — capped at `installations.length * this`, ordered
 *  `ran_at DESC`. Generous enough that a real installation's actual latest
 *  run is almost always inside the window. */
export const CI_INSTALLATION_STATUS_RUN_MULTIPLIER = 20;
