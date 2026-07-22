/**
 * ci-reads.it.test.ts — integration test (real Postgres via testcontainers).
 *
 * Follows the existing `.it.test.ts` convention (see
 * `server/src/modules/eval/routes.it.test.ts`, `server/test/skills.it.test.ts`):
 * one shared testcontainer per `describe` block (`beforeAll`/`afterAll`),
 * Docker-gated via `dockerAvailable()`, each test drives the real Fastify app
 * via `app.inject()`. No mocking of the Drizzle `db` object.
 *
 * Covers T12's installation-persist and read-surface ACs:
 *   - AC-11 (installation persist): `export` persists a `ci_installations`
 *     row and echoes it in the response — the ingest-secret HASH is stored,
 *     never the plaintext, and the hash never appears in the response body.
 *   - AC-18 (version snapshot): the installation's `version` is the agent's
 *     `agents.version` snapshotted AT EXPORT TIME (D5), surfaced on the CI
 *     tab read (`GET /agents/:id/ci/installations`).
 *   - AC-15 (workspace-scoped reads): `GET /ci/runs` (backed by
 *     `listWorkspaceCiRuns`) returns only the caller workspace's runs — a
 *     run belonging to a different workspace never appears.
 *   - AC-16 (empty state): a fresh workspace with no CI activity returns `[]`
 *     from the CI Runs read surface, not an error.
 *   - AC-17 (no_findings status): a `CiRun` with `findings_count=0` surfaces
 *     `status: 'no_findings'` (a passing outcome, not a failure) on both the
 *     workspace-wide and agent-scoped read surfaces.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockLLMProvider, MockGitClient, MockEmbedder } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[ci.reads.it] Docker not available — skipping.');
}

const INGEST_HEADER = 'x-devdigest-ingest-secret';

d('CI installation persist + workspace-scoped reads (Testcontainers pg)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

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
    return res.json() as { id: string; version: number };
  }

  // =========================================================================
  // AC-16 — fresh workspace (no CI activity yet) -> [] on the CI Runs surface,
  // not an error/blank-table condition. Run FIRST, before any export/ingest
  // in this file has written anything (seed.ts touches no ci_* tables).
  // =========================================================================

  it('WHILE there are no CI runs for the workspace, GET /ci/runs returns an empty array (AC-16)', async () => {
    const app = await testApp();

    const res = await app.inject({ method: 'GET', url: '/ci/runs' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);

    await app.close();
  });

  // =========================================================================
  // AC-11 / AC-18 — installation persist + version snapshot: export writes a
  // ci_installations row (agent, repo, target_type, version snapshot, ingest
  // secret HASH — never plaintext), echoed in CiExport.installation WITHOUT
  // the hash; the version snapshotted is the agent's version AT EXPORT TIME.
  // =========================================================================

  it('export persists a ci_installations row with the agent version snapshot and the secret HASH (never plaintext), echoed without the hash (AC-11, AC-18)', async () => {
    const app = await testApp();
    const agent = await createAgent(app, 'Reads Agent AC11 AC18');
    expect(agent.version).toBe(1); // freshly created agent — version snapshot baseline

    const exportRes = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: { repo: 'acme/ac11-repo', target: 'gha', action: 'files' },
    });
    expect(exportRes.statusCode).toBe(200);
    const body = exportRes.json() as {
      installation: { id: string; agent_id: string; repo: string; target_type: string; version: number | null };
      ingest_secret: string;
    };

    // Echoed installation carries the version snapshot (D5) and NO secret-hash
    // field at all — CiInstallation only ever exposes id/agent_id/repo/
    // target_type/installed_at/version/status.
    expect(body.installation.agent_id).toBe(agent.id);
    expect(body.installation.repo).toBe('acme/ac11-repo');
    expect(body.installation.target_type).toBe('gha');
    expect(body.installation.version).toBe(agent.version);
    expect(body.installation).not.toHaveProperty('ingest_secret_hash');
    expect(body.installation).not.toHaveProperty('ingestSecretHash');

    // The freshly issued plaintext secret is returned exactly once, here.
    expect(typeof body.ingest_secret).toBe('string');
    expect(body.ingest_secret.length).toBeGreaterThan(0);

    // Real DB row: a ci_installations row exists, its stored value is a HASH
    // (never equal to the plaintext secret returned above), and it is a
    // 64-hex-char SHA-256 digest, not the raw secret.
    const [row] = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.id, body.installation.id));
    expect(row).toBeDefined();
    expect(row!.agentId).toBe(agent.id);
    expect(row!.version).toBe(agent.version);
    expect(row!.ingestSecretHash).toBeTruthy();
    expect(row!.ingestSecretHash).not.toBe(body.ingest_secret);
    expect(row!.ingestSecretHash).toMatch(/^[0-9a-f]{64}$/);

    // Re-fetching the installation later (a read surface, not the export
    // response) never carries the plaintext secret either.
    const listRes = await app.inject({ method: 'GET', url: `/agents/${agent.id}/ci/installations` });
    expect(listRes.statusCode).toBe(200);
    const installations = listRes.json() as Array<Record<string, unknown>>;
    expect(installations.some((i) => i.id === body.installation.id)).toBe(true);
    for (const inst of installations) {
      expect(inst).not.toHaveProperty('ingest_secret');
      expect(inst).not.toHaveProperty('ingest_secret_hash');
    }

    await app.close();
  });

  it("the installation's version snapshot on the CI tab reflects the agent's version AT EXPORT TIME (AC-18)", async () => {
    const app = await testApp();
    const agent = await createAgent(app, 'Reads Agent AC18 Snapshot');

    const exportRes = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: { repo: 'acme/ac18-repo', target: 'gha', action: 'files' },
    });
    expect(exportRes.statusCode).toBe(200);
    const installationId = (exportRes.json() as { installation: { id: string } }).installation.id;

    const listRes = await app.inject({ method: 'GET', url: `/agents/${agent.id}/ci/installations` });
    expect(listRes.statusCode).toBe(200);
    const installations = listRes.json() as Array<{ id: string; version: number | null }>;
    const installation = installations.find((i) => i.id === installationId);
    expect(installation).toBeDefined();
    expect(installation!.version).toBe(agent.version);

    await app.close();
  });

  // =========================================================================
  // AC-15 — workspace-scoped reads: GET /ci/runs returns only the CALLER
  // workspace's runs; a run belonging to a different workspace is absent.
  // =========================================================================

  it('GET /ci/runs returns only the caller workspace\'s CI runs — a run from a different workspace never appears (AC-15)', async () => {
    const app = await testApp();
    const agent = await createAgent(app, 'Reads Agent AC15');

    const exportRes = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: { repo: 'acme/ac15-repo', target: 'gha', action: 'files' },
    });
    const { installation, ingest_secret: secret } = exportRes.json() as {
      installation: { id: string };
      ingest_secret: string;
    };

    const ingestRes = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { [INGEST_HEADER]: secret },
      payload: {
        installation_id: installation.id,
        pr_number: 901,
        ran_at: '2026-07-14T09:00:00.000Z',
        results: [{ findings_count: 1, cost_usd: 0.01, agent: 'a', pr_number: 901 }],
      },
    });
    expect(ingestRes.statusCode).toBe(200);
    const ownRunId = (ingestRes.json() as Array<{ id: string }>)[0]!.id;

    // A second workspace with its own agent, installation, and ci_runs row,
    // inserted DIRECTLY at the DB layer (mirrors the cross-workspace-probe
    // convention already used by `eval/routes.it.test.ts`) — LocalNoAuthProvider
    // always resolves `app.inject()` calls to the seeded default workspace, so
    // this is the only way to get a guaranteed-foreign-workspace row.
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-ws-ac15-${Date.now()}` })
      .returning();
    const [otherAgent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: otherWs!.id,
        name: 'Foreign CI Agent',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'x',
      })
      .returning();
    const [otherInstallation] = await pg.handle.db
      .insert(t.ciInstallations)
      .values({ agentId: otherAgent!.id, repo: 'foreign/repo', targetType: 'gha', version: 1 })
      .returning();
    const [otherRun] = await pg.handle.db
      .insert(t.ciRuns)
      .values({
        ciInstallationId: otherInstallation!.id,
        prNumber: 902,
        ranAt: new Date('2026-07-14T09:05:00.000Z'),
        status: 'succeeded',
        findingsCount: 3,
        source: 'ci',
      })
      .returning();

    const runsRes = await app.inject({ method: 'GET', url: '/ci/runs' });
    expect(runsRes.statusCode).toBe(200);
    const runs = runsRes.json() as Array<{ id: string }>;

    expect(runs.some((r) => r.id === ownRunId)).toBe(true);
    expect(runs.some((r) => r.id === otherRun!.id)).toBe(false);

    await app.close();
  });

  // =========================================================================
  // AC-17 — a run with findings_count=0 surfaces status 'no_findings', a
  // passing outcome, not a failure.
  // =========================================================================

  it('a CI run with findings_count=0 renders status no_findings (a passing outcome), not a failure (AC-17)', async () => {
    const app = await testApp();
    const agent = await createAgent(app, 'Reads Agent AC17');

    const exportRes = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: { repo: 'acme/ac17-repo', target: 'gha', action: 'files' },
    });
    const { installation, ingest_secret: secret } = exportRes.json() as {
      installation: { id: string };
      ingest_secret: string;
    };

    const ingestRes = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { [INGEST_HEADER]: secret },
      payload: {
        installation_id: installation.id,
        pr_number: 1001,
        ran_at: '2026-07-14T12:00:00.000Z',
        results: [{ findings_count: 0, cost_usd: 0.0, agent: 'clean-agent', pr_number: 1001 }],
      },
    });
    expect(ingestRes.statusCode).toBe(200);
    const ingestedRun = (ingestRes.json() as Array<{ id: string; status: string; findings_count: number }>)[0]!;
    expect(ingestedRun.findings_count).toBe(0);
    expect(ingestedRun.status).toBe('no_findings');

    // Same mapping on the workspace-wide and agent-scoped read surfaces.
    const runsList = (await app.inject({ method: 'GET', url: '/ci/runs' })).json() as Array<{
      id: string;
      status: string;
    }>;
    const foundWorkspaceRun = runsList.find((r) => r.id === ingestedRun.id);
    expect(foundWorkspaceRun).toBeDefined();
    expect(foundWorkspaceRun!.status).toBe('no_findings');

    const agentRunsList = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/ci/runs` })
    ).json() as Array<{ id: string; status: string }>;
    const foundAgentRun = agentRunsList.find((r) => r.id === ingestedRun.id);
    expect(foundAgentRun).toBeDefined();
    expect(foundAgentRun!.status).toBe('no_findings');

    // The installation's derived status (AC-18's "status" column on the CI
    // tab) agrees with the same no_findings mapping.
    const installations = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/ci/installations` })
    ).json() as Array<{ id: string; status: string | null }>;
    const foundInstallation = installations.find((i) => i.id === installation.id);
    expect(foundInstallation).toBeDefined();
    expect(foundInstallation!.status).toBe('no_findings');

    await app.close();
  });
});
