/**
 * routes.it.test.ts — integration test (real Postgres via testcontainers).
 *
 * Follows the existing `.it.test.ts` convention in this codebase (see
 * `test/skills.it.test.ts`, `test/reviews.it.test.ts`): one shared
 * testcontainer per `describe` block, Docker-gated via `dockerAvailable()`
 * (`hasDocker ? describe : describe.skip`), each test builds its own
 * `app.inject()`-driven Fastify instance against the shared pg fixture. No
 * mocking of the Drizzle `db` object — everything goes through real Postgres.
 *
 * METHODOLOGY: expected HTTP status codes / response shapes are derived from
 * the spec's ACs (AC-11, AC-24) and the plan's cross-model-review findings
 * (#1 structural tenancy, #4 IDOR on create-from-finding) and the spec's
 * rate-limit non-functional requirement (10 req/min on the run endpoint) —
 * NOT from running routes.ts and recording whatever it happened to return.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { Container } from '../../platform/container.js';
import { seed } from '../../db/seed.js';
import { MockLLMProvider, MockGitClient, MockEmbedder } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { waitForPrRuns } from '../../../test/helpers/runs.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[eval.routes.it] Docker not available — skipping.');
}

/** Same DIFF fixture as test/reviews.it.test.ts / service.test.ts. */
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

const validExpectedOutput = {
  kind: 'must_find' as const,
  findings: [
    {
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      severity: 'CRITICAL' as const,
      category: 'security' as const,
      title: 'secret',
    },
  ],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `eval-fixture-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
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

d('Eval routes (Testcontainers pg)', () => {
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
  // AC-11 — run the set: 200 + traces_total === N
  // =========================================================================

  it('POST /agents/:id/eval-runs → 200 with traces_total === N (one row per case)', async () => {
    const app = await testApp(REVIEW_EMPTY);
    const agent = await createAgent(app, 'Eval Agent AC11');

    const N = 3;
    for (let i = 0; i < N; i++) {
      const created = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/eval-cases`,
        payload: { name: `case-${i}`, input_diff: DIFF, expected_output: validExpectedOutput },
      });
      expect(created.statusCode).toBe(201);
    }

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.traces_total).toBe(N);
    expect(body.per_trace).toHaveLength(N);

    await app.close();
  });

  // =========================================================================
  // AC-19 — per-case status (loaded pass/fail icons) + single-case run
  // =========================================================================

  it('GET /agents/:id/eval-cases/status returns nothing before any run, then the latest per-case status after one', async () => {
    const app = await testApp(REVIEW_WITH_FINDING);
    const agent = await createAgent(app, 'Eval Agent AC19 Status');
    const created = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: { name: 'status-case', input_diff: DIFF, expected_output: validExpectedOutput },
    });
    expect(created.statusCode).toBe(201);
    const caseId = created.json().id as string;

    const beforeRun = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases/status` });
    expect(beforeRun.statusCode).toBe(200);
    expect(beforeRun.json()).toEqual([]);

    const runRes = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases/${caseId}/run`,
    });
    expect(runRes.statusCode).toBe(200);
    const runBody = runRes.json();
    expect(runBody.case_id).toBe(caseId);
    expect(runBody.name).toBe('status-case');
    expect(typeof runBody.pass).toBe('boolean');

    const afterRun = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases/status` });
    expect(afterRun.statusCode).toBe(200);
    const statuses = afterRun.json();
    expect(statuses).toHaveLength(1);
    expect(statuses[0].case_id).toBe(caseId);
    expect(statuses[0].pass).toBe(runBody.pass);

    await app.close();
  });

  it('POST /agents/:id/eval-cases/:caseId/run for a case in a DIFFERENT agent (or workspace) → 404, never runs', async () => {
    const app = await testApp(REVIEW_EMPTY);
    const agentA = await createAgent(app, 'Eval Agent AC19 Owner A');
    const agentB = await createAgent(app, 'Eval Agent AC19 Owner B');
    const created = await app.inject({
      method: 'POST',
      url: `/agents/${agentA.id}/eval-cases`,
      payload: { name: 'owned-by-a', input_diff: DIFF, expected_output: validExpectedOutput },
    });
    expect(created.statusCode).toBe(201);
    const caseId = created.json().id as string;

    // Case belongs to agent A -- addressing it under agent B is refused.
    const wrongOwner = await app.inject({
      method: 'POST',
      url: `/agents/${agentB.id}/eval-cases/${caseId}/run`,
    });
    expect(wrongOwner.statusCode).toBe(404);

    const statuses = await app.inject({ method: 'GET', url: `/agents/${agentA.id}/eval-cases/status` });
    expect(statuses.json()).toEqual([]);

    await app.close();
  });

  // =========================================================================
  // AC-24 — cross-workspace agent refused (not-found)
  // =========================================================================

  it('POST /agents/:id/eval-runs for an agent in a DIFFERENT workspace → 404, never runs', async () => {
    const app = await testApp(REVIEW_EMPTY);

    // A second workspace + an agent that lives ONLY in it (inserted directly —
    // LocalNoAuthProvider always resolves the caller to the seeded default
    // workspace, so this agent is guaranteed cross-tenant relative to `app`).
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

    const res = await app.inject({ method: 'POST', url: `/agents/${otherAgent!.id}/eval-runs` });
    expect(res.statusCode).toBe(404);

    // Never ran — no set-run row for the foreign agent under any workspace.
    const setRuns = await pg.handle.db
      .select()
      .from(t.evalSetRuns)
      .where(eq(t.evalSetRuns.ownerId, otherAgent!.id));
    expect(setRuns).toHaveLength(0);

    await app.close();
  });

  // =========================================================================
  // Finding #1 — a direct cross-workspace per-case-run read is refused
  // =========================================================================

  it('a direct cross-workspace listCaseRunsForSet probe returns nothing for the wrong workspace, and the real rows for the right one (finding #1)', async () => {
    const app = await testApp(REVIEW_EMPTY);
    const agent = await createAgent(app, 'Eval Agent Finding1');
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: { name: 'probe-case', input_diff: DIFF, expected_output: validExpectedOutput },
    });
    const runRes = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(runRes.statusCode).toBe(200);

    // Fetch the set-run id via history (EvalRun itself carries no set_run_id).
    const historyRes = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs` });
    expect(historyRes.statusCode).toBe(200);
    const [latestSetRun] = historyRes.json();
    expect(latestSetRun).toBeDefined();

    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-ws-${Date.now()}` })
      .returning();

    // Build a real Container directly against the same pg fixture — the
    // strongest structural probe: NOT via any HTTP route (there is none for
    // a single per-case-run read), straight at the repository layer that
    // routes.ts/service.ts sit on top of.
    const container = new Container(
      loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      pg.handle.db,
    );

    const foreignRead = await container.evalRepo.listCaseRunsForSet(otherWs!.id, latestSetRun.id);
    expect(foreignRead).toEqual([]);

    const correctRead = await container.evalRepo.listCaseRunsForSet(workspaceId, latestSetRun.id);
    expect(correctRead.length).toBeGreaterThan(0);

    await app.close();
  });

  // =========================================================================
  // Finding #4 — from-finding :id must match the finding's own review agent
  // =========================================================================

  it('POST /agents/:id/eval-cases/from-finding refuses when :id does not match the finding\'s own review agent, but succeeds when it does', async () => {
    const app = await testApp(REVIEW_WITH_FINDING);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agentA = await createAgent(app, 'Agent A (owns the review)');
    const agentB = await createAgent(app, 'Agent B (unrelated)');

    const reviewRes = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agentA.id },
    });
    expect(reviewRes.statusCode).toBe(200);
    // Background run under parallel-testcontainer load can occasionally take
    // longer than waitForPrRuns's 10s default (see server/insights/gotchas.md
    // / INSIGHTS.md re: it.test flakiness under CPU/Docker contention) —
    // widen the poll budget well within vitest.config.ts's 120s testTimeout.
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1, timeoutMs: 60_000 });

    const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })).json();
    const findingId = reviews[0].findings[0].id;
    await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` });

    // Wrong owner (:id = agent B, but the finding's review belongs to agent A) -> refused.
    const wrongOwner = await app.inject({
      method: 'POST',
      url: `/agents/${agentB.id}/eval-cases/from-finding`,
      payload: { finding_id: findingId },
    });
    expect(wrongOwner.statusCode).toBe(404);

    // Correct owner (:id = agent A, matching review.agentId) -> succeeds.
    const rightOwner = await app.inject({
      method: 'POST',
      url: `/agents/${agentA.id}/eval-cases/from-finding`,
      payload: { finding_id: findingId },
    });
    expect(rightOwner.statusCode).toBe(201);
    expect(rightOwner.json().owner_id).toBe(agentA.id);

    await app.close();
  });

  // =========================================================================
  // Rate limit — 10 req/min on POST /agents/:id/eval-runs (Non-functional)
  // =========================================================================

  it('the 11th POST /agents/:id/eval-runs within 60s → 429 (rate limit is registered when NODE_ENV !== test)', async () => {
    // The global rate-limit plugin is registered ONLY when nodeEnv !== 'test'
    // (app.ts, server/insights/gotchas.md "Rate limit is disabled in test
    // mode") -- the route-level `config.rateLimit` override has no effect
    // without it. Build a dedicated app with nodeEnv:'production' + silent
    // logging just for this test.
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
    const agent = await createAgent(app, 'Eval Agent RateLimit');

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
      statuses.push(res.statusCode);
    }

    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);

    await app.close();
  });
});
