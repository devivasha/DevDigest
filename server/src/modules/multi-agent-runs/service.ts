import type { AgentColumn, MultiAgentEstimate, MultiAgentRun, ReviewRunTarget } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewService } from '../reviews/service.js';
import { MultiAgentRunsRepository, type MultiAgentRunRecord } from './repository.js';
import { computeConflicts, type ConflictColumnInput, type ConflictFindingInput } from './conflicts.js';
import { summariseEstimate } from './estimate.js';

/**
 * service.ts — T5 of the multi-agent-review plan. Application layer for
 * `modules/multi-agent-runs/`: orchestrates the repository (T4) + the pure
 * conflict/estimate helpers (T3) + a reused `ReviewService` (Rec 4). No direct
 * DB access — all reads/writes go through `MultiAgentRunsRepository`; no LLM
 * calls.
 */
export class MultiAgentRunsService {
  private repo: MultiAgentRunsRepository;

  constructor(private container: Container) {
    this.repo = new MultiAgentRunsRepository(container.db);
  }

  // ===========================================================================
  // Launch
  // ===========================================================================

  /**
   * Resolve every requested agent workspace-scoped FIRST (a cross-workspace
   * agent id throws NotFoundError, AC-12) — never trust the id list to
   * `ReviewService.runReview` un-checked, since that method resolves the PR's
   * tenancy but not the agents'. Also resolve the PR itself, workspace-scoped,
   * BEFORE `createMultiRun` — a valid-uuid-but-nonexistent or cross-workspace
   * `prId` must throw NotFoundError (404) here, not fall through to
   * `multi_agent_runs.pr_id`'s NOT-NULL FK (which would surface as a raw 500)
   * or leave an orphaned `multi_agent_runs` row before `runReview`'s own
   * (later, redundant) tenancy check. Persist the `multi_agent_runs` row, fan
   * out via the reused `ReviewService.runReview` (Rec 4 — mirrors the existing
   * `POST /pulls/:id/review` route's own instantiation pattern), then stamp
   * the FK on the AWAITED run-id list (Rec 2) before returning — never inside
   * `runReview`'s fire-and-forget background job, so a reload right after the
   * HTTP response always sees the link (AC-11).
   */
  async launch(
    workspaceId: string,
    prId: string,
    agentIds: string[],
  ): Promise<{ id: string; pr_id: string; runs: ReviewRunTarget[] }> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const targets = [];
    for (const agentId of agentIds) {
      const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
      if (!agent) throw new NotFoundError('Agent not found');
      targets.push(agent);
    }

    const multiRunId = await this.repo.createMultiRun(workspaceId, prId);

    const reviewService = new ReviewService(this.container);
    const { runs } = await reviewService.runReview(workspaceId, prId, targets);

    await this.repo.linkRuns(
      multiRunId,
      runs.map((r) => r.run_id),
    );

    return { id: multiRunId, pr_id: prId, runs };
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  /** One multi-agent run by id, workspace-scoped (cross-workspace → NotFound, AC-12). */
  async getRun(workspaceId: string, id: string): Promise<MultiAgentRun> {
    const record = await this.repo.getMultiRun(workspaceId, id);
    if (!record) throw new NotFoundError('Multi-agent run not found');
    return this.assemble(record);
  }

  /** Latest multi-agent run for a PR — the reload-safe results surface (AC-11). */
  async getLatest(workspaceId: string, prId: string): Promise<MultiAgentRun> {
    const record = await this.repo.getLatestForPull(workspaceId, prId);
    if (!record) throw new NotFoundError('No multi-agent run for this pull request');
    return this.assemble(record);
  }

  /**
   * Pre-run per-agent + fan-out summary estimate. Scoped by workspaceId +
   * the given agentIds — no PR row lookup, since the estimate never creates
   * or touches a run and the repo's per-agent query is itself workspace-scoped.
   */
  async estimate(workspaceId: string, agentIds: string[]): Promise<MultiAgentEstimate> {
    const agents = await this.repo.estimate(workspaceId, agentIds);
    return { agents, summary: summariseEstimate(agents) };
  }

  // ===========================================================================
  // Assembly (columns + conflicts + totals)
  // ===========================================================================

  private async assemble(record: MultiAgentRunRecord): Promise<MultiAgentRun> {
    const columns = await this.repo.loadColumns(record.id);
    const conflicts = computeConflicts(await this.toConflictInputs(columns));

    // total_duration_ms = MAX of completed columns' durations (fan-out
    // wall-clock, per the plan's Rec-1 default) — 0 when nothing has
    // completed yet (the contract field is non-nullable).
    const completedDurations = columns
      .filter((c): c is AgentColumn & { duration_ms: number } => c.status === 'done' && c.duration_ms !== null)
      .map((c) => c.duration_ms);
    const totalDurationMs = completedDurations.length > 0 ? Math.max(...completedDurations) : 0;

    // total_cost_usd = SUM of every column's known cost; null (not 0) when no
    // column has priced in yet — mirrors estimate.ts's cold-start convention
    // ("nothing to sum" is not the same as "a genuinely zero cost").
    const knownCosts = columns.filter((c) => c.cost_usd !== null).map((c) => c.cost_usd as number);
    const totalCostUsd = knownCosts.length > 0 ? knownCosts.reduce((sum, c) => sum + c, 0) : null;

    return {
      id: record.id,
      pr_id: record.pr_id,
      pr_number: null,
      ran_at: record.ran_at,
      agent_count: columns.length,
      total_duration_ms: totalDurationMs,
      total_cost_usd: totalCostUsd,
      columns,
      conflicts,
    };
  }

  /**
   * Assemble `computeConflicts`' input from `AgentColumn[]` plus a targeted
   * read of each finding's `end_line`.
   *
   * INTEGRATION NOTE (T3/T4/T5 flag): `AgentColumn.findings`
   * (`AgentColumnFinding` in `@devdigest/shared`) only carries `start_line` —
   * that DTO is shaped for the client read response, not for conflict
   * computation, which needs the full `[start_line, end_line]` range (see
   * `conflicts.ts`'s own doc comment). The repository's
   * `getEndLinesByFindingIds` provides this targeted lookup, keyed off ids
   * `loadColumns` already returned.
   */
  private async toConflictInputs(columns: AgentColumn[]): Promise<ConflictColumnInput[]> {
    const findingIds = columns.flatMap((c) => c.findings.map((f) => f.id));
    const endLineRows = await this.repo.getEndLinesByFindingIds(findingIds);
    const endLineById = new Map(endLineRows.map((row) => [row.id, row.end_line]));

    return columns.map(
      (c): ConflictColumnInput => ({
        agent_id: c.agent_id,
        agent_name: c.agent_name,
        status: c.status,
        findings: c.findings.map(
          (f): ConflictFindingInput => ({
            id: f.id,
            file: f.file,
            start_line: f.start_line,
            // Fallback to start_line only guards a theoretical missing row —
            // every finding referenced by a column was just loaded FROM
            // `findings` by `loadColumns`, so the lookup above always hits.
            end_line: endLineById.get(f.id) ?? f.start_line,
            severity: f.severity,
            title: f.title,
          }),
        ),
      }),
    );
  }
}
