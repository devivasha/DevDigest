/**
 * routes.it.test.ts — integration test (real Postgres via testcontainers).
 *
 * Derived from T5's Acceptance (docs/plans/multi-agent-review.md Phase 2):
 *  - launching N agents creates one multi-run whose N `agent_runs` carry the
 *    FK (AC-3/AC-10)
 *  - the read returns `columns[]` + computed `conflicts[]`, reload-safe
 *    (AC-11/AC-13/AC-18)
 *  - estimate returns per-agent + summary with cold-start nulls excluded
 *    (AC-6/AC-7/AC-8)
 *  - a cross-workspace agent is refused (AC-12)
 *  - the launch route is rate-limited at 10/min
 *
 * Follows the existing `.it.test.ts` convention in this codebase (see
 * `eval/routes.it.test.ts`, `test/reviews.it.test.ts`): one shared
 * testcontainer per `describe` block, Docker-gated via `dockerAvailable()`,
 * each test builds its own `app.inject()`-driven Fastify instance against the
 * shared pg fixture. No mocking of the Drizzle `db` object.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockLLMProvider, MockGitClient, MockEmbedder, MockAuthProvider } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { waitForPrRuns } from '../../../test/helpers/runs.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[multi-agent-runs.routes.it] Docker not available — skipping.');
}

/** Diff fixture shared with other `.it.test.ts` files in this codebase. */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** A Review fixture with one finding (line 11 -- inside the hunk, survives grounding). */
const REVIEW_WITH_FINDING: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded secret.',
  score: 42,
  findings: [
    {
      id: 'f-1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live key is committed.',
      confidence: 0.9,
      kind: 'finding',
    },
  ],
};

/** A clean-review fixture (zero findings — score must be >=90 per the Review schema). */
const REVIEW_EMPTY: Review = { verdict: 'approve', summary: 'clean', score: 95, findings: [] };

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `multi-agent-fixture-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 900 + repoSeq,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting.',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('Multi-agent-runs routes (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /** Test-mode app (rate-limit plugin disabled — see server/insights/gotchas.md). */
  function testApp(structured: unknown = REVIEW_EMPTY) {
    return buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured }) },
      },
    });
  }

  async function createAgent(app: Awaited<ReturnType<typeof testApp>>, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name, provider: 'openai', model: 'gpt-4.1', system_prompt: 'You review code.' },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string };
  }

  // =========================================================================
  // AC-3/AC-10 — launch fans out to N agents, all linked to one multi-run
  // =========================================================================

  it('POST /pulls/:id/multi-agent-run creates one multi-run whose N agent_runs carry the FK', async () => {
    const app = await testApp(REVIEW_WITH_FINDING);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agentA = await createAgent(app, 'Security Bot');
    const agentB = await createAgent(app, 'Perf Bot');

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [agentA.id, agentB.id] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pr_id).toBe(pr.id);
    expect(body.runs).toHaveLength(2);

    // The FK link is stamped SYNCHRONOUSLY before the response returns
    // (Rec 2) — no polling needed to observe it.
    const linked = await pg.handle.db
      .select({ id: t.agentRuns.id, multiAgentRunId: t.agentRuns.multiAgentRunId })
      .from(t.agentRuns)
      .where(eq(t.agentRuns.multiAgentRunId, body.id));
    expect(linked).toHaveLength(2);
    expect(linked.map((r) => r.id).sort()).toEqual(
      body.runs.map((r: { run_id: string }) => r.run_id).sort(),
    );

    await app.close();
  });

  // =========================================================================
  // AC-11/AC-13/AC-18 — reload-safe read: columns[] + conflicts[]
  // =========================================================================

  it('GET /multi-agent-runs/:id and GET /pulls/:id/multi-agent return columns[] + conflicts[] once runs complete, reload-safe', async () => {
    const app = await testApp(REVIEW_WITH_FINDING);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agentA = await createAgent(app, 'Flagger Bot');
    const agentB = await createAgent(app, 'Silent Bot');

    const launch = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [agentA.id, agentB.id] },
    });
    expect(launch.statusCode).toBe(200);
    const { id: multiRunId } = launch.json();

    // Both fanned-out runs are background jobs — wait for them to persist.
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2, timeoutMs: 60_000 });

    const byId = await app.inject({ method: 'GET', url: `/multi-agent-runs/${multiRunId}` });
    expect(byId.statusCode).toBe(200);
    const run = byId.json();
    expect(run.id).toBe(multiRunId);
    expect(run.pr_id).toBe(pr.id);
    expect(run.agent_count).toBe(2);
    expect(run.columns).toHaveLength(2);
    expect(run.columns.every((c: { status: string }) => c.status === 'done')).toBe(true);
    // Both agents use the SAME mocked review (identical finding) — every
    // agent flags the exact same file:line with the same severity, so this
    // is agreement, not a conflict (AC-20's non-conflict half). Asserting
    // an empty array (not just `Array.isArray`, which the Zod response
    // schema already guarantees) actually verifies that identical findings
    // across columns are NOT classified as a conflict.
    expect(run.conflicts).toHaveLength(0);

    // Reload-safe: GET /pulls/:id/multi-agent (latest) returns the SAME run
    // re-assembled purely from persisted data.
    const latest = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent` });
    expect(latest.statusCode).toBe(200);
    expect(latest.json().id).toBe(multiRunId);
    expect(latest.json().columns).toHaveLength(2);

    await app.close();
  });

  // =========================================================================
  // AC-6/AC-7/AC-8 — estimate: per-agent + summary, cold-start nulls excluded
  // =========================================================================

  it('GET /pulls/:id/multi-agent/estimate returns per-agent + summary with cold-start agents excluded from the summary', async () => {
    const app = await testApp(REVIEW_EMPTY);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const warmAgent = await createAgent(app, 'Warm Agent');
    const coldAgent = await createAgent(app, 'Cold Agent');

    // Seed completed run history directly for the warm agent (cheaper/more
    // deterministic than running 10 real reviews through the executor).
    for (let i = 0; i < 3; i++) {
      await pg.handle.db.insert(t.agentRuns).values({
        workspaceId,
        agentId: warmAgent.id,
        prId: pr.id,
        status: 'done',
        durationMs: 1500,
        costUsd: 0.2,
        provider: 'openai',
        model: 'gpt-4.1',
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: `/pulls/${pr.id}/multi-agent/estimate?agent_ids=${warmAgent.id},${coldAgent.id}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.agents).toHaveLength(2);
    const warm = body.agents.find((a: { agent_id: string }) => a.agent_id === warmAgent.id);
    const cold = body.agents.find((a: { agent_id: string }) => a.agent_id === coldAgent.id);
    expect(warm.est_duration_ms).toBe(1500);
    // Mean of 3 identical 0.2 values can pick up float noise
    // (0.20000000000000004) — assert numerically close, not bit-exact.
    expect(warm.est_cost_usd).toBeCloseTo(0.2, 10);
    // Cold-start agent (zero completed runs) -> both null, not an error.
    expect(cold.est_duration_ms).toBeNull();
    expect(cold.est_cost_usd).toBeNull();

    // Summary excludes the cold-start agent from the reduction, but still
    // counts it in agent_count (AC-7/AC-8).
    expect(body.summary.agent_count).toBe(2);
    expect(body.summary.est_duration_ms).toBe(1500);
    expect(body.summary.est_cost_usd).toBeCloseTo(0.2, 10);

    await app.close();
  });

  // =========================================================================
  // AC-12 — cross-workspace agent refused
  // =========================================================================

  it('POST /pulls/:id/multi-agent-run with an agent from a DIFFERENT workspace is refused, and never creates a run', async () => {
    const app = await testApp(REVIEW_EMPTY);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-ws-${Date.now()}` })
      .returning();
    const [otherAgent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: otherWs!.id,
        name: 'Foreign Agent',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'x',
      })
      .returning();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [otherAgent!.id] },
    });
    expect(res.statusCode).toBe(404);

    // Never created a multi-agent run for this PR.
    const runs = await pg.handle.db
      .select()
      .from(t.multiAgentRuns)
      .where(eq(t.multiAgentRuns.prId, pr.id));
    expect(runs).toHaveLength(0);

    await app.close();
  });

  // =========================================================================
  // Finding A — a nonexistent (but well-formed) prId must 404 and never
  // persist an orphaned `multi_agent_runs` row.
  // =========================================================================

  it('POST /pulls/:id/multi-agent-run with a well-formed but non-existent prId → 404, no orphan multi_agent_runs row', async () => {
    const app = await testApp(REVIEW_EMPTY);
    const agent = await createAgent(app, 'Orphan Check Agent');

    const bogusPrId = '00000000-0000-4000-8000-000000000000';
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${bogusPrId}/multi-agent-run`,
      payload: { agent_ids: [agent.id] },
    });
    expect(res.statusCode).toBe(404);

    // The PR is validated BEFORE `createMultiRun` — a bad prId must never
    // leave a `multi_agent_runs` row behind.
    const runs = await pg.handle.db
      .select()
      .from(t.multiAgentRuns)
      .where(eq(t.multiAgentRuns.prId, bogusPrId));
    expect(runs).toHaveLength(0);

    await app.close();
  });

  // =========================================================================
  // Finding B — malformed/oversized `agent_ids` on the estimate route → 400
  // =========================================================================

  it('GET /pulls/:id/multi-agent/estimate with a non-uuid in agent_ids → 422 (this app\'s Zod-validation status, app.ts setErrorHandler)', async () => {
    const app = await testApp(REVIEW_EMPTY);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = await createAgent(app, 'Bad Query Agent');

    const res = await app.inject({
      method: 'GET',
      url: `/pulls/${pr.id}/multi-agent/estimate?agent_ids=${agent.id},not-a-uuid`,
    });
    expect(res.statusCode).toBe(422);

    await app.close();
  });

  it('GET /pulls/:id/multi-agent/estimate with more than 20 agent_ids → 422 (this app\'s Zod-validation status, app.ts setErrorHandler)', async () => {
    const app = await testApp(REVIEW_EMPTY);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const tooMany = Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const res = await app.inject({
      method: 'GET',
      url: `/pulls/${pr.id}/multi-agent/estimate?agent_ids=${tooMany.join(',')}`,
    });
    expect(res.statusCode).toBe(422);

    await app.close();
  });

  it('GET /multi-agent-runs/:id for a well-formed but non-existent id → 404', async () => {
    const app = await testApp(REVIEW_WITH_FINDING);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = await createAgent(app, 'Owner Agent');

    const launch = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [agent.id] },
    });
    expect(launch.statusCode).toBe(200);
    const { id: multiRunId } = launch.json();

    // Confirms the route propagates NotFoundError as 404 for a fabricated
    // id that never existed — distinct from the cross-workspace case below,
    // which exercises a REAL, persisted, foreign-tenant run.
    const bogusId = multiRunId.slice(0, -4) + '0000';
    const res = await app.inject({ method: 'GET', url: `/multi-agent-runs/${bogusId}` });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('GET /multi-agent-runs/:id for a REAL run that exists in a DIFFERENT workspace → 404 (AC-12 cross-workspace isolation)', async () => {
    // LocalNoAuthProvider always resolves the caller to the single default
    // seeded workspace, so a genuine cross-tenant probe needs a SECOND app
    // instance whose auth is overridden to a different, freshly-seeded
    // workspace — that lets us launch and persist a REAL multi-agent run
    // under a truly foreign tenant (not a fabricated id), then confirm the
    // route-level guard refuses to serve it back to the first workspace.
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-ws-${Date.now()}` })
      .returning();
    const { pr: otherPr } = await setupRepoAndPr(pg.handle.db, otherWs!.id);
    const [otherAgent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: otherWs!.id,
        name: 'Other Workspace Agent',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'x',
      })
      .returning();

    const otherApp = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_EMPTY }) },
        auth: new MockAuthProvider(undefined, { id: otherWs!.id, name: otherWs!.name }),
      },
    });

    const launch = await otherApp.inject({
      method: 'POST',
      url: `/pulls/${otherPr.id}/multi-agent-run`,
      payload: { agent_ids: [otherAgent!.id] },
    });
    expect(launch.statusCode).toBe(200);
    const { id: foreignMultiRunId } = launch.json();

    // Confirm it's a genuinely persisted run under the OTHER workspace, not
    // just an in-memory id.
    await waitForPrRuns(pg.handle.db, otherPr.id, { expected: 1, timeoutMs: 60_000 });
    const persisted = await pg.handle.db
      .select()
      .from(t.multiAgentRuns)
      .where(eq(t.multiAgentRuns.id, foreignMultiRunId));
    expect(persisted).toHaveLength(1);

    // Now read it back from the FIRST workspace's app — the route must
    // refuse to serve another tenant's EXISTING run.
    const app = await testApp(REVIEW_EMPTY);
    const res = await app.inject({ method: 'GET', url: `/multi-agent-runs/${foreignMultiRunId}` });
    expect(res.statusCode).toBe(404);

    await app.close();
    await otherApp.close();
  });

  // =========================================================================
  // Rate limit — 10 req/min on POST /pulls/:id/multi-agent-run
  // =========================================================================

  it('the 11th POST /pulls/:id/multi-agent-run within 60s → 429 (rate limit is registered when NODE_ENV !== test)', async () => {
    // The global rate-limit plugin is registered ONLY when nodeEnv !== 'test'
    // (app.ts, server/insights/gotchas.md "Rate limit is disabled in test
    // mode") — the route-level `config.rateLimit` override has no effect
    // without it. Build a dedicated app with nodeEnv:'production' for this test.
    const app = await buildApp({
      config: loadConfig({
        ...process.env,
        NODE_ENV: 'production',
        LOG_LEVEL: 'silent',
      } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_EMPTY }) },
      },
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = await createAgent(app, 'Rate Limit Agent');

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agent_ids: [agent.id] },
      });
      statuses.push(res.statusCode);
    }

    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);

    await app.close();
  });
});
