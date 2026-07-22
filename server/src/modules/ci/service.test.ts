import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { CiExportInputBody, CiFile, CiInstallation, CiIngestInput } from '@devdigest/shared';
import { CiService } from './service.js';
import { MockGitHubClient } from '../../adapters/mocks.js';
import { ValidationError, NotFoundError, ConfigError } from '../../platform/errors.js';
import type { Container } from '../../platform/container.js';
import type { RequestContext } from '../_shared/context.js';
import type { AgentRow, LinkedSkillRow } from '../agents/repository.js';
import { CI_BRANCH_NAME } from './constants.js';

/**
 * T11 — hermetic unit tests for `CiService` (export/preview/ingest
 * orchestration). No Postgres, no network: `container.agentsRepo` /
 * `container.ciRepo` / `container.db` are hand-built fakes exposing only the
 * properties `CiService` actually reads (established codebase pattern — see
 * `blast/service.test.ts`, `brief/service.test.ts`); `container.github` is
 * the real `MockGitHubClient` test double from `adapters/mocks.ts` (mock at
 * the port, not the network — project convention). The runner-bundle loader
 * is injected as `CiService`'s 2nd constructor arg with a tiny in-memory
 * placeholder, never a real ncc build.
 *
 * Covers AC-5 (transitively, via generate.ts reuse), AC-7, AC-10, AC-24,
 * AC-26, AC-28 for `export`/`previewFiles`, plus the ingest `ran_at`
 * defense-in-depth guard.
 */

const CTX: RequestContext = { workspaceId: 'ws-1', userId: 'user-1' };
const AGENT_ID = 'agent-1';

function makeAgentRow(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: AGENT_ID,
    workspaceId: CTX.workspaceId,
    name: 'Security Reviewer',
    description: '',
    provider: 'openrouter',
    model: 'anthropic/claude-3.5-sonnet',
    systemPrompt: 'Review this PR for security issues.',
    outputSchema: null,
    strategy: 'single-pass',
    ciFailOn: 'critical',
    repoIntel: true,
    enabled: true,
    version: 3,
    createdBy: null,
    attachedDocPaths: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as AgentRow;
}

const RUNNER_FILE: CiFile = {
  path: '.devdigest/runner/index.js',
  contents: '// stub runner bundle — not a real ncc build',
  editable: false,
};

interface FakeCiRepo {
  insertInstallation: ReturnType<typeof vi.fn>;
  getInstallation: ReturnType<typeof vi.fn>;
  ingestResults: ReturnType<typeof vi.fn>;
  listWorkspaceCiRuns: ReturnType<typeof vi.fn>;
  listAgentInstallations: ReturnType<typeof vi.fn>;
  listAgentCiRuns: ReturnType<typeof vi.fn>;
}

interface FakeAgentsRepo {
  getById: ReturnType<typeof vi.fn>;
  linkedSkills: ReturnType<typeof vi.fn>;
}

function makeFakeContainer(opts: {
  agent?: AgentRow | undefined;
  skills?: LinkedSkillRow[];
  github?: MockGitHubClient | (() => Promise<never>);
  dbAgentWorkspaceRow?: { workspaceId: string } | undefined;
}): { container: Container; ciRepo: FakeCiRepo; agentsRepo: FakeAgentsRepo } {
  const agentsRepo: FakeAgentsRepo = {
    getById: vi.fn().mockResolvedValue(opts.agent),
    linkedSkills: vi.fn().mockResolvedValue(opts.skills ?? []),
  };

  const ciRepo: FakeCiRepo = {
    insertInstallation: vi.fn().mockImplementation(
      async (input): Promise<CiInstallation> => ({
        id: 'installation-1',
        agent_id: input.agentId,
        repo: input.repo,
        target_type: input.targetType,
        installed_at: '2026-07-15T00:00:00.000Z',
        version: input.version,
        status: null,
      }),
    ),
    getInstallation: vi.fn(),
    ingestResults: vi.fn().mockResolvedValue([]),
    listWorkspaceCiRuns: vi.fn().mockResolvedValue([]),
    listAgentInstallations: vi.fn().mockResolvedValue([]),
    listAgentCiRuns: vi.fn().mockResolvedValue([]),
  };

  const github =
    typeof opts.github === 'function'
      ? opts.github
      : async () => opts.github ?? new MockGitHubClient();

  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(opts.dbAgentWorkspaceRow ? [opts.dbAgentWorkspaceRow] : []),
      }),
    }),
  };

  const container = {
    agentsRepo,
    ciRepo,
    github,
    db,
  } as unknown as Container;

  return { container, ciRepo, agentsRepo };
}

const BASE_INPUT: CiExportInputBody = {
  repo: 'acme/widgets',
  target: 'gha',
  action: 'open_pr',
  post_as: 'github_review',
  triggers: ['opened', 'synchronize'],
  base: 'main',
};

describe('CiService.export — repo validation (AC-28)', () => {
  it('rejects a malformed `repo` BEFORE any generation, and never calls agentsRepo', async () => {
    const { container, agentsRepo } = makeFakeContainer({ agent: makeAgentRow() });
    const service = new CiService(container, async () => RUNNER_FILE);

    await expect(
      service.export(AGENT_ID, { ...BASE_INPUT, repo: 'foo' }, CTX),
    ).rejects.toThrow(ValidationError);

    // AC-28 observable: no generation happened — the agent was never even loaded.
    expect(agentsRepo.getById).not.toHaveBeenCalled();
  });

  it.each(['a/b/c', '/name', 'owner/', 'owner name/repo'])(
    'rejects %j as not in owner/name form (CiService.assertValidRepo, AC-28)',
    async (badRepo) => {
      const { container, agentsRepo } = makeFakeContainer({ agent: makeAgentRow() });
      const service = new CiService(container, async () => RUNNER_FILE);
      await expect(
        service.export(AGENT_ID, { ...BASE_INPUT, repo: badRepo }, CTX),
      ).rejects.toThrow(ValidationError);
      expect(agentsRepo.getById).not.toHaveBeenCalled();
    },
  );

  it('rejects an empty `repo` string before generation (fails at the CiExportInput schema itself)', async () => {
    // `repo: z.string().min(1)` on the shared contract rejects "" one step
    // earlier than CiService's own owner/name regex check — still "before
    // any generation" per AC-28, just via a ZodError rather than ValidationError.
    const { container, agentsRepo } = makeFakeContainer({ agent: makeAgentRow() });
    const service = new CiService(container, async () => RUNNER_FILE);
    await expect(service.export(AGENT_ID, { ...BASE_INPUT, repo: '' }, CTX)).rejects.toThrow();
    expect(agentsRepo.getById).not.toHaveBeenCalled();
  });
});

describe('CiService.export — agent not found', () => {
  it('throws NotFoundError when the agent does not exist in the workspace', async () => {
    const { container } = makeFakeContainer({ agent: undefined });
    const service = new CiService(container, async () => RUNNER_FILE);
    await expect(service.export(AGENT_ID, BASE_INPUT, CTX)).rejects.toThrow(NotFoundError);
  });
});

describe('CiService.export — open_pr success (AC-7, AC-10, AC-24)', () => {
  it('commits exactly once to devdigest/ci, opens exactly one PR, base untouched, pr_url populated', async () => {
    const github = new MockGitHubClient();
    const { container, ciRepo } = makeFakeContainer({ agent: makeAgentRow(), github });
    const service = new CiService(container, async () => RUNNER_FILE);

    const result = await service.export(AGENT_ID, BASE_INPUT, CTX);

    // AC-10 observable: exactly one commitFiles to `devdigest/ci`, exactly
    // one openPullRequest, and the base branch is never itself the commit
    // target (only ever referenced as the PR's `base`).
    expect(github.committed).toHaveLength(1);
    expect(github.committed[0]!.branch).toBe(CI_BRANCH_NAME);
    expect(github.committed[0]!.base).toBe('main');
    expect(github.openedPrs).toHaveLength(1);
    expect(github.openedPrs[0]!.head).toBe(CI_BRANCH_NAME);
    expect(github.openedPrs[0]!.base).toBe('main');
    expect(result.pr_url).toBe('https://github.com/mock/mock/pull/1');
    expect(result.pr_open_reason).toBeNull();

    // AC-7: the committed files are byte-for-byte the returned files.
    const committedFiles = github.committed[0]!.files;
    expect(committedFiles).toEqual(result.files.map((f) => ({ path: f.path, contents: f.contents })));

    // AC-11/D5: installation persisted with the agent's version snapshot.
    expect(ciRepo.insertInstallation).toHaveBeenCalledTimes(1);
    const insertArgs = ciRepo.insertInstallation.mock.calls[0]![0];
    expect(insertArgs.version).toBe(3);
    expect(insertArgs.repo).toBe('acme/widgets');
    // Only the SHA-256 hash is persisted — never the plaintext secret.
    expect(insertArgs.ingestSecretHash).not.toBe(result.ingest_secret);
    expect(insertArgs.ingestSecretHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never leaks the freshly issued ingest secret into the generated files or the commit payload (AC-24)', async () => {
    const github = new MockGitHubClient();
    const { container } = makeFakeContainer({ agent: makeAgentRow(), github });
    const service = new CiService(container, async () => RUNNER_FILE);

    const result = await service.export(AGENT_ID, BASE_INPUT, CTX);
    expect(result.ingest_secret).toMatch(/^[0-9a-f]{64}$/);

    const filesBlob = JSON.stringify(result.files);
    expect(filesBlob).not.toContain(result.ingest_secret!);

    const committedBlob = JSON.stringify(github.committed);
    expect(committedBlob).not.toContain(result.ingest_secret!);
  });
});

describe('CiService.export — degradation, never a throw (AC-26)', () => {
  it('degrades to pr_url=null + reason="github_token_missing" when container.github() throws ConfigError', async () => {
    const { container, ciRepo } = makeFakeContainer({
      agent: makeAgentRow(),
      github: async () => {
        throw new ConfigError('GITHUB_TOKEN is not configured');
      },
    });
    const service = new CiService(container, async () => RUNNER_FILE);

    const result = await service.export(AGENT_ID, BASE_INPUT, CTX);

    expect(result.pr_url).toBeNull();
    expect(result.pr_open_reason).toBe('github_token_missing');
    // Files are still generated and returned even in the degraded path — the
    // zip-fallback install step relies on this (AC-12).
    expect(result.files.length).toBeGreaterThan(0);
    // The installation is still persisted (AC-11) — the export itself did not fail.
    expect(ciRepo.insertInstallation).toHaveBeenCalledTimes(1);
  });

  it('degrades to pr_url=null + reason="github_api_error" on a generic GitHub API failure, never throwing', async () => {
    // Real `MockGitHubClient` instance, stubbed at the one method under test
    // via `vi.spyOn` — avoids the unchecked `as unknown as MockGitHubClient`
    // double assertion a hand-built partial object would need, and still
    // exercises the actual class (structurally guaranteed to implement
    // `GitHubClient`) rather than a loosely-typed stand-in.
    const failingGithub = new MockGitHubClient();
    const commitFilesSpy = vi
      .spyOn(failingGithub, 'commitFiles')
      .mockRejectedValue(new Error('GitHub API rate limited'));
    const openPullRequestSpy = vi.spyOn(failingGithub, 'openPullRequest');

    const { container } = makeFakeContainer({ agent: makeAgentRow(), github: failingGithub });
    const service = new CiService(container, async () => RUNNER_FILE);

    await expect(service.export(AGENT_ID, BASE_INPUT, CTX)).resolves.toMatchObject({
      pr_url: null,
      pr_open_reason: 'github_api_error',
    });
    expect(commitFilesSpy).toHaveBeenCalledTimes(1);
    // openPullRequest must never be called once commitFiles has already failed.
    expect(openPullRequestSpy).not.toHaveBeenCalled();
  });
});

describe('CiService.previewFiles — no side effects, byte parity with export (AC-7, AC-12)', () => {
  it('returns the SAME files export() would ship, with no installation insert and no GitHub call', async () => {
    const github = new MockGitHubClient();
    const { container, ciRepo } = makeFakeContainer({ agent: makeAgentRow(), github });
    const service = new CiService(container, async () => RUNNER_FILE);

    const previewed = await service.previewFiles(AGENT_ID, BASE_INPUT, CTX);

    // No side effects at all — this is a pure preview.
    expect(ciRepo.insertInstallation).not.toHaveBeenCalled();
    expect(github.committed).toHaveLength(0);
    expect(github.openedPrs).toHaveLength(0);

    // Byte parity: a subsequent export() with the identical input produces
    // the identical file contents (buildBundle is pure — only the ingest
    // secret differs between calls, which is not part of `files`).
    const exported = await service.export(AGENT_ID, BASE_INPUT, CTX);
    expect(exported.files).toEqual(previewed);
  });

  it('still validates repo shape before generating anything (AC-28)', async () => {
    const { container, agentsRepo } = makeFakeContainer({ agent: makeAgentRow() });
    const service = new CiService(container, async () => RUNNER_FILE);
    await expect(
      service.previewFiles(AGENT_ID, { ...BASE_INPUT, repo: 'foo' }, CTX),
    ).rejects.toThrow(ValidationError);
    expect(agentsRepo.getById).not.toHaveBeenCalled();
  });
});

describe('CiService.ingest — ran_at defense-in-depth guard', () => {
  const INSTALLATION_ID = 'installation-1';
  const SECRET = 'a-very-high-entropy-secret';

  function hashOf(secret: string): string {
    // Mirrors service.ts's own hashing so the fixture's stored hash matches.
    return createHash('sha256').update(secret, 'utf8').digest('hex');
  }

  it('rejects a non-ISO ran_at with a ValidationError BEFORE any repository write', async () => {
    const { container, ciRepo } = makeFakeContainer({
      agent: makeAgentRow(),
      dbAgentWorkspaceRow: { workspaceId: CTX.workspaceId },
    });
    ciRepo.getInstallation.mockResolvedValue({
      id: INSTALLATION_ID,
      agentId: AGENT_ID,
      repo: 'acme/widgets',
      targetType: 'gha',
      installedAt: '2026-07-15T00:00:00.000Z',
      ingestSecretHash: hashOf(SECRET),
      version: 1,
    });
    const service = new CiService(container, async () => RUNNER_FILE);

    // The contract's own `z.string().datetime()` would normally catch this at
    // the route boundary — this exercises the SERVICE's own defense-in-depth
    // guard directly, simulating a stale client that bypasses the contract.
    const badInput = {
      installation_id: INSTALLATION_ID,
      pr_number: 42,
      ran_at: 'not-a-real-timestamp',
      results: [{ findings_count: 0, cost_usd: null, agent: 'Security Reviewer' }],
    } as unknown as CiIngestInput;

    await expect(service.ingest(INSTALLATION_ID, 42, badInput, SECRET, CTX)).rejects.toThrow(
      ValidationError,
    );
    expect(ciRepo.ingestResults).not.toHaveBeenCalled();
  });
});
