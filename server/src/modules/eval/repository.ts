import { and, count, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  EvalCase,
  EvalCaseInput,
  EvalCaseStatus,
  EvalDashboard,
  EvalOwnerKind,
  EvalRunRecord,
  EvalSetRunRecord,
  EvalTrendPoint,
} from '@devdigest/shared';

/**
 * T5 — eval data-access. Owns `eval_cases`, `eval_set_runs`, and `eval_runs`.
 *
 * Every method is `workspaceId`-scoped (AC-24). Per cross-model review finding
 * #1 (structural tenancy), every `eval_runs` query filters
 * `eq(t.evalRuns.workspaceId, workspaceId)` DIRECTLY, in addition to any join
 * through `set_run_id` — never rely on the parent set-run join alone to prove
 * tenancy. `eval_cases` / `eval_set_runs` queries filter their own
 * `workspace_id` column the same way.
 *
 * Drizzle `$inferSelect`/`$inferInsert` types stay inside this file — every
 * public method takes/returns the shared DTO types from `@devdigest/shared`.
 */

// ---- row types (kept local — never exported) -------------------------------

type EvalCaseRow = typeof t.evalCases.$inferSelect;
type EvalSetRunRow = typeof t.evalSetRuns.$inferSelect;
type EvalRunRow = typeof t.evalRuns.$inferSelect;

// ---- input shapes for the run-insert methods --------------------------------

/** Row to snapshot when a set run starts (before any per-case result exists). */
export interface InsertSetRunRow {
  ownerKind: EvalOwnerKind;
  ownerId: string;
  agentVersion: number | null;
  systemPrompt: string | null;
  model: string | null;
}

/** Aggregate metrics written back onto the set-run row once every case has
 *  run and been pooled (`scorer.poolSetMetrics` in the service layer). */
export interface SetRunAggregatePatch {
  recall: number;
  precision: number;
  citationAccuracy: number | null;
  tracesPassed: number;
  tracesTotal: number;
  durationMs: number | null;
  costUsd: number | null;
  underMin: boolean;
}

/** A single case's scored run result, persisted under a parent set run. */
export interface InsertCaseRunRow {
  caseId: string;
  workspaceId: string;
  setRunId: string | null;
  agentVersion: number | null;
  actualOutput: unknown;
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number | null;
  costUsd: number | null;
}

/** Patchable fields on a manually-edited case. Owner cannot be reassigned. */
export type UpdateEvalCaseInput = Partial<
  Pick<EvalCaseInput, 'name' | 'input_diff' | 'input_files' | 'input_meta' | 'expected_output' | 'notes'>
>;

// Number of most-recent set runs considered for a single-owner dashboard
// trend/recent-runs window, and for the all-agents "recent runs" table.
const DASHBOARD_WINDOW = 20;
const RECENT_RUNS_LIMIT = 10;

export class EvalRepository {
  constructor(private db: Db) {}

  // ---- mappers (Drizzle $infer* stays inside this file) ---------------------

  private toCaseDomain(row: EvalCaseRow): EvalCase {
    return {
      id: row.id,
      owner_kind: row.ownerKind as EvalOwnerKind,
      owner_id: row.ownerId,
      name: row.name,
      input_diff: row.inputDiff ?? '',
      input_files: row.inputFiles,
      input_meta: row.inputMeta,
      expected_output: row.expectedOutput,
      notes: row.notes,
    };
  }

  private toSetRunDomain(row: EvalSetRunRow): EvalSetRunRecord {
    return {
      id: row.id,
      owner_kind: row.ownerKind as EvalOwnerKind,
      owner_id: row.ownerId,
      ran_at: row.ranAt.toISOString(),
      version: row.agentVersion ?? 0,
      system_prompt: row.systemPrompt ?? '',
      model: row.model ?? '',
      recall: row.recall ?? 0,
      precision: row.precision ?? 0,
      citation_accuracy: row.citationAccuracy,
      traces_passed: row.tracesPassed ?? 0,
      traces_total: row.tracesTotal ?? 0,
      duration_ms: row.durationMs,
      cost_usd: row.costUsd,
      under_min: row.underMin ?? false,
    };
  }

  private toCaseRunDomain(row: EvalRunRow, caseName: string | null = null): EvalRunRecord {
    return {
      id: row.id,
      case_id: row.caseId,
      case_name: caseName,
      ran_at: row.ranAt.toISOString(),
      actual_output: row.actualOutput,
      pass: row.pass,
      recall: row.recall,
      precision: row.precision,
      citation_accuracy: row.citationAccuracy,
      duration_ms: row.durationMs,
      cost_usd: row.costUsd,
      set_run_id: row.setRunId,
      version: row.agentVersion,
    };
  }

  private toTrendPoint(row: EvalSetRunRow): EvalTrendPoint {
    const tracesTotal = row.tracesTotal ?? 0;
    const tracesPassed = row.tracesPassed ?? 0;
    return {
      ran_at: row.ranAt.toISOString(),
      recall: row.recall ?? 0,
      precision: row.precision ?? 0,
      citation_accuracy: row.citationAccuracy ?? 0,
      pass_rate: tracesTotal > 0 ? tracesPassed / tracesTotal : 1,
      cost_usd: row.costUsd,
    };
  }

  // ---- case CRUD --------------------------------------------------------

  async listCasesByOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalCase[]> {
    const rows = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
    return rows.map((r) => this.toCaseDomain(r));
  }

  async getCase(workspaceId: string, caseId: string): Promise<EvalCase | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)));
    return row ? this.toCaseDomain(row) : undefined;
  }

  /** Insert a new case. Relies on the UNIQUE `(workspace_id, owner_id, name)`
   *  index (`eval_cases_owner_name_uq`) to reject a duplicate name for the
   *  same owner — callers should treat a unique-violation from Postgres as a
   *  validation error, not swallow it here (this repository never
   *  `onConflictDoNothing`s a real user-facing create; that behavior is
   *  reserved for the idempotent seed). */
  async createCase(workspaceId: string, input: EvalCaseInput): Promise<EvalCase> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: input.owner_kind,
        ownerId: input.owner_id,
        name: input.name,
        inputDiff: input.input_diff,
        inputFiles: (input.input_files as object | undefined) ?? null,
        inputMeta: (input.input_meta as object | undefined) ?? null,
        expectedOutput: input.expected_output as object,
        notes: input.notes ?? null,
      })
      .returning();
    return this.toCaseDomain(row!);
  }

  async updateCase(
    workspaceId: string,
    caseId: string,
    patch: UpdateEvalCaseInput,
  ): Promise<EvalCase | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.input_diff !== undefined ? { inputDiff: patch.input_diff } : {}),
        ...(patch.input_files !== undefined
          ? { inputFiles: patch.input_files as object | null }
          : {}),
        ...(patch.input_meta !== undefined ? { inputMeta: patch.input_meta as object | null } : {}),
        ...(patch.expected_output !== undefined
          ? { expectedOutput: patch.expected_output as object }
          : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes ?? null } : {}),
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .returning();
    return row ? this.toCaseDomain(row) : undefined;
  }

  async deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  // ---- runs ---------------------------------------------------------------

  /** Snapshot a new set-run row (agent version + exact system prompt + model,
   *  AC-12) before any case has run, so per-case rows have a `set_run_id` to
   *  reference. Aggregate metrics are filled in later via
   *  `updateSetRunAggregate` once every case has been scored. Returns the
   *  new row's id. */
  async insertSetRun(workspaceId: string, row: InsertSetRunRow): Promise<string> {
    const [inserted] = await this.db
      .insert(t.evalSetRuns)
      .values({
        workspaceId,
        ownerKind: row.ownerKind,
        ownerId: row.ownerId,
        agentVersion: row.agentVersion,
        systemPrompt: row.systemPrompt,
        model: row.model,
      })
      .returning({ id: t.evalSetRuns.id });
    return inserted!.id;
  }

  /** Write the pooled aggregate (recall/precision/citation_accuracy,
   *  traces_passed/total, duration, cost, under_min) onto a previously
   *  inserted set-run row, scoped to the caller's workspace (AC-24). */
  async updateSetRunAggregate(
    workspaceId: string,
    setRunId: string,
    patch: SetRunAggregatePatch,
  ): Promise<EvalSetRunRecord | undefined> {
    const [row] = await this.db
      .update(t.evalSetRuns)
      .set({
        recall: patch.recall,
        precision: patch.precision,
        citationAccuracy: patch.citationAccuracy,
        tracesPassed: patch.tracesPassed,
        tracesTotal: patch.tracesTotal,
        durationMs: patch.durationMs,
        costUsd: patch.costUsd,
        underMin: patch.underMin,
      })
      .where(and(eq(t.evalSetRuns.workspaceId, workspaceId), eq(t.evalSetRuns.id, setRunId)))
      .returning();
    return row ? this.toSetRunDomain(row) : undefined;
  }

  /** Persist one case's scored run. `workspace_id` is REQUIRED on every row
   *  (structural tenancy, finding #1) — callers must copy it from the parent
   *  set-run, never trust an ambient value. `caseName` is denormalized onto
   *  the returned DTO only (not stored) for convenience — pass it when the
   *  caller already has the case loaded to avoid an extra round-trip. */
  async insertCaseRun(row: InsertCaseRunRow, caseName: string | null = null): Promise<EvalRunRecord> {
    const [inserted] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId: row.caseId,
        workspaceId: row.workspaceId,
        setRunId: row.setRunId,
        agentVersion: row.agentVersion,
        actualOutput: (row.actualOutput as object | undefined) ?? null,
        pass: row.pass,
        recall: row.recall,
        precision: row.precision,
        citationAccuracy: row.citationAccuracy,
        durationMs: row.durationMs,
        costUsd: row.costUsd,
      })
      .returning();
    return this.toCaseRunDomain(inserted!, caseName);
  }

  /** Run history for an owner, newest-first. */
  async listSetRuns(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
    limit = RECENT_RUNS_LIMIT,
  ): Promise<EvalSetRunRecord[]> {
    const rows = await this.db
      .select()
      .from(t.evalSetRuns)
      .where(
        and(
          eq(t.evalSetRuns.workspaceId, workspaceId),
          eq(t.evalSetRuns.ownerKind, ownerKind),
          eq(t.evalSetRuns.ownerId, ownerId),
          // Only COMPLETED set runs — an interrupted run (server reload,
          // dropped connection) leaves a row whose aggregate was never
          // written (traces_total NULL). Excluding them keeps history,
          // trend, and "current" from showing half-written/empty runs.
          isNotNull(t.evalSetRuns.tracesTotal),
        ),
      )
      .orderBy(desc(t.evalSetRuns.ranAt))
      .limit(limit);
    return rows.map((r) => this.toSetRunDomain(r));
  }

  async getSetRun(workspaceId: string, setRunId: string): Promise<EvalSetRunRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalSetRuns)
      .where(and(eq(t.evalSetRuns.workspaceId, workspaceId), eq(t.evalSetRuns.id, setRunId)));
    return row ? this.toSetRunDomain(row) : undefined;
  }

  /** Load exactly two set runs (for compare, AC-13). Returns `undefined` if
   *  either id doesn't resolve within the caller's workspace — a cross-tenant
   *  compare target is refused, not partially served. */
  async getTwoSetRuns(
    workspaceId: string,
    baseId: string,
    headId: string,
  ): Promise<{ base: EvalSetRunRecord; head: EvalSetRunRecord } | undefined> {
    const rows = await this.db
      .select()
      .from(t.evalSetRuns)
      .where(
        and(eq(t.evalSetRuns.workspaceId, workspaceId), inArray(t.evalSetRuns.id, [baseId, headId])),
      );
    const base = rows.find((r) => r.id === baseId);
    const head = rows.find((r) => r.id === headId);
    if (!base || !head) return undefined;
    return { base: this.toSetRunDomain(base), head: this.toSetRunDomain(head) };
  }

  /** Every per-case run row belonging to one set run. Filters `eval_runs`
   *  by BOTH `workspace_id` directly AND `set_run_id` (defense-in-depth,
   *  finding #1) — a set-run id from another workspace returns nothing even
   *  if it happens to match a real row, because the workspace filter runs
   *  first and independently. */
  async listCaseRunsForSet(workspaceId: string, setRunId: string): Promise<EvalRunRecord[]> {
    const rows = await this.db
      .select({ run: t.evalRuns, caseName: t.evalCases.name })
      .from(t.evalRuns)
      .leftJoin(t.evalCases, eq(t.evalCases.id, t.evalRuns.caseId))
      .where(and(eq(t.evalRuns.workspaceId, workspaceId), eq(t.evalRuns.setRunId, setRunId)));
    return rows.map(({ run, caseName }) => this.toCaseRunDomain(run, caseName ?? null));
  }

  /**
   * Latest persisted run for EVERY case belonging to an owner (one row per
   * case, not per run) — powers the Evals tab's per-case pass/fail icon on
   * page load. `eval_runs` is filtered by `workspace_id` DIRECTLY
   * (finding #1) in addition to the join through `eval_cases`'s owner
   * columns — never rely on the join alone to prove tenancy. Cases with zero
   * runs are simply ABSENT from the result; the client renders those as
   * "never run".
   */
  async latestCaseRunsForOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalCaseStatus[]> {
    const rows = await this.db
      .select({ run: t.evalRuns, caseName: t.evalCases.name })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalCases.id, t.evalRuns.caseId))
      .where(
        and(
          eq(t.evalRuns.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      )
      .orderBy(desc(t.evalRuns.ranAt));

    const seen = new Set<string>();
    const result: EvalCaseStatus[] = [];
    for (const { run, caseName } of rows) {
      if (seen.has(run.caseId)) continue;
      seen.add(run.caseId);
      result.push(this.toCaseStatusDomain(run, caseName));
    }
    return result;
  }

  private toCaseStatusDomain(row: EvalRunRow, caseName: string): EvalCaseStatus {
    const actual =
      row.actualOutput && typeof row.actualOutput === 'object'
        ? (row.actualOutput as Record<string, unknown>)
        : null;
    return {
      case_id: row.caseId,
      name: caseName,
      pass: row.pass ?? false,
      produced_count: actual && Array.isArray(actual.produced) ? actual.produced.length : null,
      degraded: actual?.degraded === true,
      duration_ms: row.durationMs,
      cost_usd: row.costUsd,
      ran_at: row.ranAt.toISOString(),
    };
  }

  // ---- dashboard ------------------------------------------------------------

  /** Per-owner dashboard aggregate: current metrics (latest set run),
   *  signed delta vs the previous set run, a chronological trend window,
   *  the recent-runs table, and a regression alert (AC-14) when any of
   *  recall/precision/citation_accuracy dipped vs the previous run. */
  async dashboardForOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalDashboard> {
    const [casesTotal, runs] = await Promise.all([
      this.countCases(workspaceId, ownerKind, ownerId),
      this.db
        .select()
        .from(t.evalSetRuns)
        .where(
          and(
            eq(t.evalSetRuns.workspaceId, workspaceId),
            eq(t.evalSetRuns.ownerKind, ownerKind),
            eq(t.evalSetRuns.ownerId, ownerId),
            // Completed runs only (see listSetRuns) — an incomplete run must
            // not become the dashboard's "current" with coalesced fake metrics.
            isNotNull(t.evalSetRuns.tracesTotal),
          ),
        )
        .orderBy(desc(t.evalSetRuns.ranAt))
        .limit(DASHBOARD_WINDOW),
    ]);

    const latest = runs[0];
    const previous = runs[1];
    const current = this.currentFrom(latest);
    const delta = this.deltaFrom(latest, previous);
    const trend = [...runs].reverse().map((r) => this.toTrendPoint(r));
    const recentRuns = runs.slice(0, RECENT_RUNS_LIMIT).map((r) => this.toSetRunDomain(r));

    return {
      owner_kind: ownerKind,
      owner_id: ownerId,
      cases_total: casesTotal,
      current,
      delta,
      trend,
      recent_runs: recentRuns,
      alert: describeRegression(delta),
      owner_case_counts: { [ownerId]: casesTotal },
    };
  }

  /** Workspace-wide dashboard across every owner (agents). "Current"/"delta"
   *  pool each owner's own latest-vs-previous set run (weighted by
   *  traces_total) rather than any single run, since there is no one
   *  "current" run across multiple agents. "Recent runs" and the trend
   *  window are the most recent set runs in the whole workspace,
   *  irrespective of owner — matching the "Recent eval runs · all agents"
   *  table (AC-20). */
  async dashboardAllAgents(workspaceId: string): Promise<EvalDashboard> {
    const [casesTotal, ownerCaseCounts, runs] = await Promise.all([
      this.countAllCases(workspaceId),
      this.ownerCaseCounts(workspaceId),
      this.db
        .select()
        .from(t.evalSetRuns)
        .where(
          and(
            eq(t.evalSetRuns.workspaceId, workspaceId),
            // Completed runs only (see listSetRuns).
            isNotNull(t.evalSetRuns.tracesTotal),
          ),
        )
        .orderBy(desc(t.evalSetRuns.ranAt)),
    ]);

    // Group by owner (JS-side — the table is small per workspace) to find
    // each owner's latest and second-latest run for pooled current/delta.
    const byOwner = new Map<string, EvalSetRunRow[]>();
    for (const row of runs) {
      const key = `${row.ownerKind}:${row.ownerId}`;
      const list = byOwner.get(key) ?? [];
      list.push(row);
      byOwner.set(key, list);
    }

    const latests: EvalSetRunRow[] = [];
    const deltas: EvalDashboard['delta'][] = [];
    let weightForDelta = 0;
    for (const list of byOwner.values()) {
      const [latest, previous] = list; // already ordered desc within the workspace-wide query
      if (!latest) continue;
      latests.push(latest);
      if (previous) {
        deltas.push(this.deltaFrom(latest, previous));
        weightForDelta += latest.tracesTotal ?? 0;
      }
    }

    const current = this.poolCurrent(latests);
    const delta = this.poolDeltas(deltas, weightForDelta > 0);
    const windowed = runs.slice(0, DASHBOARD_WINDOW);
    const trend = [...windowed].reverse().map((r) => this.toTrendPoint(r));
    const recentRuns = runs.slice(0, RECENT_RUNS_LIMIT).map((r) => this.toSetRunDomain(r));

    return {
      owner_kind: null,
      owner_id: null,
      cases_total: casesTotal,
      current,
      delta,
      trend,
      recent_runs: recentRuns,
      alert: describeRegression(delta),
      owner_case_counts: ownerCaseCounts,
    };
  }

  // ---- dashboard helpers ------------------------------------------------

  private async countCases(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<number> {
    const rows = await this.db
      .select({ id: t.evalCases.id })
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
    return rows.length;
  }

  private async countAllCases(workspaceId: string): Promise<number> {
    const rows = await this.db
      .select({ id: t.evalCases.id })
      .from(t.evalCases)
      .where(eq(t.evalCases.workspaceId, workspaceId));
    return rows.length;
  }

  /** Map of agent owner_id → number of eval cases that owner has, scoped to
   *  `workspace_id` directly (tenancy) — powers the all-agents dashboard's
   *  ability to hide agents with no eval set at all (never-run/stale-model
   *  cards). Only `owner_kind = 'agent'` rows are counted; skill-owned cases
   *  (if any) are out of scope for this per-agent map. */
  private async ownerCaseCounts(workspaceId: string): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ ownerId: t.evalCases.ownerId, n: count(t.evalCases.id) })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, 'agent')))
      .groupBy(t.evalCases.ownerId);
    return Object.fromEntries(rows.map((r) => [r.ownerId, r.n]));
  }

  private currentFrom(latest: EvalSetRunRow | undefined): EvalDashboard['current'] {
    return {
      recall: latest?.recall ?? 1,
      precision: latest?.precision ?? 1,
      citation_accuracy: latest?.citationAccuracy ?? 1,
      traces_passed: latest?.tracesPassed ?? 0,
      traces_total: latest?.tracesTotal ?? 0,
      cost_usd: latest?.costUsd ?? null,
    };
  }

  private deltaFrom(
    latest: EvalSetRunRow | undefined,
    previous: EvalSetRunRow | undefined,
  ): EvalDashboard['delta'] {
    if (!latest || !previous) {
      return { recall: 0, precision: 0, citation_accuracy: 0 };
    }
    const citationDelta =
      latest.citationAccuracy !== null && previous.citationAccuracy !== null
        ? latest.citationAccuracy - previous.citationAccuracy
        : 0;
    return {
      recall: (latest.recall ?? 0) - (previous.recall ?? 0),
      precision: (latest.precision ?? 0) - (previous.precision ?? 0),
      citation_accuracy: citationDelta,
    };
  }

  /** Weighted-average current metrics across each owner's latest run,
   *  weighted by that run's `traces_total` (so a bigger case set counts
   *  more). Falls back to a plain average when no run reports traces. */
  private poolCurrent(latests: EvalSetRunRow[]): EvalDashboard['current'] {
    if (latests.length === 0) {
      return { recall: 1, precision: 1, citation_accuracy: 1, traces_passed: 0, traces_total: 0, cost_usd: null };
    }
    const totalWeight = latests.reduce((sum, r) => sum + (r.tracesTotal ?? 0), 0);
    const weight = (r: EvalSetRunRow) => (totalWeight > 0 ? (r.tracesTotal ?? 0) : 1);
    const denom = totalWeight > 0 ? totalWeight : latests.length;
    const recall = latests.reduce((sum, r) => sum + (r.recall ?? 0) * weight(r), 0) / denom;
    const precision = latests.reduce((sum, r) => sum + (r.precision ?? 0) * weight(r), 0) / denom;
    const citationRuns = latests.filter((r) => r.citationAccuracy !== null);
    const citationAccuracy =
      citationRuns.length > 0
        ? citationRuns.reduce((sum, r) => sum + (r.citationAccuracy ?? 0), 0) / citationRuns.length
        : 1;
    const tracesPassed = latests.reduce((sum, r) => sum + (r.tracesPassed ?? 0), 0);
    const tracesTotal = latests.reduce((sum, r) => sum + (r.tracesTotal ?? 0), 0);
    const costs = latests.filter((r) => r.costUsd !== null);
    const costUsd = costs.length > 0 ? costs.reduce((sum, r) => sum + (r.costUsd ?? 0), 0) : null;
    return {
      recall,
      precision,
      citation_accuracy: citationAccuracy,
      traces_passed: tracesPassed,
      traces_total: tracesTotal,
      cost_usd: costUsd,
    };
  }

  /** Plain average of each owner's own latest-vs-previous delta. */
  private poolDeltas(deltas: EvalDashboard['delta'][], hasAny: boolean): EvalDashboard['delta'] {
    if (!hasAny || deltas.length === 0) {
      return { recall: 0, precision: 0, citation_accuracy: 0 };
    }
    const n = deltas.length;
    return {
      recall: deltas.reduce((sum, d) => sum + d.recall, 0) / n,
      precision: deltas.reduce((sum, d) => sum + d.precision, 0) / n,
      citation_accuracy: deltas.reduce((sum, d) => sum + d.citation_accuracy, 0) / n,
    };
  }
}

/** AC-14 — a regression warning naming the single most-dipped metric and its
 *  magnitude in points (e.g. "Precision dipped 2pts"), or `null` when no
 *  metric fell. Self-contained here (no dependency on the pure scorer, T4,
 *  since the repository has no dependency edge on it per the plan's
 *  concurrency waves) — the service layer (T7) may recompute/refine this via
 *  `scorer.regressionOf` when richer context is available. */
function describeRegression(delta: EvalDashboard['delta']): string | null {
  const dips: Array<{ name: string; magnitude: number }> = [];
  if (delta.recall < 0) dips.push({ name: 'Recall', magnitude: -delta.recall });
  if (delta.precision < 0) dips.push({ name: 'Precision', magnitude: -delta.precision });
  if (delta.citation_accuracy !== null && delta.citation_accuracy < 0) {
    dips.push({ name: 'Citation accuracy', magnitude: -delta.citation_accuracy });
  }
  if (dips.length === 0) return null;
  dips.sort((a, b) => b.magnitude - a.magnitude);
  const worst = dips[0]!;
  const pts = Math.round(worst.magnitude * 100);
  return `${worst.name} dipped ${pts}pt${pts === 1 ? '' : 's'}`;
}
