/* routes.test.ts — hermetic Fastify `inject` tests for `POST /ci/ingest`.
 *
 * Follows the established lightweight-app pattern (`brief/routes.test.ts`):
 * register ONLY `ciRoutes` on a bare Fastify instance with the zod
 * validator/serializer compilers wired, and decorate `container` with a
 * hand-built fake exposing only the properties the route/service touch
 * (`ciRepo.getInstallation` / `.ingestResults`) — never a real Postgres
 * connection, never the network. Covers AC-22 (malformed payload -> 4xx, no
 * write) and AC-25 (missing/wrong per-installation secret -> 401, no write).
 */
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import ciRoutes from './routes.js';
import type { CiInstallationRecord, CiRepository } from './repository.js';
import type { Container } from '../../platform/container.js';

const INSTALLATION_ID = 'installation-1';
const CORRECT_SECRET = 'correct-horse-battery-staple';
const SECRET_HEADER = 'x-devdigest-ingest-secret';

function hashOf(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

function makeInstallationRecord(overrides: Partial<CiInstallationRecord> = {}): CiInstallationRecord {
  return {
    id: INSTALLATION_ID,
    agentId: 'agent-1',
    repo: 'acme/widgets',
    targetType: 'gha',
    installedAt: '2026-07-15T00:00:00.000Z',
    ingestSecretHash: hashOf(CORRECT_SECRET),
    version: 1,
    ...overrides,
  };
}

/** Purpose-built fake shape for `app.container` — only the two properties
 *  `ci/routes.ts` -> `CiService.ingest` actually reads (mirrors the
 *  established hermetic-container-fake pattern used across the codebase, see
 *  `service.test.ts`/`blast/service.test.ts`). `ciRepo`'s two methods are
 *  typed via `CiRepository[...]` indexed access so a signature drift on the
 *  real repository is still caught here, rather than escaping via `as never`.
 *  `db` only needs the narrow `select().from().where()` chain
 *  `resolveAgentWorkspace` calls — deliberately NOT typed against the real
 *  (much wider) `Db` type, so the single `as unknown as Container` cast below
 *  is the one, explicit, justified escape hatch instead of a blanket one. */
interface FakeContainer {
  ciRepo: {
    getInstallation: CiRepository['getInstallation'];
    ingestResults: CiRepository['ingestResults'];
  };
  db: {
    select: () => { from: () => { where: () => Promise<{ workspaceId: string }[]> } };
  };
}

async function buildTestApp(opts: {
  getInstallation?: ReturnType<typeof vi.fn>;
  ingestResults?: ReturnType<typeof vi.fn>;
}) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  const ciRepo = {
    getInstallation: opts.getInstallation ?? vi.fn().mockResolvedValue(makeInstallationRecord()),
    ingestResults: opts.ingestResults ?? vi.fn().mockResolvedValue([]),
  };
  // `CiService.ingest`'s `resolveAgentWorkspace` reads `container.db.select(...)
  // .from(...).where(...)` directly (see service.ts) to resolve tenancy once
  // auth succeeds — fake the same chain shape as the established
  // `blast/service.test.ts`/`brief/service.test.ts` fake-db precedent.
  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ workspaceId: 'ws-1' }]),
      }),
    }),
  };
  const fakeContainer: FakeContainer = { ciRepo, db };
  app.decorate('container', fakeContainer as unknown as Container);
  await app.register(ciRoutes);
  await app.ready();
  return { app, ciRepo };
}

const VALID_BODY = {
  installation_id: INSTALLATION_ID,
  pr_number: 42,
  ran_at: '2026-07-15T12:00:00.000Z',
  results: [{ findings_count: 0, cost_usd: 0.05, agent: 'Security Reviewer' }],
};

describe('POST /ci/ingest — malformed payload (AC-22)', () => {
  it('rejects a body missing `results` with a 4xx and writes nothing', async () => {
    const { app, ciRepo } = await buildTestApp({});
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/ci/ingest',
        headers: { [SECRET_HEADER]: CORRECT_SECRET },
        payload: { installation_id: INSTALLATION_ID, ran_at: VALID_BODY.ran_at },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
      expect(ciRepo.getInstallation).not.toHaveBeenCalled();
      expect(ciRepo.ingestResults).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects an empty `results` array (min(1) violation) with a 4xx and writes nothing', async () => {
    const { app, ciRepo } = await buildTestApp({});
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/ci/ingest',
        headers: { [SECRET_HEADER]: CORRECT_SECRET },
        payload: { ...VALID_BODY, results: [] },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
      expect(ciRepo.ingestResults).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects a non-ISO-8601 `ran_at` at the contract boundary with a 4xx and writes nothing', async () => {
    const { app, ciRepo } = await buildTestApp({});
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/ci/ingest',
        headers: { [SECRET_HEADER]: CORRECT_SECRET },
        payload: { ...VALID_BODY, ran_at: 'yesterday' },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
      expect(ciRepo.ingestResults).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

describe('POST /ci/ingest — auth (AC-25)', () => {
  it('rejects a request with NO secret header — 401, no write', async () => {
    const { app, ciRepo } = await buildTestApp({});
    try {
      const res = await app.inject({ method: 'POST', url: '/ci/ingest', payload: VALID_BODY });
      expect(res.statusCode).toBe(401);
      expect(ciRepo.ingestResults).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects a request with the WRONG secret — 401, no write', async () => {
    const { app, ciRepo } = await buildTestApp({});
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/ci/ingest',
        headers: { [SECRET_HEADER]: 'totally-wrong-secret' },
        payload: VALID_BODY,
      });
      expect(res.statusCode).toBe(401);
      expect(ciRepo.ingestResults).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects a request for an unknown installation — 401, no write, same status as wrong secret (no enumeration)', async () => {
    const { app, ciRepo } = await buildTestApp({ getInstallation: vi.fn().mockResolvedValue(undefined) });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/ci/ingest',
        headers: { [SECRET_HEADER]: CORRECT_SECRET },
        payload: VALID_BODY,
      });
      expect(res.statusCode).toBe(401);
      expect(ciRepo.ingestResults).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('accepts a request with the CORRECT secret and scopes the write to that installation', async () => {
    const { app, ciRepo } = await buildTestApp({});
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/ci/ingest',
        headers: { [SECRET_HEADER]: CORRECT_SECRET },
        payload: VALID_BODY,
      });
      expect(res.statusCode).toBe(200);
      expect(ciRepo.ingestResults).toHaveBeenCalledTimes(1);
      const [installationArg] = ciRepo.ingestResults.mock.calls[0]!;
      expect(installationArg.id).toBe(INSTALLATION_ID);
    } finally {
      await app.close();
    }
  });
});
