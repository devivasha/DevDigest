import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiInstallation, CiResultArtifact, CiRun, CiTarget } from '@devdigest/shared';
import {
  CI_INSTALLATION_STATUS_RUN_MULTIPLIER,
  CI_RUN_HISTORY_LIMIT,
} from './constants.js';

/**
 * T4 — ci data-access. Owns `ci_installations` and `ci_runs`, plus the
 * dual-write into `agent_runs (source='ci')` on ingest.
 *
 * Neither `ci_installations` nor `ci_runs` carries a `workspace_id` column
 * (unlike most domain tables) — every workspace-scoped read joins through
 * `ci_installations.agent_id -> agents.workspace_id`. Agent-scoped reads
 * (`listAgentInstallations` / `listAgentCiRuns`) intentionally take only an
 * `agentId` — callers (the `ci` service, routes under `/agents/:id/...`) are
 * responsible for having already verified that agent belongs to the caller's
 * workspace before invoking these; this repository does not re-derive that
 * here (mirrors the plan's literal method signatures).
 *
 * Drizzle `$inferSelect`/`$inferInsert` types stay inside this file — every
 * public method takes/returns the shared DTO types from `@devdigest/shared`
 * (or a local, non-Drizzle interface for internals such as the ingest secret
 * hash that must never leave this layer via the public `CiInstallation` DTO).
 */

// ---- row types (kept local — never exported) -------------------------------

type CiInstallationRow = typeof t.ciInstallations.$inferSelect;
type CiRunRow = typeof t.ciRuns.$inferSelect;

// ---- input / internal shapes -------------------------------------------------

/** Input to `insertInstallation` — snapshots the agent's `version` (D5) and
 *  the SHA-256 hash of the freshly issued ingest secret (D4) onto the row.
 *  The plaintext secret itself is never persisted or handled here. */
export interface InsertInstallationInput {
  agentId: string;
  repo: string;
  targetType: CiTarget;
  ingestSecretHash: string;
  version: number | null;
}

/**
 * Installation row INCLUDING the sensitive `ingestSecretHash` — used for
 * ingest auth (constant-time hash comparison, done by the service) and to
 * scope ingest writes to the right agent/installation. Never map this onto
 * the public `CiInstallation` DTO, which omits the hash entirely.
 */
export interface CiInstallationRecord {
  id: string;
  agentId: string;
  repo: string;
  targetType: CiTarget;
  installedAt: string;
  ingestSecretHash: string | null;
  version: number | null;
}

/**
 * One artifact to ingest, paired with the EXPLICIT `ranAt` timestamp the
 * caller (service) resolved for it. `CiResultArtifact` itself carries no
 * timestamp field, and both `agent_runs.ran_at` / `ci_runs.ran_at` default to
 * `now()` — if the repository let that default apply, a replayed ingest call
 * would get a fresh `now()` on every retry and the
 * `(ci_installation_id, pr_number, ran_at)` idempotency key would never
 * collide. Callers MUST resolve a stable `ranAt` per artifact (e.g. from the
 * CI job's start time) before calling `ingestResults`.
 */
export interface CiIngestArtifact {
  artifact: CiResultArtifact;
  ranAt: Date;
}

export class CiRepository {
  constructor(private db: Db) {}

  // ---- mappers (Drizzle $infer* stays inside this file) ---------------------

  /** `status` is the DERIVED status of the installation's most recent CI run
   *  (AC-18) — resolved by the caller (see `listAgentInstallations`) since it
   *  requires a join against `ci_runs`; `null` when the installation has no
   *  runs yet (e.g. right after `insertInstallation`). */
  private toInstallationDomain(row: CiInstallationRow, status: string | null = null): CiInstallation {
    return {
      id: row.id,
      agent_id: row.agentId,
      repo: row.repo,
      target_type: row.targetType as CiTarget,
      installed_at: row.installedAt.toISOString(),
      version: row.version,
      status,
    };
  }

  /** Applies the same `findings_count === 0 -> 'no_findings'` mapping
   *  `toRunDomain` uses at read time, so the installation's derived `status`
   *  always agrees with what the run itself would report (AC-17/AC-18). */
  private deriveRunStatus(row: Pick<CiRunRow, 'findingsCount' | 'status'>): string | null {
    return row.findingsCount === 0 ? 'no_findings' : row.status;
  }

  private toInstallationRecord(row: CiInstallationRow): CiInstallationRecord {
    return {
      id: row.id,
      agentId: row.agentId,
      repo: row.repo,
      targetType: row.targetType as CiTarget,
      installedAt: row.installedAt.toISOString(),
      ingestSecretHash: row.ingestSecretHash,
      version: row.version,
    };
  }

  /** Maps a `ci_runs` row to the shared `CiRun` DTO. Applies the
   *  `findings_count === 0` -> `no_findings` mapping AT READ TIME (AC-17)
   *  regardless of whatever status value is persisted, so this is the single
   *  source of truth for "did this run pass" across every read path.
   *  `duration_s` is derived from `duration_ms`; `agent` comes from the
   *  joined `agents.name` (there is no `agent` column on `ci_runs`). `repo`
   *  comes from the joined `ci_installations.repo` — `null` when the caller
   *  has no installation context to join against (e.g. a bare row without
   *  the installations join). */
  private toRunDomain(row: CiRunRow, agentName: string | null, repo: string | null = null): CiRun {
    return {
      id: row.id,
      ci_installation_id: row.ciInstallationId,
      pr_number: row.prNumber,
      ran_at: row.ranAt ? row.ranAt.toISOString() : null,
      status: row.findingsCount === 0 ? 'no_findings' : row.status,
      findings_count: row.findingsCount,
      cost_usd: row.costUsd,
      github_url: row.githubUrl,
      source: row.source,
      agent: agentName,
      duration_s: row.durationMs !== null ? Math.round(row.durationMs / 1000) : null,
      repo,
    };
  }

  // ---- installations ----------------------------------------------------

  /** Persist a new installation at export time (AC-11), snapshotting the
   *  agent's `version` (D5 -> AC-18) and the ingest-secret hash (D4). */
  async insertInstallation(input: InsertInstallationInput): Promise<CiInstallation> {
    const [row] = await this.db
      .insert(t.ciInstallations)
      .values({
        agentId: input.agentId,
        repo: input.repo,
        targetType: input.targetType,
        ingestSecretHash: input.ingestSecretHash,
        version: input.version,
      })
      .returning();
    return this.toInstallationDomain(row!);
  }

  /** Full installation record (including the secret hash) for ingest auth +
   *  write scoping — never expose this record directly over the wire. */
  async getInstallation(id: string): Promise<CiInstallationRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.id, id));
    return row ? this.toInstallationRecord(row) : undefined;
  }

  /** Every installation for one agent (AC-18), newest first, each carrying a
   *  DERIVED `status` from its most recent `ci_runs` row (null when the
   *  installation has no runs yet). Caller is responsible for having verified
   *  the agent belongs to its workspace.
   *
   *  Resolved with 2 queries total (not N+1 per installation): fetch the
   *  installations, then fetch every run for those installation ids ordered
   *  newest-first and reduce to "first row seen per installation" in JS —
   *  the same "fetch unbounded, aggregate in JS" pattern used elsewhere in
   *  this codebase for small per-owner result sets (see
   *  `eval/repository.ts`'s `dashboardAllAgents`). */
  async listAgentInstallations(agentId: string): Promise<CiInstallation[]> {
    const rows = await this.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId))
      .orderBy(desc(t.ciInstallations.installedAt));
    if (rows.length === 0) return [];

    const installationIds = rows.map((r) => r.id);
    // Bounded read (MEDIUM finding fix): without a LIMIT this scanned the
    // FULL joined `ci_runs` history for every installation on the agent.
    // Capped at `installations.length * CI_INSTALLATION_STATUS_RUN_MULTIPLIER`
    // rows (still ordered `ran_at DESC`, still reduced to "first row seen per
    // installation" below) — generous enough that each installation's actual
    // latest run is almost always inside the window, while bounding the read
    // for an agent with many installations/a long-lived history.
    const runRows = await this.db
      .select({ ciInstallationId: t.ciRuns.ciInstallationId, findingsCount: t.ciRuns.findingsCount, status: t.ciRuns.status })
      .from(t.ciRuns)
      .where(inArray(t.ciRuns.ciInstallationId, installationIds))
      .orderBy(desc(t.ciRuns.ranAt))
      .limit(installationIds.length * CI_INSTALLATION_STATUS_RUN_MULTIPLIER);

    const latestStatusByInstallation = new Map<string, string | null>();
    for (const run of runRows) {
      if (run.ciInstallationId === null) continue;
      if (latestStatusByInstallation.has(run.ciInstallationId)) continue;
      latestStatusByInstallation.set(run.ciInstallationId, this.deriveRunStatus(run));
    }

    return rows.map((r) => this.toInstallationDomain(r, latestStatusByInstallation.get(r.id) ?? null));
  }

  // ---- runs ---------------------------------------------------------------

  /** CI runs for a whole workspace (AC-15), newest first, bounded to the
   *  `CI_RUN_HISTORY_LIMIT` most recent rows (no cursor pagination — out of
   *  scope for this pass). Scoped via `ci_installations.agent_id ->
   *  agents.workspace_id` — `ci_runs` has no `workspace_id` of its own, so a
   *  client-supplied workspace id is never trusted directly; the join is the
   *  only source of truth for tenancy. */
  async listWorkspaceCiRuns(workspaceId: string): Promise<CiRun[]> {
    const rows = await this.db
      .select({ run: t.ciRuns, agentName: t.agents.name, repo: t.ciInstallations.repo })
      .from(t.ciRuns)
      .innerJoin(t.ciInstallations, eq(t.ciInstallations.id, t.ciRuns.ciInstallationId))
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(desc(t.ciRuns.ranAt))
      .limit(CI_RUN_HISTORY_LIMIT);
    return rows.map(({ run, agentName, repo }) => this.toRunDomain(run, agentName, repo));
  }

  /** CI run history for one agent (AC-19), newest first (bounded to the
   *  `CI_RUN_HISTORY_LIMIT` most recent rows). Caller is responsible for
   *  having verified the agent belongs to its workspace. */
  async listAgentCiRuns(agentId: string): Promise<CiRun[]> {
    const rows = await this.db
      .select({ run: t.ciRuns, agentName: t.agents.name, repo: t.ciInstallations.repo })
      .from(t.ciRuns)
      .innerJoin(t.ciInstallations, eq(t.ciInstallations.id, t.ciRuns.ciInstallationId))
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(eq(t.ciInstallations.agentId, agentId))
      .orderBy(desc(t.ciRuns.ranAt))
      .limit(CI_RUN_HISTORY_LIMIT);
    return rows.map(({ run, agentName, repo }) => this.toRunDomain(run, agentName, repo));
  }

  // ---- ingest ---------------------------------------------------------------

  /**
   * Writes an idempotent upsert of the `ci_runs` row PER artifact, and — ONLY
   * when that write is the one that actually wins the unique constraint —
   * a matching `agent_runs` row (`source='ci'`), all in a single transaction
   * (AC-21).
   *
   * Idempotency (AC-23) is enforced ATOMICALLY, not via a pre-check SELECT:
   * the `ci_runs` insert (`ON CONFLICT ... DO NOTHING ... RETURNING`) happens
   * FIRST for each artifact. Postgres guarantees only one of two concurrent
   * transactions racing on the same `(ci_installation_id, pr_number, ran_at)`
   * key gets a non-empty `RETURNING` — the loser blocks until the winner
   * commits, then sees the conflict and returns nothing. The `agent_runs`
   * write is gated on THAT result: it only happens when `ci_runs` was
   * freshly inserted by this call. A pre-check-SELECT-then-insert approach
   * (the prior implementation) cannot give this guarantee — two concurrent
   * identical ingests can both pass the SELECT before either has inserted,
   * and each would then insert its own `agent_runs` row even though only one
   * `ci_runs` row survives, breaking the 1:1 idempotency the pre-check was
   * meant to protect.
   *
   * `prNumber` is the ingest request's resolved PR number; when null, each
   * artifact's own `pr_number` is used as a fallback.
   *
   * PER-ARTIFACT DISCRIMINATOR (idempotency fix, MEDIUM finding): the
   * idempotency key is `(ci_installation_id, pr_number, ran_at)`, but a
   * single ingest call can carry MULTIPLE artifacts sharing the exact same
   * `ranAt` (one request-wide timestamp — see `CiIngestArtifact`'s doc
   * comment) AND the exact same `effectivePrNumber` (whenever the request's
   * top-level `pr_number` is supplied, it overrides every artifact's own
   * `pr_number`). Without a discriminator, every artifact after the first
   * would collide on that key and be silently dropped by
   * `onConflictDoNothing` — its `ci_runs`/`agent_runs` row would simply never
   * be written, with no error surfaced anywhere. Each artifact's DEDUP
   * `ran_at` is therefore offset by its position in `artifacts` (whole
   * milliseconds: `ranAt + index`) before it is used for both the insert and
   * the unique-constraint target. This stays purely a query/dedup-logic fix —
   * no new column, no migration — and remains idempotent across replays: a
   * retry that resubmits the identical `results` array in the identical
   * order recomputes the identical per-artifact offsets, so the unique
   * constraint still collides correctly on replay (AC-23 preserved). The
   * `ran_at` PERSISTED (and returned in the `CiRun` DTO) for artifacts after
   * the first is therefore up to a few milliseconds later than the literal
   * request `ran_at` — an intentional, negligible trade-off to guarantee no
   * artifact is ever silently dropped.
   */
  async ingestResults(
    installation: CiInstallationRecord,
    prNumber: number | null,
    artifacts: CiIngestArtifact[],
    workspaceId: string,
  ): Promise<CiRun[]> {
    return this.db.transaction(async (tx) => {
      const findExisting = async (effectivePrNumber: number | null, dedupRanAt: Date) => {
        const [row] = await tx
          .select()
          .from(t.ciRuns)
          .where(
            and(
              eq(t.ciRuns.ciInstallationId, installation.id),
              effectivePrNumber === null
                ? isNull(t.ciRuns.prNumber)
                : eq(t.ciRuns.prNumber, effectivePrNumber),
              eq(t.ciRuns.ranAt, dedupRanAt),
            ),
          );
        return row;
      };

      const results: CiRun[] = [];
      for (const [index, { artifact, ranAt }] of artifacts.entries()) {
        const effectivePrNumber = prNumber ?? artifact.pr_number ?? null;
        // See the per-artifact discriminator note in this method's doc
        // comment above — offsetting by array position disambiguates
        // artifacts that would otherwise share an identical dedup key.
        const dedupRanAt = new Date(ranAt.getTime() + index);

        // ci_runs insert FIRST — the unique constraint is the single source
        // of truth for "have we already recorded this artifact".
        const [inserted] = await tx
          .insert(t.ciRuns)
          .values({
            ciInstallationId: installation.id,
            prNumber: effectivePrNumber,
            ranAt: dedupRanAt,
            status: artifact.findings_count === 0 ? 'no_findings' : 'succeeded',
            findingsCount: artifact.findings_count,
            costUsd: artifact.cost_usd,
            githubUrl: null,
            source: 'ci',
            durationMs: artifact.duration_ms ?? null,
          })
          .onConflictDoNothing({
            target: [t.ciRuns.ciInstallationId, t.ciRuns.prNumber, t.ciRuns.ranAt],
          })
          .returning();

        if (!inserted) {
          // Conflict: already recorded (an earlier ingest call, or a
          // concurrent one that won the race). Skip BOTH inserts — the
          // agent_runs row for this artifact was already written when the
          // winning ci_runs row was inserted — and return the existing row.
          const existing = await findExisting(effectivePrNumber, dedupRanAt);
          if (existing) results.push(this.toRunDomain(existing, artifact.agent, installation.repo));
          continue;
        }

        // We won the ci_runs insert — this is the canonical write for this
        // artifact, so (and only so) write the matching agent_runs row.
        await tx.insert(t.agentRuns).values({
          workspaceId,
          agentId: installation.agentId,
          prId: null,
          ranAt: dedupRanAt,
          provider: null,
          model: null,
          durationMs: artifact.duration_ms ?? null,
          tokensIn: null,
          tokensOut: null,
          costUsd: artifact.cost_usd,
          status: 'done',
          error: null,
          source: 'ci',
          findingsCount: artifact.findings_count,
          grounding: null,
          score: null,
          blockers: artifact.critical ?? null,
        });

        results.push(this.toRunDomain(inserted, artifact.agent, installation.repo));
      }
      return results;
    });
  }
}
