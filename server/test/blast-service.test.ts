import { describe, it, expect } from 'vitest';
import { BlastService } from '../src/modules/blast/service.js';
import { BlastRadiusResult } from '../src/vendor/shared/contracts/brief.js';
import { NotFoundError } from '../src/platform/errors.js';
import type { BlastResult } from '../src/modules/repo-intel/types.js';

/**
 * Hermetic BlastService test — no Postgres, no clone, no real LLM.
 *
 * Exercises the mapping logic that the live "degraded / no_data" path skips:
 * internal BlastResult → HTTP BlastRadiusResult, prior-PR date → ISO string,
 * and the best-effort LLM summary. Each result is parsed against the Zod
 * contract so a shape regression fails the test.
 */

const SAMPLE_BLAST: BlastResult = {
  changedSymbols: [
    { file: 'src/middleware/ratelimit.ts', name: 'rateLimit', kind: 'function' },
  ],
  callers: [
    {
      file: 'src/api/public/webhooks.ts',
      symbol: 'handleWebhook',
      viaSymbol: 'rateLimit',
      line: 42,
      rank: 3,
    },
  ],
  impactedEndpoints: ['POST /webhooks', 'GET /users'],
  factsByFile: {
    'src/api/public/webhooks.ts': { endpoints: ['POST /webhooks'], crons: [] },
  },
};

/** Build a BlastService with its repository + container deps faked. */
function buildService(opts: {
  changedFiles: string[];
  blast?: BlastResult;
  priorPrs?: Array<{
    id: string;
    number: number;
    title: string;
    openedAt: Date | null;
    status: string;
  }>;
  prMissing?: boolean;
  withLlm?: boolean;
}): BlastService {
  const container = {
    // resolveFeatureModel reads settings; [] → falls back to registry default.
    db: {
      select: () => ({ from: () => ({ where: async () => [] }) }),
    },
    repoIntel: {
      getBlastRadius: async () => opts.blast ?? SAMPLE_BLAST,
    },
    llm: async () => ({
      complete: async () => ({ text: '  Impacts the public webhooks path.  ' }),
    }),
  } as never;

  const svc = new BlastService(container);

  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    resolvePrAndRepo: async () =>
      opts.prMissing
        ? { pr: null, repo: null }
        : { pr: { id: 'pr1', repoId: 'repo1' }, repo: { id: 'repo1' } },
    getChangedFilePaths: async () => opts.changedFiles,
    findPriorPrsTouchingSameFiles: async () => opts.priorPrs ?? [],
  };

  // When the LLM should be exercised we keep the mock above; otherwise make the
  // summary path throw so it is swallowed and `summary` stays undefined.
  if (!opts.withLlm) {
    (container as unknown as { llm: unknown }).llm = async () => {
      throw new Error('no llm in this test');
    };
  }

  return svc;
}

describe('BlastService.getForPr', () => {
  it('maps internal blast result to the HTTP contract', async () => {
    const svc = buildService({
      changedFiles: ['src/middleware/ratelimit.ts'],
      priorPrs: [
        {
          id: 'pr-old',
          number: 471,
          title: 'Introduce limiter scaffolding',
          openedAt: new Date('2026-01-15T10:00:00.000Z'),
          status: 'merged',
        },
      ],
      withLlm: true,
    });

    const result = await svc.getForPr('pr1', 'ws1');

    // Conforms to the Zod contract.
    expect(() => BlastRadiusResult.parse(result)).not.toThrow();

    expect(result.changedSymbols).toEqual(SAMPLE_BLAST.changedSymbols);
    expect(result.callers).toEqual(SAMPLE_BLAST.callers);
    expect(result.impactedEndpoints).toEqual(['POST /webhooks', 'GET /users']);
    // Date → ISO string mapping.
    expect(result.priorPrs).toEqual([
      {
        id: 'pr-old',
        number: 471,
        title: 'Introduce limiter scaffolding',
        openedAt: '2026-01-15T10:00:00.000Z',
        status: 'merged',
      },
    ]);
    // Trimmed LLM summary.
    expect(result.summary).toBe('Impacts the public webhooks path.');
  });

  it('returns a degraded no_data result when the PR has no changed files', async () => {
    const svc = buildService({ changedFiles: [] });
    const result = await svc.getForPr('pr1', 'ws1');

    expect(() => BlastRadiusResult.parse(result)).not.toThrow();
    expect(result).toMatchObject({
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: true,
      reason: 'no_data',
    });
  });

  it('still returns (summary omitted) when the LLM call fails', async () => {
    const svc = buildService({
      changedFiles: ['src/middleware/ratelimit.ts'],
      withLlm: false,
    });
    const result = await svc.getForPr('pr1', 'ws1');

    expect(() => BlastRadiusResult.parse(result)).not.toThrow();
    expect(result.summary).toBeUndefined();
    expect(result.changedSymbols).toHaveLength(1);
  });

  it('throws NotFoundError when the PR does not exist', async () => {
    const svc = buildService({ changedFiles: [], prMissing: true });
    await expect(svc.getForPr('missing', 'ws1')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
