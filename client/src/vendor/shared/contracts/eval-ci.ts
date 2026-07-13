import { z } from 'zod';
import { Verdict, Finding, Severity, FindingCategory } from './findings';
import { EvalRun, EvalOwnerKind, Conformance } from './knowledge';

/**
 * A4 — Eval / CI / Compose / Conformance API contracts (L06).
 *
 * These EXTEND the barrel; they do not modify existing contract files. The base
 * `EvalRun`, `EvalCase`, `EvalOwnerKind`, `Conformance` live in `knowledge.ts`;
 * here we add the *API-facing* request/response shapes (records persisted in
 * `eval_runs`, `composed_reviews`, `ci_installations`, `ci_runs`,
 * `conformance_checks`) plus the eval-dashboard aggregate.
 */

// ===========================================================================
// Eval — case input + persisted run record + dashboard
// ===========================================================================

/**
 * Expected outcome for an eval case (GAP-4 — validated on write, not left as
 * `z.unknown()`). `kind: 'must_find'` findings must be matched by a kept
 * (post-grounding) produced finding for the case to pass; `'must_not_flag'`
 * findings must NOT be matched by any produced finding (kept or dropped).
 */
export const EvalExpectation = z.object({
  kind: z.enum(['must_find', 'must_not_flag']),
  findings: z.array(
    z.object({
      file: z.string(),
      start_line: z.number().int(),
      end_line: z.number().int(),
      severity: Severity,
      category: FindingCategory,
      title: z.string(),
    }),
  ),
});
export type EvalExpectation = z.infer<typeof EvalExpectation>;

/** Create/update payload for an eval case (id + owner resolved by the route). */
export const EvalCaseInput = z.object({
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string().min(1),
  input_diff: z.string().default(''),
  input_files: z.unknown().nullish(),
  input_meta: z.unknown().nullish(),
  expected_output: EvalExpectation,
  notes: z.string().nullish(),
});
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;

/** A persisted eval run row (one execution of a case), returned by the API. */
export const EvalRunRecord = z.object({
  id: z.string(),
  case_id: z.string(),
  case_name: z.string().nullish(),
  ran_at: z.string(),
  actual_output: z.unknown(),
  pass: z.boolean().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  /** FK to the parent `eval_set_runs` aggregate row (null for legacy/ad-hoc runs). */
  set_run_id: z.string().nullable(),
  /** Denormalized agent version snapshot at run time (null for legacy/ad-hoc runs). */
  version: z.number().int().nullable(),
});
export type EvalRunRecord = z.infer<typeof EvalRunRecord>;

/**
 * A persisted set-level run aggregate (one row per `POST .../eval-runs`),
 * carrying the reproducibility snapshot (agent version + exact system prompt
 * + model) pinned at run time (GAP-1/AC-12). Rendered by the dashboard
 * "Recent eval runs" table (GAP-2) and used as the compare (AC-13) unit.
 * NOTE: intentionally has no `workspace_id` field — tenancy stays server-only
 * (cross-model review finding #1); every server-side query is still scoped by
 * `workspace_id`, it's just not exposed on this wire contract.
 */
export const EvalSetRunRecord = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  ran_at: z.string(),
  version: z.number().int(),
  system_prompt: z.string(),
  model: z.string(),
  recall: z.number(),
  precision: z.number(),
  citation_accuracy: z.number().nullable(),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  under_min: z.boolean(),
});
export type EvalSetRunRecord = z.infer<typeof EvalSetRunRecord>;

/** Compare exactly two set runs — signed metric deltas + a system-prompt diff (AC-13). */
export const EvalCompare = z.object({
  base: EvalSetRunRecord,
  head: EvalSetRunRecord,
  delta: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number().nullable(),
    cost_usd: z.number().nullable(),
  }),
  prompt_diff: z.object({
    base_prompt: z.string(),
    head_prompt: z.string(),
  }),
});
export type EvalCompare = z.infer<typeof EvalCompare>;

/** Result of running a whole eval set: the persisted set-run id + the aggregate metrics. */
export const EvalSetRunResult = z.object({
  set_run_id: z.string(),
  result: EvalRun,
});
export type EvalSetRunResult = z.infer<typeof EvalSetRunResult>;

/** Result of running a single case: the metrics (EvalRun) + the persisted row id. */
export const EvalRunResult = z.object({
  run_id: z.string(),
  case_id: z.string(),
  result: EvalRun,
});
export type EvalRunResult = z.infer<typeof EvalRunResult>;

/**
 * A case's LATEST persisted run status (one row per case, not per run) —
 * powers the Evals tab's per-case pass/fail icon on page load, before any
 * in-session run has happened. Absent from the list returned by
 * `GET /agents/:id/eval-cases/status` means the case has never been run.
 */
export const EvalCaseStatus = z.object({
  case_id: z.string(),
  name: z.string(),
  pass: z.boolean(),
  produced_count: z.number().int().nullable(),
  degraded: z.boolean(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  ran_at: z.string(),
});
export type EvalCaseStatus = z.infer<typeof EvalCaseStatus>;

/** One point on the dashboard trend (per run, chronological). */
export const EvalTrendPoint = z.object({
  ran_at: z.string(),
  recall: z.number(),
  precision: z.number(),
  citation_accuracy: z.number(),
  pass_rate: z.number(),
  cost_usd: z.number().nullable(),
});
export type EvalTrendPoint = z.infer<typeof EvalTrendPoint>;

/** Aggregate dashboard for an owner (agent/skill) or the whole workspace. */
export const EvalDashboard = z.object({
  owner_kind: EvalOwnerKind.nullable(),
  owner_id: z.string().nullable(),
  cases_total: z.number().int(),
  current: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
    traces_passed: z.number().int(),
    traces_total: z.number().int(),
    cost_usd: z.number().nullable(),
  }),
  delta: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
  }),
  trend: z.array(EvalTrendPoint),
  recent_runs: z.array(EvalSetRunRecord),
  alert: z.string().nullable(),
  /** Map of agent owner_id → number of eval cases that owner has. Lets the
   *  all-agents dashboard hide agents with no eval set instead of rendering
   *  a stale/never-run card for them (L06 dashboard fix). */
  owner_case_counts: z.record(z.string(), z.number().int()).default({}),
});
export type EvalDashboard = z.infer<typeof EvalDashboard>;

// ===========================================================================
// Compose Review
// ===========================================================================

export const ComposeReviewInput = z.object({
  /** Finding ids to fold into the draft (optional — body may be hand-written). */
  finding_ids: z.array(z.string()).default([]),
  /** Editable markdown body. If omitted, the server composes one from findings. */
  body: z.string().nullish(),
  verdict: Verdict.default('comment'),
  /** When true, attach selected findings as inline comments (path+line+body). */
  inline_comments: z.boolean().default(false),
});
export type ComposeReviewInput = z.infer<typeof ComposeReviewInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type ComposeReviewInputBody = z.input<typeof ComposeReviewInput>;

/** A persisted composed review (mirrors the `composed_reviews` row). */
export const ComposedReview = z.object({
  id: z.string(),
  pr_id: z.string(),
  body: z.string(),
  verdict: Verdict.nullable(),
  posted_at: z.string().nullable(),
  github_review_id: z.string().nullable(),
});
export type ComposedReview = z.infer<typeof ComposedReview>;

/** A preview (no GitHub side-effect) of what would be posted. */
export const ComposeReviewPreview = z.object({
  body: z.string(),
  verdict: Verdict,
  inline_comments: z.array(
    z.object({ path: z.string(), line: z.number().int(), body: z.string() }),
  ),
});
export type ComposeReviewPreview = z.infer<typeof ComposeReviewPreview>;

// ===========================================================================
// Export-to-CI + CI Runs
// ===========================================================================

export const CiTarget = z.enum(['gha', 'circle', 'jenkins', 'cli']);
export type CiTarget = z.infer<typeof CiTarget>;

/** One generated file in the CI bundle (path + editable contents). */
export const CiFile = z.object({
  path: z.string(),
  contents: z.string(),
  editable: z.boolean().default(true),
});
export type CiFile = z.infer<typeof CiFile>;

/** Request body for `POST /agents/:id/export-ci`. */
export const CiExportInput = z.object({
  repo: z.string().min(1), // "owner/name"
  target: CiTarget.default('gha'),
  /** "open_pr" opens a PR with the files; "files" just returns/persists them. */
  action: z.enum(['open_pr', 'files']).default('open_pr'),
  post_as: z.enum(['github_review', 'pr_comment', 'none']).default('github_review'),
  triggers: z.array(z.string()).default(['opened', 'synchronize', 'reopened']),
  base: z.string().default('main'),
});
export type CiExportInput = z.infer<typeof CiExportInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportInputBody = z.input<typeof CiExportInput>;

/** A persisted CI installation (mirrors `ci_installations`). */
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  repo: z.string(),
  target_type: CiTarget,
  installed_at: z.string(),
});
export type CiInstallation = z.infer<typeof CiInstallation>;

/** Response of `POST /agents/:id/export-ci`. */
export const CiExport = z.object({
  installation: CiInstallation,
  files: z.array(CiFile),
  pr_url: z.string().nullable(),
});
export type CiExport = z.infer<typeof CiExport>;

export const CiRunStatus = z.enum(['succeeded', 'failed', 'no_findings', 'running']);
export type CiRunStatus = z.infer<typeof CiRunStatus>;

/** A CI run row (mirrors `ci_runs`) — ingested from GitHub Actions artifacts. */
export const CiRun = z.object({
  id: z.string(),
  ci_installation_id: z.string().nullable(),
  pr_number: z.number().int().nullable(),
  ran_at: z.string().nullable(),
  status: z.string().nullable(),
  findings_count: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  github_url: z.string().nullable(),
  source: z.string().nullable(),
  agent: z.string().nullish(),
  duration_s: z.number().nullish(),
});
export type CiRun = z.infer<typeof CiRun>;

/**
 * The artifact shape uploaded by the CI action (`devdigest-result.json`).
 * Ingested back on refresh to populate `ci_runs` (L06).
 */
export const CiResultArtifact = z.object({
  findings_count: z.number().int(),
  critical: z.number().int().nullish(),
  warning: z.number().int().nullish(),
  suggestion: z.number().int().nullish(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullish(),
  agent: z.string(),
  version: z.string().nullish(),
  pr_number: z.number().int().nullish(),
});
export type CiResultArtifact = z.infer<typeof CiResultArtifact>;

// ===========================================================================
// Conformance (PRD ↔ PR) — API record (the analysis shape is `Conformance`)
// ===========================================================================

/** Request body for `POST /pulls/:id/conformance`. */
export const ConformanceInput = z.object({
  /** Spec path/id to compare against; if omitted, the first available spec. */
  spec: z.string().nullish(),
  provider: z.enum(['openai', 'anthropic']).nullish(),
  model: z.string().nullish(),
});
export type ConformanceInput = z.infer<typeof ConformanceInput>;

/** A persisted conformance check (mirrors `conformance_checks` + the report). */
export const ConformanceReport = z.object({
  id: z.string(),
  pr_id: z.string(),
  report: Conformance,
});
export type ConformanceReport = z.infer<typeof ConformanceReport>;

// ===========================================================================
// Hooks (Secret-Leak + Phantom-API detectors) — emit grounding-exempt findings
// ===========================================================================

export const HookKind = z.enum(['secret_leak', 'phantom']);
export type HookKind = z.infer<typeof HookKind>;

/** Result of running the built-in detectors over a PR. */
export const HookScanResult = z.object({
  pr_id: z.string(),
  review_id: z.string().nullable(),
  findings: z.array(Finding),
});
export type HookScanResult = z.infer<typeof HookScanResult>;
