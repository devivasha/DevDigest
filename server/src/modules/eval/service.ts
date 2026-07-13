/**
 * eval/service.ts — application layer for the Eval Pipeline (L06 — T7).
 *
 * Orchestrates `container.evalRepo` (T5) + `container.reviewRepo` +
 * `container.agentsRepo` + the injected `container.llm(provider)`, calls
 * reviewer-core's `reviewPullRequest` (the ONLY place an LLM is invoked —
 * scoring itself is zero-LLM, AC-9), and scores with the pure T4 scorer.
 *
 * Onion layer: application — no SQL here (all persistence goes through
 * `EvalRepository`), no route/Fastify concerns, no adapter construction (the
 * container is the sole composition root).
 *
 * Security: `createFromFinding` derives the owning agent SERVER-SIDE from
 * `finding → review.agentId` — the route's `:id` param is used only as an
 * authorization cross-check (IDOR guard, cross-model review finding #4).
 * Every method resolves its target within the caller's `workspaceId` and
 * refuses (NotFoundError) on any cross-tenant mismatch (AC-24).
 */
import type { Container } from '../../platform/container.js';
import type { Logger } from '../reviews/run-executor.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { loadDiff } from '../reviews/diff-loader.js';
import type { FindingRow, AgentRow } from '../../db/rows.js';
import { reviewPullRequest, type ReviewStrategy } from '@devdigest/reviewer-core';
import type { LLMProvider } from '@devdigest/shared';
import {
  EvalCaseInput,
  EvalExpectation,
  type EvalCase,
  type EvalCaseStatus,
  type EvalCompare,
  type EvalDashboard,
  type EvalOwnerKind,
  type EvalRun,
  type EvalSetRunRecord,
  type Finding,
  type UnifiedDiff,
} from '@devdigest/shared';
import type { InsertCaseRunRow, SetRunAggregatePatch, UpdateEvalCaseInput } from './repository.js';
import { scoreCase, poolSetMetrics, metricDelta, regressionOf, type PerCaseMetrics } from './scorer.js';

/** Minimum case count a set should have before running (AC-15 — warn, not block). */
const MIN_CASES = 8;

export class EvalService {
  constructor(
    private container: Container,
    private logger?: Logger,
  ) {}

  // =========================================================================
  // Case creation from triage (AC-1, AC-2, AC-3, AC-4, AC-24, finding #4)
  // =========================================================================

  /**
   * Turn a triaged finding into an eval case in one action (AC-1). Ownership
   * is derived from the finding's OWN review, never from the caller-supplied
   * `routeAgentId` — `routeAgentId` is used only as an authorization
   * cross-check (finding #4 — IDOR). Any tenancy/ownership mismatch refuses
   * as NotFound (AC-24), never a partial/degraded response.
   */
  async createFromFinding(
    workspaceId: string,
    routeAgentId: string,
    findingId: string,
  ): Promise<EvalCase> {
    const ctx = await this.container.reviewRepo.findingContext(findingId);
    if (!ctx) throw new NotFoundError(`Finding not found: ${findingId}`);
    const { finding, review, pull } = ctx;

    // Tenancy first — `findingContext` itself is not workspace-scoped, so both
    // the review row and the PR row must independently confirm the caller's
    // workspace before anything else happens (structural tenancy, mirrors
    // finding #1's "never rely on a single join to prove tenancy").
    if (review.workspaceId !== workspaceId || pull.workspaceId !== workspaceId) {
      throw new NotFoundError(`Finding not found: ${findingId}`);
    }
    // IDOR guard (finding #4): the owning agent is `review.agentId`, NOT the
    // route param. `:id` is only checked for equality — a mismatch (or a
    // review with no agent at all) is refused as not-found, never served.
    if (!review.agentId || review.agentId !== routeAgentId) {
      throw new NotFoundError(`Finding not found: ${findingId}`);
    }

    const kind = deriveExpectationKind(finding);

    const repoRow = await this.container.reviewRepo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError(`Repository not found for PR: ${pull.id}`);
    const diff = await loadDiff(this.container, this.container.reviewRepo, workspaceId, pull, repoRow);

    const expectation = parseExpectation({
      kind,
      findings: [
        {
          file: finding.file,
          start_line: finding.startLine,
          end_line: finding.endLine,
          severity: finding.severity,
          category: finding.category,
          title: finding.title,
        },
      ],
    });

    return this.createCaseGuarded(workspaceId, {
      owner_kind: 'agent',
      owner_id: review.agentId,
      name: deriveCaseName(finding),
      input_diff: diff.raw,
      input_files: null,
      input_meta: null,
      expected_output: expectation,
      notes: null,
    });
  }

  // =========================================================================
  // Manual case CRUD (AC-19, AC-22, GAP-4)
  // =========================================================================

  async listCases(workspaceId: string, ownerKind: EvalOwnerKind, ownerId: string): Promise<EvalCase[]> {
    return this.container.evalRepo.listCasesByOwner(workspaceId, ownerKind, ownerId);
  }

  async getCase(workspaceId: string, caseId: string): Promise<EvalCase> {
    const found = await this.container.evalRepo.getCase(workspaceId, caseId);
    if (!found) throw new NotFoundError(`Eval case not found: ${caseId}`);
    return found;
  }

  /** Manual create (case editor "Save"). `expected_output` is validated
   *  against `EvalExpectation` before persist (AC-22/GAP-4). */
  async createCase(workspaceId: string, input: EvalCaseInput): Promise<EvalCase> {
    const expectation = parseExpectation(input.expected_output);
    return this.createCaseGuarded(workspaceId, { ...input, expected_output: expectation });
  }

  /**
   * `EvalRepository.createCase` deliberately never `onConflictDoNothing`s a
   * real user-facing create (see its own doc comment) — a duplicate
   * `(workspace_id, owner_id, name)` raises a Postgres unique-violation
   * (`23505`). Translated here into a friendly `ValidationError` (422)
   * instead of letting a raw driver error reach the route/client — this
   * matters most for `createFromFinding`, where re-clicking "Turn into eval
   * case" on the same finding would otherwise deterministically collide
   * (the derived name embeds the finding's own id).
   */
  private async createCaseGuarded(workspaceId: string, input: EvalCaseInput): Promise<EvalCase> {
    try {
      return await this.container.evalRepo.createCase(workspaceId, input);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ValidationError(`An eval case named "${input.name}" already exists for this owner`, {
          name: input.name,
        });
      }
      throw err;
    }
  }

  /** Manual update. `expected_output`, when present in the patch, is
   *  re-validated against `EvalExpectation` (AC-22/GAP-4) — an invalid JSON
   *  payload blocks the write with a `ValidationError` rather than persisting. */
  async updateCase(workspaceId: string, caseId: string, patch: UpdateEvalCaseInput): Promise<EvalCase> {
    const validatedPatch: UpdateEvalCaseInput =
      patch.expected_output !== undefined
        ? { ...patch, expected_output: parseExpectation(patch.expected_output) }
        : patch;
    const updated = await this.container.evalRepo.updateCase(workspaceId, caseId, validatedPatch);
    if (!updated) throw new NotFoundError(`Eval case not found: ${caseId}`);
    return updated;
  }

  async deleteCase(workspaceId: string, caseId: string): Promise<void> {
    const deleted = await this.container.evalRepo.deleteCase(workspaceId, caseId);
    if (!deleted) throw new NotFoundError(`Eval case not found: ${caseId}`);
  }

  // =========================================================================
  // Run a whole set (AC-11, AC-12, AC-15, AC-17, AC-18, AC-24)
  // =========================================================================

  /**
   * Run the agent once per case in its set, on the case's FIXED stored
   * inputs + the agent's LIVE resolved config (AC-11). Records the agent
   * version + exact system prompt used (AC-12/GAP-1). A single case's
   * provider error marks only that case failed and the set continues
   * (AC-18). An unparseable/empty `input_diff` skips the review entirely and
   * degrades that case's citation_accuracy to `null` (AC-17/Rec-D).
   */
  async runSet(workspaceId: string, agentId: string): Promise<EvalRun> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError(`Agent not found: ${agentId}`);

    const cases = await this.container.evalRepo.listCasesByOwner(workspaceId, 'agent', agentId);
    const underMin = cases.length < MIN_CASES;

    const setRunId = await this.container.evalRepo.insertSetRun(workspaceId, {
      ownerKind: 'agent',
      ownerId: agentId,
      agentVersion: agent.version,
      systemPrompt: agent.systemPrompt,
      model: agent.model,
    });

    // Resolved once — every case in the set shares the agent's live config.
    const llm = await this.container.llm(agent.provider);

    const perCaseMetrics: PerCaseMetrics[] = [];
    const perTrace: EvalRun['per_trace'] = [];
    let costSum = 0;
    let hasCost = false;
    const setStart = Date.now();

    for (const evalCase of cases) {
      const { metrics, trace, costUsd } = await this.runOneCase(workspaceId, agent, evalCase, llm, setRunId);
      if (costUsd != null) {
        costSum += costUsd;
        hasCost = true;
      }
      perCaseMetrics.push(metrics);
      perTrace.push(trace);
    }

    const pooled = poolSetMetrics(perCaseMetrics);
    const durationMs = Date.now() - setStart;
    const costUsd = hasCost ? costSum : null;

    const patch: SetRunAggregatePatch = {
      recall: pooled.recall,
      precision: pooled.precision,
      citationAccuracy: pooled.citation_accuracy,
      tracesPassed: pooled.traces_passed,
      tracesTotal: pooled.traces_total,
      durationMs,
      costUsd,
      underMin,
    };
    await this.container.evalRepo.updateSetRunAggregate(workspaceId, setRunId, patch);

    return {
      recall: pooled.recall,
      precision: pooled.precision,
      citation_accuracy: pooled.citation_accuracy,
      traces_passed: pooled.traces_passed,
      traces_total: pooled.traces_total,
      duration_ms: durationMs,
      cost_usd: costUsd,
      per_trace: perTrace,
    };
  }

  /**
   * Runs ONE eval case against the agent's LIVE resolved config, persists an
   * `eval_runs` row (with `setRunId` — `null` for a standalone single-case
   * run, non-null when called from inside `runSet`'s loop), and returns the
   * metrics/trace/cost/persisted-timestamp the caller needs. This is the
   * single body shared by `runSet` (per-case loop) and `runCase` (per-row
   * "play" button, AC-19) — relocated verbatim from the former inline
   * try/catch in `runSet`'s loop; scorer semantics (degraded/AC-17,
   * per-case-error/AC-18, all-dropped/AC-8) are unchanged.
   */
  private async runOneCase(
    workspaceId: string,
    agent: AgentRow,
    evalCase: EvalCase,
    llm: LLMProvider,
    setRunId: string | null,
  ): Promise<{
    metrics: PerCaseMetrics;
    trace: EvalRun['per_trace'][number];
    costUsd: number | null;
    durationMs: number | null;
    ranAt: string;
  }> {
    const caseStart = Date.now();
    try {
      const expectation = parseExpectation(evalCase.expected_output);
      const parsedDiff = tryParseDiff(evalCase.input_diff);

      let producedAll: Finding[] = [];
      let kept: Finding[] = [];
      let droppedCount = 0;
      let diffAvailable = false;
      let costUsd: number | null = null;
      let degraded = true;

      if (parsedDiff) {
        const outcome = await reviewPullRequest({
          systemPrompt: agent.systemPrompt,
          model: agent.model,
          diff: parsedDiff,
          llm,
          strategy: agent.strategy as ReviewStrategy,
        });
        // Rec-A/GAP-3: read kept + dropped straight off the review outcome —
        // do NOT re-run groundFindings. An all-dropped result (empty kept,
        // non-empty dropped) is a VALID outcome, not an error.
        kept = outcome.review.findings;
        const dropped = outcome.dropped.map((d) => d.finding);
        producedAll = [...kept, ...dropped];
        droppedCount = dropped.length;
        diffAvailable = true;
        costUsd = outcome.costUsd;
        degraded = false;
      }
      // else: unparseable/empty diff — skip reviewPullRequest entirely
      // (Rec-D/finding #6). producedAll/kept stay [], diffAvailable=false.

      const scored = scoreCase({ producedAll, kept, expectation, droppedCount, diffAvailable });
      const durationMs = Date.now() - caseStart;
      const actualOutput = {
        produced: producedAll,
        kept,
        dropped_count: droppedCount,
        degraded,
      };

      const persisted = await this.container.evalRepo.insertCaseRun(
        buildCaseRunRow({
          caseId: evalCase.id,
          workspaceId,
          setRunId,
          agentVersion: agent.version,
          actualOutput,
          pass: scored.pass,
          recall: scored.recall,
          precision: scored.precision,
          citationAccuracy: scored.citation_accuracy,
          durationMs,
          costUsd,
        }),
        evalCase.name,
      );

      return {
        metrics: {
          recall: scored.recall,
          precision: scored.precision,
          citation_accuracy: scored.citation_accuracy,
          pass: scored.pass,
        },
        trace: { name: evalCase.name, pass: scored.pass, expected: expectation, actual: actualOutput },
        costUsd,
        durationMs,
        ranAt: persisted.ran_at,
      };
    } catch (err) {
      // AC-18: a single case's failure (provider error, corrupted
      // expected_output, etc.) marks THAT case failed and the set
      // continues — never aborts the run. Metrics fall back to the same
      // vacuous/finite formulas as a degraded case (no produced findings,
      // no diff processed) so the pooled aggregate stays a finite number,
      // but `pass` is force-set to false — a failed review must never read
      // as "passing" merely because its vacuous recall/precision happen to
      // be 1.0.
      const message = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - caseStart;
      this.logger?.warn({ err, caseId: evalCase.id, agentId: agent.id }, 'eval: case run failed');

      let fallbackScore: ReturnType<typeof scoreCase>;
      try {
        const expectation = parseExpectation(evalCase.expected_output);
        fallbackScore = scoreCase({
          producedAll: [],
          kept: [],
          expectation,
          droppedCount: 0,
          diffAvailable: false,
        });
      } catch {
        // expected_output itself is unreadable — no expectation to score against.
        fallbackScore = { recall: 0, precision: 1, citation_accuracy: null, pass: false };
      }

      const actualOutput = { produced: [], kept: [], dropped_count: 0, degraded: false, error: message };
      const persisted = await this.container.evalRepo.insertCaseRun(
        buildCaseRunRow({
          caseId: evalCase.id,
          workspaceId,
          setRunId,
          agentVersion: agent.version,
          actualOutput,
          pass: false,
          recall: fallbackScore.recall,
          precision: fallbackScore.precision,
          citationAccuracy: fallbackScore.citation_accuracy,
          durationMs,
          costUsd: null,
        }),
        evalCase.name,
      );

      return {
        metrics: {
          recall: fallbackScore.recall,
          precision: fallbackScore.precision,
          citation_accuracy: fallbackScore.citation_accuracy,
          pass: false,
        },
        trace: { name: evalCase.name, pass: false, expected: null, actual: actualOutput },
        costUsd: null,
        durationMs,
        ranAt: persisted.ran_at,
      };
    }
  }

  /**
   * Run a SINGLE eval case (the per-row "play" button, AC-19) — resolves the
   * LIVE agent + case within the caller's workspace (AC-24), verifies the
   * case actually belongs to this agent (ownership/tenancy — mirrors the
   * `createFromFinding` IDOR guard), then runs it via the same `runOneCase`
   * body `runSet` uses. Persists exactly one `eval_runs` row with
   * `set_run_id = null` (a standalone run, not part of a set run).
   */
  async runCase(workspaceId: string, agentId: string, caseId: string): Promise<EvalCaseStatus> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError(`Agent not found: ${agentId}`);

    const evalCase = await this.getCase(workspaceId, caseId);
    if (evalCase.owner_kind !== 'agent' || evalCase.owner_id !== agentId) {
      throw new NotFoundError(`Eval case not found: ${caseId}`);
    }

    const llm = await this.container.llm(agent.provider);
    const r = await this.runOneCase(workspaceId, agent, evalCase, llm, null);

    return {
      case_id: caseId,
      name: evalCase.name,
      pass: r.trace.pass,
      produced_count: readProducedCount(r.trace.actual),
      degraded: readDegraded(r.trace.actual),
      duration_ms: r.durationMs,
      cost_usd: r.costUsd,
      ran_at: r.ranAt,
    };
  }

  /** Every case's LATEST persisted run status for one owner (AC-19 row
   *  icons on load) — see `EvalRepository.latestCaseRunsForOwner`. */
  async caseStatuses(workspaceId: string, ownerKind: EvalOwnerKind, ownerId: string): Promise<EvalCaseStatus[]> {
    return this.container.evalRepo.latestCaseRunsForOwner(workspaceId, ownerKind, ownerId);
  }

  // =========================================================================
  // History, compare, dashboard (AC-13, AC-14, AC-24)
  // =========================================================================

  async history(workspaceId: string, ownerKind: EvalOwnerKind, ownerId: string): Promise<EvalSetRunRecord[]> {
    return this.container.evalRepo.listSetRuns(workspaceId, ownerKind, ownerId);
  }

  /** Compare exactly two set runs — signed metric deltas + cost delta + the
   *  system-prompt diff between the two pinned snapshots (AC-13). Either id
   *  resolving outside the caller's workspace refuses as not-found (AC-24). */
  async compare(workspaceId: string, baseId: string, headId: string): Promise<EvalCompare> {
    const pair = await this.container.evalRepo.getTwoSetRuns(workspaceId, baseId, headId);
    if (!pair) throw new NotFoundError('Eval run not found');
    const { base, head } = pair;

    const delta = metricDelta(
      { recall: head.recall, precision: head.precision, citation_accuracy: head.citation_accuracy },
      { recall: base.recall, precision: base.precision, citation_accuracy: base.citation_accuracy },
    );
    const cost_usd =
      head.cost_usd != null && base.cost_usd != null ? head.cost_usd - base.cost_usd : null;

    return {
      base,
      head,
      delta: { ...delta, cost_usd },
      prompt_diff: { base_prompt: base.system_prompt, head_prompt: head.system_prompt },
    };
  }

  /** Per-agent dashboard aggregate (AC-14, AC-20/AC-21). The repository
   *  computes `current`/`delta`/`trend`/`recent_runs` (SQL-side aggregation,
   *  T5); the regression `alert` text is RECOMPUTED here via the pure
   *  `scorer.regressionOf` (T4) rather than the repository's own local
   *  `describeRegression` duplicate, per the plan's explicit reconciliation
   *  instruction — the repository's copy stays in place only because T5 has
   *  no dependency edge on T4 (see server/insights/INSIGHTS.md) and its own
   *  aggregate math still needs SOME regression text before T7 exists. */
  async dashboard(workspaceId: string, ownerKind: EvalOwnerKind, ownerId: string): Promise<EvalDashboard> {
    const dash = await this.container.evalRepo.dashboardForOwner(workspaceId, ownerKind, ownerId);
    return { ...dash, alert: describeAlert(dash.delta) };
  }

  async dashboardAll(workspaceId: string): Promise<EvalDashboard> {
    const dash = await this.container.evalRepo.dashboardAllAgents(workspaceId);
    return { ...dash, alert: describeAlert(dash.delta) };
  }
}

// ===========================================================================
// Pure helpers
// ===========================================================================

/** AC-4: kind is DERIVED from the finding's own triage state, never chosen
 *  by the caller. An untriaged finding (neither accepted nor dismissed)
 *  cannot produce a case at all. */
function deriveExpectationKind(finding: FindingRow): 'must_find' | 'must_not_flag' {
  if (finding.acceptedAt) return 'must_find';
  if (finding.dismissedAt) return 'must_not_flag';
  throw new ValidationError('Finding is untriaged — cannot derive an eval case type', {
    findingId: finding.id,
  });
}

/** Human-readable + collision-resistant case name (the finding id suffix
 *  guarantees uniqueness against the `(workspace_id, owner_id, name)` UNIQUE
 *  constraint even when two findings share the same title). */
function deriveCaseName(finding: FindingRow): string {
  const stem = finding.title.trim().slice(0, 80) || 'Untitled finding';
  return `${stem} · ${finding.id.slice(0, 8)}`;
}

/** Validates untrusted/hand-authored `expected_output` JSON against
 *  `EvalExpectation` (GAP-4). User-facing writes (case editor, manual create)
 *  and server-derived writes (create-from-finding) both funnel through this
 *  so a malformed payload is always rejected before persist, never
 *  silently stored. */
function parseExpectation(raw: unknown): EvalExpectation {
  const result = EvalExpectation.safeParse(raw);
  if (!result.success) {
    throw new ValidationError('Invalid expected_output — does not match EvalExpectation', {
      issues: result.error.flatten(),
    });
  }
  return result.data;
}

/**
 * AC-17/Rec-D: `input_diff` is "unparseable" when it's empty/blank OR when
 * `parseUnifiedDiff` (which never throws — it degrades to an empty
 * `files: []` on garbage input) yields zero files. `parseUnifiedDiff` is
 * still wrapped in try/catch defensively per the plan's literal wording.
 */
function tryParseDiff(raw: string): UnifiedDiff | null {
  if (!raw || raw.trim().length === 0) return null;
  try {
    const diff = parseUnifiedDiff(raw);
    return diff.files.length > 0 ? diff : null;
  } catch {
    return null;
  }
}

/** Duck-typed check for a postgres-js `PostgresError` unique-violation
 *  (`SQLSTATE 23505`) — avoids importing the `postgres` package's error
 *  class into the application layer just for an `instanceof` check. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/** Assembles an `InsertCaseRunRow` — a small factory to keep the two call
 *  sites (success path, per-case error path) from duplicating the object
 *  shape. */
function buildCaseRunRow(row: InsertCaseRunRow): InsertCaseRunRow {
  return row;
}

/** Best-effort read of the produced-finding count off a per-trace `actual`
 *  payload (`{ produced: Finding[]; ... }`, see `runOneCase`) — mirrors the
 *  client's own `readProducedCount` (EvalsTab.tsx) so `runCase`'s response
 *  matches what the client would compute from the same trace shape. */
function readProducedCount(actual: unknown): number | null {
  if (!actual || typeof actual !== 'object') return null;
  const obj = actual as Record<string, unknown>;
  return Array.isArray(obj.produced) ? obj.produced.length : null;
}

/** Mirrors the client's `readDegraded` (EvalsTab.tsx). */
function readDegraded(actual: unknown): boolean {
  if (!actual || typeof actual !== 'object') return false;
  return (actual as Record<string, unknown>).degraded === true;
}

/**
 * AC-14 — regression warning text, built on the pure `scorer.regressionOf`
 * (T4) rather than the repository's local `describeRegression` (T5). Kept
 * as the SINGLE source of truth for user-facing alert copy; the repository's
 * own copy is left in place only for its own SQL-aggregation call sites
 * (see the `dashboard`/`dashboardAll` doc comment above).
 */
function describeAlert(delta: EvalDashboard['delta']): string | null {
  const regressions = regressionOf({
    recall: delta.recall,
    precision: delta.precision,
    citation_accuracy: delta.citation_accuracy,
  });
  if (regressions.length === 0) return null;
  const worst = [...regressions].sort((a, b) => b.magnitude - a.magnitude)[0]!;
  const pts = Math.round(worst.magnitude * 100);
  const name =
    worst.metric === 'citation_accuracy' ? 'Citation accuracy' : worst.metric === 'recall' ? 'Recall' : 'Precision';
  return `${name} dipped ${pts}pt${pts === 1 ? '' : 's'}`;
}
