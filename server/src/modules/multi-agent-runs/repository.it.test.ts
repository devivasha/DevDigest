/**
 * repository.it.test.ts — integration test (real Postgres via testcontainers).
 *
 * Derived from T4's Acceptance (docs/plans/multi-agent-review.md Phase 2):
 *  - a created multi-run + linked runs are retrievable as a group (AC-10)
 *  - a cross-workspace id returns nothing (AC-12)
 *  - the estimate query is bounded to the agent's most recent 10 completed
 *    runs (AC-perf)
 *
 * Follows the existing `onboarding/repository.it.test.ts` convention for this
 * codebase: one shared testcontainer per `describe` block (`beforeAll`/
 * `afterAll`), Docker-gated via `dockerAvailable()`, each test seeding its own
 * rows so state never leaks across tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MultiAgentRunsRepository } from './repository.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[multi-agent-runs.repository.it] Docker not available — skipping.');
}

type DbHandleDb = PgFixture['handle']['db'];

async function seedRepo(db: DbHandleDb, workspaceId: string, fullName: string): Promise<string> {
  const [row] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'test-org', name: fullName.split('/')[1]!, fullName })
    .returning({ id: t.repos.id });
  return row!.id;
}

async function seedPull(db: DbHandleDb, workspaceId: string, repoId: string, number: number): Promise<string> {
  const [row] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId,
      number,
      title: 'Test PR',
      author: 'octocat',
      branch: 'feature/x',
      base: 'main',
      headSha: `sha-${number}`,
    })
    .returning({ id: t.pullRequests.id });
  return row!.id;
}

async function seedAgent(db: DbHandleDb, workspaceId: string, name: string): Promise<string> {
  const [row] = await db
    .insert(t.agents)
    .values({ workspaceId, name, provider: 'openai', model: 'gpt-4.1', systemPrompt: 'x' })
    .returning({ id: t.agents.id });
  return row!.id;
}

/** Insert an `agent_runs` row directly (bypassing the reviews module's
 *  executor — this repository's job is to link/read, not to run agents). */
async function seedAgentRun(
  db: DbHandleDb,
  values: {
    workspaceId: string;
    agentId: string;
    prId: string;
    status: 'running' | 'done' | 'failed';
    durationMs?: number | null;
    costUsd?: number | null;
    ranAt?: Date;
    error?: string | null;
  },
): Promise<string> {
  const [row] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId: values.workspaceId,
      agentId: values.agentId,
      prId: values.prId,
      status: values.status,
      durationMs: values.durationMs ?? null,
      costUsd: values.costUsd ?? null,
      ranAt: values.ranAt ?? new Date(),
      provider: 'openai',
      model: 'gpt-4.1',
      error: values.error ?? null,
    })
    .returning({ id: t.agentRuns.id });
  return row!.id;
}

async function seedReviewWithFindings(
  db: DbHandleDb,
  workspaceId: string,
  prId: string,
  runId: string,
  findingsCount: number,
): Promise<string> {
  const [review] = await db
    .insert(t.reviews)
    .values({
      workspaceId,
      prId,
      runId,
      kind: 'review',
      verdict: 'COMMENT',
      summary: 'Looks fine',
      score: 90,
    })
    .returning({ id: t.reviews.id });
  const reviewId = review!.id;
  for (let i = 0; i < findingsCount; i++) {
    await db.insert(t.findings).values({
      reviewId,
      file: `src/file${i}.ts`,
      startLine: 1,
      endLine: 2,
      severity: 'WARNING',
      category: 'style',
      title: `Finding ${i}`,
      rationale: 'because',
      confidence: 0.8,
    });
  }
  return reviewId;
}

d('MultiAgentRunsRepository (Testcontainers)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('createMultiRun + linkRuns + loadColumns retrieve the linked runs as one group (AC-10)', async () => {
    const repo = new MultiAgentRunsRepository(pg.handle.db);
    const repoId = await seedRepo(pg.handle.db, workspaceId, 'test-org/group-retrieval');
    const prId = await seedPull(pg.handle.db, workspaceId, repoId, 101);
    const agentA = await seedAgent(pg.handle.db, workspaceId, 'Agent A');
    const agentB = await seedAgent(pg.handle.db, workspaceId, 'Agent B');

    const multiRunId = await repo.createMultiRun(workspaceId, prId);
    expect(multiRunId).toBeTruthy();

    const runA = await seedAgentRun(pg.handle.db, {
      workspaceId,
      agentId: agentA,
      prId,
      status: 'done',
      durationMs: 1200,
      costUsd: 0.05,
    });
    const runB = await seedAgentRun(pg.handle.db, {
      workspaceId,
      agentId: agentB,
      prId,
      status: 'running',
    });

    await repo.linkRuns(multiRunId, [runA, runB]);

    // Persisted group is retrievable via getMultiRun (AC-10 storage side).
    const record = await repo.getMultiRun(workspaceId, multiRunId);
    expect(record).not.toBeNull();
    expect(record!.pr_id).toBe(prId);

    // Both runs carry the FK now.
    const linked = await pg.handle.db
      .select({ id: t.agentRuns.id, multiAgentRunId: t.agentRuns.multiAgentRunId })
      .from(t.agentRuns)
      .where(eq(t.agentRuns.multiAgentRunId, multiRunId));
    expect(linked.map((r) => r.id).sort()).toEqual([runA, runB].sort());

    // loadColumns assembles both columns, joined to agent name/provider/model.
    await seedReviewWithFindings(pg.handle.db, workspaceId, prId, runA, 2);

    const columns = await repo.loadColumns(multiRunId);
    expect(columns).toHaveLength(2);

    const colA = columns.find((c) => c.run_id === runA)!;
    expect(colA.agent_id).toBe(agentA);
    expect(colA.agent_name).toBe('Agent A');
    expect(colA.status).toBe('done');
    expect(colA.findings).toHaveLength(2);
    expect(colA.duration_ms).toBe(1200);
    expect(colA.cost_usd).toBe(0.05);

    // A still-running agent has no review row yet -> empty findings, not an error.
    const colB = columns.find((c) => c.run_id === runB)!;
    expect(colB.agent_id).toBe(agentB);
    expect(colB.status).toBe('running');
    expect(colB.findings).toEqual([]);

    // Reload-safe: getLatestForPull finds the same group again.
    const latest = await repo.getLatestForPull(workspaceId, prId);
    expect(latest!.id).toBe(multiRunId);
  });

  it('loadColumns surfaces a failed run\'s persisted error reason, reload-safe with no live event (AC-16)', async () => {
    const repo = new MultiAgentRunsRepository(pg.handle.db);
    const repoId = await seedRepo(pg.handle.db, workspaceId, 'test-org/failed-reason');
    const prId = await seedPull(pg.handle.db, workspaceId, repoId, 505);
    const agentId = await seedAgent(pg.handle.db, workspaceId, 'Flaky Agent');

    const multiRunId = await repo.createMultiRun(workspaceId, prId);
    // A failed run never gets a `reviews` row — the reason must come from
    // `agent_runs.error` alone, not from a review summary.
    const failedRun = await seedAgentRun(pg.handle.db, {
      workspaceId,
      agentId,
      prId,
      status: 'failed',
      error: 'Provider returned 429 (rate limited)',
    });
    await repo.linkRuns(multiRunId, [failedRun]);

    // No SSE stream involved at all — this is a plain persisted-data read,
    // the same shape a page reload would hit.
    const columns = await repo.loadColumns(multiRunId);
    expect(columns).toHaveLength(1);
    expect(columns[0]!.status).toBe('failed');
    expect(columns[0]!.summary).toBeNull();
    expect(columns[0]!.error).toBe('Provider returned 429 (rate limited)');
  });

  it('getMultiRun / getLatestForPull refuse a cross-workspace id (AC-12)', async () => {
    const repo = new MultiAgentRunsRepository(pg.handle.db);
    const repoId = await seedRepo(pg.handle.db, workspaceId, 'test-org/cross-workspace');
    const prId = await seedPull(pg.handle.db, workspaceId, repoId, 202);
    const multiRunId = await repo.createMultiRun(workspaceId, prId);

    // A second, unrelated workspace — LocalNoAuthProvider always resolves the
    // caller to the seeded default workspace, so this is guaranteed foreign.
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-ws-${Date.now()}` })
      .returning();
    const otherWorkspaceId = otherWs!.id;

    const byId = await repo.getMultiRun(otherWorkspaceId, multiRunId);
    expect(byId).toBeNull();

    const byPull = await repo.getLatestForPull(otherWorkspaceId, prId);
    expect(byPull).toBeNull();

    // Same id/pr under the correct workspace still resolves.
    expect(await repo.getMultiRun(workspaceId, multiRunId)).not.toBeNull();
    expect(await repo.getLatestForPull(workspaceId, prId)).not.toBeNull();
  });

  it('estimate is bounded to the agent\'s most recent 10 completed runs (AC-perf)', async () => {
    const repo = new MultiAgentRunsRepository(pg.handle.db);
    const repoId = await seedRepo(pg.handle.db, workspaceId, 'test-org/estimate-window');
    const prId = await seedPull(pg.handle.db, workspaceId, repoId, 303);
    const agentId = await seedAgent(pg.handle.db, workspaceId, 'Estimate Agent');
    const coldAgentId = await seedAgent(pg.handle.db, workspaceId, 'Cold Start Agent');

    // 3 old, cheap runs OUTSIDE the 10-run window (older ranAt).
    for (let i = 0; i < 3; i++) {
      await seedAgentRun(pg.handle.db, {
        workspaceId,
        agentId,
        prId,
        status: 'done',
        durationMs: 100,
        costUsd: 0.01,
        ranAt: new Date(Date.now() - (20 - i) * 60_000),
      });
    }
    // 10 recent, expensive runs INSIDE the window (newer ranAt).
    for (let i = 0; i < 10; i++) {
      await seedAgentRun(pg.handle.db, {
        workspaceId,
        agentId,
        prId,
        status: 'done',
        durationMs: 2000,
        costUsd: 1.0,
        ranAt: new Date(Date.now() - i * 1000),
      });
    }
    // A running (not completed) run must never enter the average.
    await seedAgentRun(pg.handle.db, {
      workspaceId,
      agentId,
      prId,
      status: 'running',
      durationMs: null,
      costUsd: null,
    });

    const [est, coldEst] = await repo.estimate(workspaceId, [agentId, coldAgentId]);

    // Bounded to the 10 recent (expensive) runs — the 3 old cheap ones must
    // NOT drag the average down. If unbounded, avg duration would be
    // (10*2000 + 3*100)/13 ≈ 1561, not 2000.
    expect(est!.agent_id).toBe(agentId);
    expect(est!.est_duration_ms).toBe(2000);
    expect(est!.est_cost_usd).toBe(1.0);

    // Cold-start agent (zero completed runs) -> both null, not an error.
    expect(coldEst!.agent_id).toBe(coldAgentId);
    expect(coldEst!.est_duration_ms).toBeNull();
    expect(coldEst!.est_cost_usd).toBeNull();
  });
});
