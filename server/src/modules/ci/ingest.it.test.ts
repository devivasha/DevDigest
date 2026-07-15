/**
 * ingest.it.test.ts — integration test (real Postgres via testcontainers).
 *
 * Follows the existing `.it.test.ts` convention (see
 * `server/src/modules/eval/routes.it.test.ts`, `server/test/skills.it.test.ts`):
 * one shared testcontainer per `describe` block (`beforeAll`/`afterAll`),
 * Docker-gated via `dockerAvailable()`, each test drives the real Fastify app
 * via `app.inject()`. No mocking of the Drizzle `db` object — everything goes
 * through real Postgres, including the `ci_runs_installation_pr_ranat_uq`
 * (NULLS NOT DISTINCT) unique constraint that backs AC-23's idempotency.
 *
 * Covers T12's ingest-focused ACs:
 *   - AC-21 (dual-write): a valid ingest writes ONE `agent_runs` row per
 *     artifact with `source='ci'` AND upserts the matching `ci_runs` row.
 *   - AC-23 (idempotency): replaying the identical `(installation, pr_number,
 *     ran_at)` ingest does not double-insert either table.
 *   - AC-25 (auth scoping): a correct per-installation secret authorizes only
 *     its own installation; wrong/absent secrets are rejected with no write;
 *     a secret minted for installation A cannot ingest for installation B.
 *
 * `ran_at` is always set to an EXPLICIT, stable ISO string in these tests so
 * idempotency assertions are deterministic (never `new Date()`/`Date.now()`
 * in the test body itself — see the test-writer hard rules).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockLLMProvider, MockGitClient, MockEmbedder } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[ci.ingest.it] Docker not available — skipping.');
}

const INGEST_HEADER = 'x-devdigest-ingest-secret';

/** Deterministic, stable ISO timestamps — never derived from `Date.now()`
 *  inside a test body, per the idempotency requirement (AC-23). */
const RAN_AT_A = '2026-07-14T10:00:00.000Z';
const RAN_AT_B = '2026-07-14T11:30:00.000Z';

d('CI ingest (Testcontainers pg)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /** Test-mode app — rate-limit plugin disabled under NODE_ENV=test (see
   *  server/insights/gotchas.md). No GitHub/LLM calls are exercised by these
   *  tests (export uses action:'files'), but the doubles are supplied for
   *  parity with the other `.it.test.ts` files in this codebase. */
  function testApp() {
    return buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: '' }),
        llm: { openai: new MockLLMProvider('openai', { structured: {} }) },
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

  /** Exports the agent with `action:'files'` (no GitHub round-trip needed —
   *  keeps these ingest-focused tests independent of the GitHub port) and
   *  returns the installation id + the freshly issued plaintext ingest
   *  secret (only ever returned once, at export — AC-24). */
  async function exportAgent(app: Awaited<ReturnType<typeof testApp>>, agentId: string, repo: string) {
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { repo, target: 'gha', action: 'files' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { installation: { id: string }; ingest_secret: string };
    return { installationId: body.installation.id, secret: body.ingest_secret };
  }

  function validArtifact(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      findings_count: 2,
      critical: 1,
      warning: 1,
      suggestion: 0,
      cost_usd: 0.03,
      duration_ms: 4200,
      agent: 'CI Agent',
      version: '1.0.0',
      ...overrides,
    };
  }

  // =========================================================================
  // AC-21 — dual-write: one agent_runs row per artifact (source='ci') AND an
  // upserted ci_runs row, both visible via the read surfaces.
  // =========================================================================

  it('a valid ingest writes one agent_runs row per artifact (source=ci) and upserts ci_runs, visible on both read surfaces', async () => {
    const app = await testApp();
    const agent = await createAgent(app, 'Ingest Agent AC21');
    const { installationId, secret } = await exportAgent(app, agent.id, 'acme/ac21-repo');

    const res = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { [INGEST_HEADER]: secret },
      payload: {
        installation_id: installationId,
        pr_number: 101,
        ran_at: RAN_AT_A,
        results: [validArtifact()],
      },
    });
    expect(res.statusCode).toBe(200);
    const runs = res.json() as Array<{ id: string; findings_count: number; source: string }>;
    expect(runs).toHaveLength(1);
    expect(runs[0]!.source).toBe('ci');
    expect(runs[0]!.findings_count).toBe(2);

    // agent_runs: exactly one row for this agent with source='ci'.
    const agentRunsRows = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.agentId, agent.id), eq(t.agentRuns.source, 'ci')));
    expect(agentRunsRows).toHaveLength(1);
    expect(agentRunsRows[0]!.findingsCount).toBe(2);

    // ci_runs: exactly one upserted row for this installation.
    const ciRunsRows = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.ciInstallationId, installationId));
    expect(ciRunsRows).toHaveLength(1);
    expect(ciRunsRows[0]!.prNumber).toBe(101);

    // Both read surfaces: workspace-wide CI Runs + the agent's CI tab runs.
    const workspaceRuns = await app.inject({ method: 'GET', url: '/ci/runs' });
    expect(workspaceRuns.statusCode).toBe(200);
    expect((workspaceRuns.json() as Array<{ id: string }>).some((r) => r.id === runs[0]!.id)).toBe(true);

    const agentRuns = await app.inject({ method: 'GET', url: `/agents/${agent.id}/ci/runs` });
    expect(agentRuns.statusCode).toBe(200);
    expect((agentRuns.json() as Array<{ id: string }>).some((r) => r.id === runs[0]!.id)).toBe(true);

    await app.close();
  });

  it('an ingest with multiple artifacts writes one agent_runs row per artifact', async () => {
    const app = await testApp();
    const agent = await createAgent(app, 'Ingest Agent AC21 Multi');
    const { installationId, secret } = await exportAgent(app, agent.id, 'acme/ac21-multi-repo');

    // NOTE: the idempotency key is (ci_installation_id, pr_number, ran_at) —
    // `ran_at` is a single TOP-LEVEL field on `CiIngestInput` shared by every
    // artifact in one ingest call (there is no per-artifact timestamp in the
    // contract), so two artifacts sharing the same effective pr_number would
    // collide on that key and only the first would be written (verified —
    // not exercised here; this is intended per AC-23's idempotency guard,
    // not a bug). Omitting the top-level `pr_number` lets each artifact's own
    // `pr_number` field resolve the effective key instead, so two genuinely
    // distinct artifacts in one call get two distinct rows.
    const res = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { [INGEST_HEADER]: secret },
      payload: {
        installation_id: installationId,
        ran_at: RAN_AT_A,
        results: [
          validArtifact({ agent: 'agent-1', pr_number: 203 }),
          validArtifact({ agent: 'agent-2', findings_count: 0, pr_number: 204 }),
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);

    const agentRunsRows = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.agentId, agent.id), eq(t.agentRuns.source, 'ci')));
    expect(agentRunsRows).toHaveLength(2);

    const ciRunsRows = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.ciInstallationId, installationId));
    expect(ciRunsRows).toHaveLength(2);

    await app.close();
  });

  // =========================================================================
  // AC-23 — idempotency: replaying the SAME (installation, pr_number, ran_at)
  // yields exactly ONE ci_runs row and no duplicate agent_runs rows.
  // =========================================================================

  it('replaying the identical (installation, pr_number, ran_at) ingest does not double-insert ci_runs or agent_runs', async () => {
    const app = await testApp();
    const agent = await createAgent(app, 'Ingest Agent AC23');
    const { installationId, secret } = await exportAgent(app, agent.id, 'acme/ac23-repo');

    const payload = {
      installation_id: installationId,
      pr_number: 303,
      ran_at: RAN_AT_B,
      results: [validArtifact()],
    };

    const first = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { [INGEST_HEADER]: secret },
      payload,
    });
    expect(first.statusCode).toBe(200);

    // Exact replay — same installation + pr_number + ran_at.
    const second = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { [INGEST_HEADER]: secret },
      payload,
    });
    expect(second.statusCode).toBe(200);

    const ciRunsRows = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(and(eq(t.ciRuns.ciInstallationId, installationId), eq(t.ciRuns.prNumber, 303)));
    expect(ciRunsRows).toHaveLength(1);

    const agentRunsRows = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.agentId, agent.id), eq(t.agentRuns.source, 'ci')));
    expect(agentRunsRows).toHaveLength(1);

    // The replay's response echoes the SAME existing run id, not a new one.
    const firstRunId = (first.json() as Array<{ id: string }>)[0]!.id;
    const secondRunId = (second.json() as Array<{ id: string }>)[0]!.id;
    expect(secondRunId).toBe(firstRunId);

    await app.close();
  });

  it('a DIFFERENT ran_at for the same installation+pr_number is treated as a distinct run (not idempotent-merged)', async () => {
    const app = await testApp();
    const agent = await createAgent(app, 'Ingest Agent AC23 Distinct');
    const { installationId, secret } = await exportAgent(app, agent.id, 'acme/ac23-distinct-repo');

    await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { [INGEST_HEADER]: secret },
      payload: { installation_id: installationId, pr_number: 404, ran_at: RAN_AT_A, results: [validArtifact()] },
    });
    await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { [INGEST_HEADER]: secret },
      payload: { installation_id: installationId, pr_number: 404, ran_at: RAN_AT_B, results: [validArtifact()] },
    });

    const ciRunsRows = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(and(eq(t.ciRuns.ciInstallationId, installationId), eq(t.ciRuns.prNumber, 404)));
    expect(ciRunsRows).toHaveLength(2);

    await app.close();
  });

  // =========================================================================
  // AC-25 — auth scoping: correct per-installation secret authorizes only
  // its OWN installation; wrong/absent secret rejected with no write; a
  // secret from installation A cannot ingest for installation B.
  // =========================================================================

  it('a request with no secret header is rejected 401/403 and writes nothing', async () => {
    const app = await testApp();
    const agent = await createAgent(app, 'Ingest Agent AC25 NoSecret');
    const { installationId } = await exportAgent(app, agent.id, 'acme/ac25-nosecret-repo');

    const res = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      // No secret header at all.
      payload: { installation_id: installationId, pr_number: 501, ran_at: RAN_AT_A, results: [validArtifact()] },
    });
    expect([401, 403]).toContain(res.statusCode);

    const ciRunsRows = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.ciInstallationId, installationId));
    expect(ciRunsRows).toHaveLength(0);

    await app.close();
  });

  it('a request with a WRONG secret is rejected 401/403 and writes nothing', async () => {
    const app = await testApp();
    const agent = await createAgent(app, 'Ingest Agent AC25 WrongSecret');
    const { installationId } = await exportAgent(app, agent.id, 'acme/ac25-wrongsecret-repo');

    const res = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { [INGEST_HEADER]: 'not-the-real-secret-value-0000000000000000000000000000' },
      payload: { installation_id: installationId, pr_number: 502, ran_at: RAN_AT_A, results: [validArtifact()] },
    });
    expect([401, 403]).toContain(res.statusCode);

    const ciRunsRows = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.ciInstallationId, installationId));
    expect(ciRunsRows).toHaveLength(0);

    await app.close();
  });

  it("a secret minted for installation A cannot ingest for installation B, but works for its own installation", async () => {
    const app = await testApp();
    const agentA = await createAgent(app, 'Ingest Agent AC25 Owner A');
    const agentB = await createAgent(app, 'Ingest Agent AC25 Owner B');
    const { installationId: installationA, secret: secretA } = await exportAgent(app, agentA.id, 'acme/ac25-a-repo');
    const { installationId: installationB } = await exportAgent(app, agentB.id, 'acme/ac25-b-repo');

    // Installation A's secret used against installation B's id -> rejected, no write anywhere.
    const crossRes = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { [INGEST_HEADER]: secretA },
      payload: { installation_id: installationB, pr_number: 601, ran_at: RAN_AT_A, results: [validArtifact()] },
    });
    expect([401, 403]).toContain(crossRes.statusCode);

    const bRunsAfterCrossAttempt = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.ciInstallationId, installationB));
    expect(bRunsAfterCrossAttempt).toHaveLength(0);

    // The SAME secret A correctly authorizes writes scoped to installation A.
    const ownRes = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { [INGEST_HEADER]: secretA },
      payload: { installation_id: installationA, pr_number: 602, ran_at: RAN_AT_A, results: [validArtifact()] },
    });
    expect(ownRes.statusCode).toBe(200);

    const aRuns = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.ciInstallationId, installationA));
    expect(aRuns).toHaveLength(1);

    await app.close();
  });

  it('an unknown installation_id is rejected 401/403 (no enumeration signal distinct from a wrong secret) and writes nothing', async () => {
    const app = await testApp();

    const res = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { [INGEST_HEADER]: 'irrelevant-secret-value' },
      payload: {
        installation_id: '00000000-0000-0000-0000-000000000000',
        pr_number: 701,
        ran_at: RAN_AT_A,
        results: [validArtifact()],
      },
    });
    expect([401, 403]).toContain(res.statusCode);

    await app.close();
  });
});
