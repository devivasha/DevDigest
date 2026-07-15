/**
 * repository.ts — T4 of the multi-agent-review plan. Infrastructure layer for
 * `modules/multi-agent-runs/`: pure Drizzle data access, zero business logic,
 * zero LLM calls.
 *
 * Owns:
 *  - `createMultiRun` / `linkRuns` — persist a `multi_agent_runs` row and
 *    stamp the Rec-2 FK-linking path (`agent_runs.multi_agent_run_id`) via a
 *    synchronous UPDATE right after `ReviewService.runReview(...)` returns
 *    its run ids (see plan Rec 2 — the `reviews` module stays untouched).
 *  - `getMultiRun` / `getLatestForPull` — workspace-scoped reads of the
 *    `multi_agent_runs` row itself. A cross-workspace id/pr combination
 *    returns `null` (AC-12); the service layer is responsible for turning
 *    `null` into a `NotFoundError`, not this file.
 *  - `loadColumns` — assembles `AgentColumn[]` for one multi-agent run by
 *    joining the linked `agent_runs` rows to their `reviews` + `findings`
 *    (findings hang off `reviews.run_id`, per the existing reviews schema —
 *    there is no direct `findings.run_id`) and to `agents` for name/provider
 *    /model. A still-`running` agent has no `reviews` row yet, so its
 *    findings are `[]` — this is expected, not an error. `agent_runs.error`
 *    (the persisted failure reason) is surfaced directly onto the column —
 *    this is what makes a failed column's reason reload-safe (AC-16), since
 *    a failed run never gets a `reviews` row to hang a summary off of.
 *  - `getEndLinesByFindingIds` — targeted `findings.end_line` lookup by id,
 *    used by `service.ts`'s `toConflictInputs` to enrich the slim
 *    `AgentColumnFinding` shape for conflict computation.
 *  - `estimate` — per-agent AVG(duration_ms)/AVG(cost_usd) over that agent's
 *    most recent 10 COMPLETED (`status = 'done'`) `agent_runs` in the
 *    workspace. Bounded per agent via `ORDER BY ran_at DESC LIMIT 10` before
 *    averaging in JS (no full-table scan, no full-table AVG) — mirrors the
 *    codebase's existing "fetch a bounded/ordered slice, aggregate in JS"
 *    precedent (there is no SQL-native "top-N per group" in the Drizzle
 *    query builder used elsewhere here; see `server/insights/INSIGHTS.md`).
 *
 * `$inferSelect` row types never leave this file — every public method
 * returns either a hand-mapped local DTO (`MultiAgentRunRecord`) or a
 * `@devdigest/shared` contract type (`AgentColumn`, `MultiAgentEstimateAgent`).
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { AgentColumn, AgentColumnFinding, MultiAgentEstimateAgent } from '@devdigest/shared';

/** Bounded window for the estimate query — last N completed runs per agent. */
const ESTIMATE_WINDOW = 10;

/**
 * Repo-internal DTO for a `multi_agent_runs` row — NOT the full `MultiAgentRun`
 * contract (which the service assembles from this + `loadColumns()` +
 * `computeConflicts()` + totals, per the plan's T5 task).
 */
export interface MultiAgentRunRecord {
  id: string;
  workspace_id: string;
  pr_id: string;
  ran_at: string;
}

export class MultiAgentRunsRepository {
  constructor(private db: Db) {}

  /** Insert a new `multi_agent_runs` row (workspace + PR scoped). Returns its id. */
  async createMultiRun(workspaceId: string, prId: string): Promise<string> {
    const [row] = await this.db
      .insert(t.multiAgentRuns)
      .values({ workspaceId, prId })
      .returning({ id: t.multiAgentRuns.id });
    if (!row) throw new Error('multi_agent_runs insert returned no row');
    return row.id;
  }

  /**
   * Rec-2 stamping path: `UPDATE agent_runs SET multi_agent_run_id = $1 WHERE
   * id = ANY($2)`. Callers must invoke this synchronously on the AWAITED list
   * of run ids returned by `ReviewService.runReview(...)` — never from inside
   * its fire-and-forget background job — so every linked run carries the FK
   * before the launch HTTP response is sent (AC-11 reload-safety). No-op on
   * an empty `runIds` array.
   */
  async linkRuns(multiRunId: string, runIds: string[]): Promise<void> {
    if (runIds.length === 0) return;
    await this.db
      .update(t.agentRuns)
      .set({ multiAgentRunId: multiRunId })
      .where(inArray(t.agentRuns.id, runIds));
  }

  /** Workspace-scoped lookup by id. Cross-workspace id → `null` (AC-12). */
  async getMultiRun(workspaceId: string, id: string): Promise<MultiAgentRunRecord | null> {
    const [row] = await this.db
      .select()
      .from(t.multiAgentRuns)
      .where(and(eq(t.multiAgentRuns.id, id), eq(t.multiAgentRuns.workspaceId, workspaceId)));
    return row ? this.toRecord(row) : null;
  }

  /** Most recent `multi_agent_runs` row for a PR, workspace-scoped. Cross-workspace → `null`. */
  async getLatestForPull(workspaceId: string, prId: string): Promise<MultiAgentRunRecord | null> {
    const [row] = await this.db
      .select()
      .from(t.multiAgentRuns)
      .where(and(eq(t.multiAgentRuns.prId, prId), eq(t.multiAgentRuns.workspaceId, workspaceId)))
      .orderBy(desc(t.multiAgentRuns.ranAt))
      .limit(1);
    return row ? this.toRecord(row) : null;
  }

  private toRecord(row: typeof t.multiAgentRuns.$inferSelect): MultiAgentRunRecord {
    return {
      id: row.id,
      workspace_id: row.workspaceId,
      pr_id: row.prId,
      ran_at: row.ranAt.toISOString(),
    };
  }

  /**
   * One `AgentColumn` per `agent_runs` row linked to `multiRunId` (fanned-out
   * runs). Findings are loaded via `reviews.run_id` (findings hang off
   * `review_id`, and a review row's `run_id` links it back to the run — the
   * schema has no direct `findings.run_id`). Returns `[]` for a run with no
   * `multi_agent_run_id`-linked rows (e.g. malformed/stale id) — callers
   * distinguish "run exists but has no columns yet" from "run doesn't exist"
   * via `getMultiRun`/`getLatestForPull`, not this method.
   */
  async loadColumns(multiRunId: string): Promise<AgentColumn[]> {
    const runs = await this.db
      .select({ run: t.agentRuns, agentName: t.agents.name })
      .from(t.agentRuns)
      .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
      .where(eq(t.agentRuns.multiAgentRunId, multiRunId));

    if (runs.length === 0) return [];

    const runIds = runs.map((r) => r.run.id);
    const reviewRows = await this.db
      .select({
        id: t.reviews.id,
        runId: t.reviews.runId,
        verdict: t.reviews.verdict,
        summary: t.reviews.summary,
      })
      .from(t.reviews)
      .where(inArray(t.reviews.runId, runIds));
    // A run can only own one review row in this flow; keyed by run_id.
    const reviewByRunId = new Map(reviewRows.map((r) => [r.runId as string, r]));

    const reviewIds = reviewRows.map((r) => r.id);
    const findingRows = reviewIds.length
      ? await this.db.select().from(t.findings).where(inArray(t.findings.reviewId, reviewIds))
      : [];
    const findingsByReviewId = new Map<string, AgentColumnFinding[]>();
    for (const f of findingRows) {
      const list = findingsByReviewId.get(f.reviewId) ?? [];
      list.push({
        id: f.id,
        severity: f.severity as AgentColumnFinding['severity'],
        category: f.category,
        title: f.title,
        file: f.file,
        start_line: f.startLine,
        kind: f.kind ?? null,
      });
      findingsByReviewId.set(f.reviewId, list);
    }

    return runs.map(({ run, agentName }): AgentColumn => {
      const review = reviewByRunId.get(run.id);
      const findings = review ? (findingsByReviewId.get(review.id) ?? []) : [];
      return {
        run_id: run.id,
        // Multi-agent launches always resolve a concrete agent id before
        // creating the run (T5's `launch`) — `?? ''` only guards the
        // theoretical case of an orphaned (agent later deleted) run.
        agent_id: run.agentId ?? '',
        agent_name: agentName ?? 'Unknown agent',
        provider: run.provider,
        model: run.model,
        status: mapRunStatus(run.status),
        verdict: review?.verdict ?? null,
        score: run.score,
        summary: review?.summary ?? null,
        duration_ms: run.durationMs,
        cost_usd: run.costUsd,
        // Persisted failure reason (AC-16 reload-safety) — read straight off
        // `agent_runs.error`, independent of whether a `reviews` row exists.
        // A failed run never gets a `reviews` row, so this is the ONLY place
        // the reason survives a page reload (no live SSE stream).
        error: run.error,
        findings,
      };
    });
  }

  /**
   * Targeted lookup of persisted `findings.end_line` by id. Used by the
   * service layer to enrich the slim, `start_line`-only `AgentColumnFinding`
   * read-response shape with the full `[start_line, end_line]` range
   * `computeConflicts` needs (see `service.ts`'s `toConflictInputs`).
   * Returns only rows that exist for the given ids — every id passed in by
   * `toConflictInputs` was just loaded FROM `findings` by `loadColumns`, so
   * in practice every id resolves.
   */
  async getEndLinesByFindingIds(findingIds: string[]): Promise<Array<{ id: string; end_line: number }>> {
    if (findingIds.length === 0) return [];
    const rows = await this.db
      .select({ id: t.findings.id, endLine: t.findings.endLine })
      .from(t.findings)
      .where(inArray(t.findings.id, findingIds));
    return rows.map((r) => ({ id: r.id, end_line: r.endLine }));
  }

  /**
   * Per-agent time/cost estimate from that agent's recent completed run
   * history in the workspace. One bounded query per agent
   * (`WHERE workspace_id AND agent_id AND status = 'done' ORDER BY ran_at
   * DESC LIMIT 10`) — never an unbounded/full-table AVG. An agent with zero
   * completed runs (cold start) gets `null`/`null` — callers (T3's
   * `summariseEstimate`) exclude these from the launch-summary total.
   */
  async estimate(workspaceId: string, agentIds: string[]): Promise<MultiAgentEstimateAgent[]> {
    const results: MultiAgentEstimateAgent[] = [];
    for (const agentId of agentIds) {
      const recentRuns = await this.db
        .select({ durationMs: t.agentRuns.durationMs, costUsd: t.agentRuns.costUsd })
        .from(t.agentRuns)
        .where(
          and(
            eq(t.agentRuns.workspaceId, workspaceId),
            eq(t.agentRuns.agentId, agentId),
            eq(t.agentRuns.status, 'done'),
          ),
        )
        .orderBy(desc(t.agentRuns.ranAt))
        .limit(ESTIMATE_WINDOW);

      const avgDuration = average(recentRuns.map((r) => r.durationMs));
      results.push({
        agent_id: agentId,
        // MultiAgentEstimateAgent.est_duration_ms is `number.int()` — round
        // the mean (a real ms count is always an integer; the average of
        // integers is not).
        est_duration_ms: avgDuration === null ? null : Math.round(avgDuration),
        est_cost_usd: average(recentRuns.map((r) => r.costUsd)),
      });
    }
    return results;
  }
}

/**
 * `agent_runs.status` -> `AgentColumn.status`. `null`/`'running'` -> running
 * (a fresh row starts `status: 'running'`, per `run.repo.ts`'s
 * `createAgentRun`); `'done'` -> done; anything else (`'failed'`,
 * `'cancelled'`) -> failed — the `AgentColumn` contract has no `'cancelled'`
 * member, and a cancelled column is display-equivalent to a failed one (does
 * not block sibling columns, AC-16).
 */
function mapRunStatus(status: string | null): AgentColumn['status'] {
  if (status === 'done') return 'done';
  if (status === null || status === 'running') return 'running';
  return 'failed';
}

/** Mean of the non-null values, or `null` if the list is empty/all-null. */
function average(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length === 0) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return sum / nums.length;
}
