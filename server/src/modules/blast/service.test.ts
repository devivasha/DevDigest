/**
 * blast/service.test.ts — hermetic unit test (NOT *.it.test.ts, no real Postgres).
 *
 * Verifies the facade (camelCase `BlastResult`) -> contract (snake_case
 * `BlastResponse`) mapping across the persistent, degraded, and empty index
 * paths, the prior-PRs history query mapping, and the zero-LLM guarantee
 * (the service never touches an LLM provider — `summary` is a deterministic
 * interpolated string).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BlastService } from './service.js';
import { MockLLMProvider } from '../../adapters/mocks.js';
import { MAX_CALLERS_PER_SYMBOL } from '../repo-intel/constants.js';
import type { BlastResult, IndexState, RepoIntel } from '../repo-intel/types.js';
import type { Container } from '../../platform/container.js';
import type { Db } from '../../db/client.js';

afterEach(() => vi.restoreAllMocks());

/** Minimal PR row (only the fields BlastService reads). */
function makePr(overrides: Partial<{ id: string; repoId: string; workspaceId: string }> = {}) {
  return {
    id: overrides.id ?? 'pr-1',
    workspaceId: overrides.workspaceId ?? 'ws-1',
    repoId: overrides.repoId ?? 'repo-1',
    number: 42,
    title: 'Add rate limiting',
    author: 'marisa.koch',
    branch: 'feat/rate-limit',
    base: 'main',
    headSha: 'a1b2c3d4',
    lastReviewedSha: null,
    additions: 10,
    deletions: 2,
    filesCount: 1,
    status: 'needs_review',
    body: null,
    openedAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-02T00:00:00Z'),
  } as unknown as Parameters<BlastService['getBlast']>[1];
}

/** Build a mock RepoIntel returning caller-supplied BlastResult/IndexState fixtures. */
function makeRepoIntel(blast: BlastResult, state: IndexState): RepoIntel {
  return {
    indexRepo: vi.fn(),
    refreshIndex: vi.fn(),
    getIndexState: vi.fn().mockResolvedValue(state),
    getBlastRadius: vi.fn().mockResolvedValue(blast),
    getRepoMap: vi.fn(),
    getFileRank: vi.fn(),
    getSymbolsInFiles: vi.fn(),
    getCallerSignatures: vi.fn(),
    getUnresolvedReferences: vi.fn(),
    getConventionSamples: vi.fn(),
    getTopFilesByRank: vi.fn(),
    getCriticalPaths: vi.fn(),
  } as unknown as RepoIntel;
}

/** Prior-PR history row as returned by the join query (one row per overlapping file). */
function historyRow(
  prId: string,
  overrides: Partial<{
    number: number;
    title: string;
    author: string;
    openedAt: Date | null;
    updatedAt: Date | null;
    path: string;
  }> = {},
) {
  return {
    id: prId,
    number: overrides.number ?? 10,
    title: overrides.title ?? 'Earlier change',
    author: overrides.author ?? 'other.dev',
    openedAt: overrides.openedAt ?? new Date('2026-04-01T00:00:00Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-04-02T00:00:00Z'),
    path: overrides.path ?? 'src/shared/helper.ts',
  };
}

/** Fake drizzle DB — supports the `select({...}).from().innerJoin().where().orderBy()` chain. */
function makeDb(historyRows: ReturnType<typeof historyRow>[]): Db {
  const chain = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue(historyRows),
  };
  return { select: vi.fn().mockReturnValue(chain) } as unknown as Db;
}

/** Build a fake Container exposing exactly what BlastService touches. */
function makeContainer(
  repoIntel: RepoIntel,
  db: Db,
  llm: MockLLMProvider,
): Container {
  return {
    db,
    repoIntel,
    llm: vi.fn().mockResolvedValue(llm),
  } as unknown as Container;
}

const fullState = (overrides: Partial<IndexState> = {}): IndexState => ({
  repoId: 'repo-1',
  status: 'full',
  filesIndexed: 100,
  filesSkipped: 0,
  durationMs: 500,
  lastIndexedSha: 'abc123',
  indexerVersion: 2,
  updatedAt: new Date('2026-06-01T00:00:00Z'),
  degraded: false,
  ...overrides,
});

describe('BlastService.getBlast', () => {
  it('maps the persistent path: groups callers by viaSymbol, caps at MAX_CALLERS_PER_SYMBOL, populates per-symbol + top-level endpoints/crons', async () => {
    const manyCallers = Array.from({ length: MAX_CALLERS_PER_SYMBOL + 5 }, (_, i) => ({
      file: `src/callers/caller${i}.ts`,
      symbol: `caller${i}`,
      viaSymbol: 'rateLimit',
      line: i + 1,
      rank: MAX_CALLERS_PER_SYMBOL + 5 - i, // already rank-sorted DESC
    }));

    const blast: BlastResult = {
      changedSymbols: [
        { file: 'src/shared/helper.ts', name: 'rateLimit', kind: 'function' },
        { file: 'src/shared/helper.ts', name: 'unusedHelper', kind: 'function' },
      ],
      callers: manyCallers,
      impactedEndpoints: ['GET /api/public', 'GET /api/public'], // duplicate to verify dedupe
      factsByFile: Object.fromEntries(
        manyCallers.map((c) => [c.file, { endpoints: ['GET /api/public'], crons: ['nightly-sync'] }]),
      ),
      degraded: false,
    };

    const llm = new MockLLMProvider();
    const db = makeDb([]);
    const repoIntel = makeRepoIntel(blast, fullState());
    const container = makeContainer(repoIntel, db, llm);
    const service = new BlastService(container);

    const result = await service.getBlast('ws-1', makePr(), ['src/shared/helper.ts']);

    expect(result.changed_symbols).toEqual([
      { name: 'rateLimit', file: 'src/shared/helper.ts', kind: 'function' },
      { name: 'unusedHelper', file: 'src/shared/helper.ts', kind: 'function' },
    ]);

    // Every changed symbol appears in `downstream`, including the one with 0 callers.
    expect(result.downstream).toHaveLength(2);
    const rateLimitRow = result.downstream.find((d) => d.symbol === 'rateLimit')!;
    const unusedRow = result.downstream.find((d) => d.symbol === 'unusedHelper')!;

    // Capped at MAX_CALLERS_PER_SYMBOL, NOT re-sorted (already rank order from the facade).
    expect(rateLimitRow.callers).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(rateLimitRow.callers[0]).toEqual({ name: 'caller0', file: 'src/callers/caller0.ts', line: 1 });
    expect(rateLimitRow.endpoints_affected).toEqual(['GET /api/public']);
    expect(rateLimitRow.crons_affected).toEqual(['nightly-sync']);

    expect(unusedRow.callers).toHaveLength(0);
    expect(unusedRow.endpoints_affected).toEqual([]);
    expect(unusedRow.crons_affected).toEqual([]);

    // Top-level unions: endpoints + crons unioned from the (non-test) caller files' facts, deduped.
    expect(result.impacted_endpoints).toEqual(['GET /api/public']);
    expect(result.impacted_crons).toEqual(['nightly-sync']);

    expect(result.status).toBe('full');
    expect(result.degraded).toBe(false);
    expect(result.degraded_reason).toBeUndefined();
    expect(result.summary).toBe(
      `2 symbol(s) changed, ${MAX_CALLERS_PER_SYMBOL} downstream caller(s), 1 endpoint(s) impacted.`,
    );

    // Zero-LLM guarantee.
    expect(llm.calls).toHaveLength(0);
  });

  it('excludes test-file callers (and their endpoints/crons) from downstream and top-level unions', async () => {
    const blast: BlastResult = {
      changedSymbols: [{ file: 'src/db/seed.ts', name: 'seed', kind: 'function' }],
      callers: [
        { file: 'src/api/bootstrap.ts', symbol: 'bootstrap', viaSymbol: 'seed', line: 5, rank: 3 },
        { file: 'server/test/reviews.it.test.ts', symbol: 'setup', viaSymbol: 'seed', line: 105, rank: 2 },
        { file: 'src/api/__tests__/seed.spec.ts', symbol: 'spec', viaSymbol: 'seed', line: 3, rank: 1 },
      ],
      impactedEndpoints: ['GET /prod', 'POST /test-only', 'GET /also-test'],
      factsByFile: {
        'src/api/bootstrap.ts': { endpoints: ['GET /prod'], crons: ['nightly'] },
        'server/test/reviews.it.test.ts': { endpoints: ['POST /test-only'], crons: ['test-cron'] },
        'src/api/__tests__/seed.spec.ts': { endpoints: ['GET /also-test'], crons: [] },
      },
      degraded: false,
    };

    const llm = new MockLLMProvider();
    const db = makeDb([]);
    const repoIntel = makeRepoIntel(blast, fullState());
    const container = makeContainer(repoIntel, db, llm);
    const service = new BlastService(container);

    const result = await service.getBlast('ws-1', makePr(), ['src/db/seed.ts']);

    const row = result.downstream.find((d) => d.symbol === 'seed')!;
    // Only the production caller survives — `.it.test.ts` and `__tests__/*.spec.ts` are dropped.
    expect(row.callers).toEqual([{ name: 'bootstrap', file: 'src/api/bootstrap.ts', line: 5 }]);
    expect(row.endpoints_affected).toEqual(['GET /prod']);
    expect(row.crons_affected).toEqual(['nightly']);

    // Top-level unions carry only the production file's facts — no test fixtures leak in.
    expect(result.impacted_endpoints).toEqual(['GET /prod']);
    expect(result.impacted_crons).toEqual(['nightly']);
    expect(result.summary).toBe('1 symbol(s) changed, 1 downstream caller(s), 1 endpoint(s) impacted.');

    expect(llm.calls).toHaveLength(0);
  });

  it('maps the degraded/ripgrep path: factsByFile absent -> per-symbol endpoints/crons empty, but top-level impacted_endpoints stays populated from the flat union', async () => {
    const blast: BlastResult = {
      changedSymbols: [{ file: 'src/shared/helper.ts', name: 'rateLimit', kind: 'function' }],
      callers: [
        { file: 'src/api/public.ts', symbol: 'handler', viaSymbol: 'rateLimit', line: 12, rank: 0 },
      ],
      impactedEndpoints: ['GET /api/public'],
      // factsByFile intentionally absent — the degraded/ripgrep path.
      degraded: true,
      reason: 'no_data',
    };
    const state: IndexState = fullState({ status: 'degraded', degraded: true, degradedReason: 'index_partial' });

    const llm = new MockLLMProvider();
    const db = makeDb([]);
    const repoIntel = makeRepoIntel(blast, state);
    const container = makeContainer(repoIntel, db, llm);
    const service = new BlastService(container);

    const result = await service.getBlast('ws-1', makePr(), ['src/shared/helper.ts']);

    expect(result.status).toBe('degraded');
    expect(result.degraded).toBe(true);
    // BlastResult.reason wins over IndexState.degradedReason.
    expect(result.degraded_reason).toBe('no_data');

    const row = result.downstream[0]!;
    expect(row.callers).toHaveLength(1);
    expect(row.endpoints_affected).toEqual([]);
    expect(row.crons_affected).toEqual([]);

    // Top-level counts still populate from the flat impactedEndpoints.
    expect(result.impacted_endpoints).toEqual(['GET /api/public']);
    expect(result.impacted_crons).toEqual([]);

    expect(llm.calls).toHaveLength(0);
  });

  it('maps the empty path: no changed symbols -> empty arrays + deterministic summary', async () => {
    const blast: BlastResult = {
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: false,
    };

    const llm = new MockLLMProvider();
    const db = makeDb([]);
    const repoIntel = makeRepoIntel(blast, fullState());
    const container = makeContainer(repoIntel, db, llm);
    const service = new BlastService(container);

    const result = await service.getBlast('ws-1', makePr(), []);

    expect(result.changed_symbols).toEqual([]);
    expect(result.downstream).toEqual([]);
    expect(result.impacted_endpoints).toEqual([]);
    expect(result.impacted_crons).toEqual([]);
    expect(result.history).toEqual([]);
    expect(result.summary).toBe('0 symbol(s) changed, 0 downstream caller(s), 0 endpoint(s) impacted.');

    expect(llm.calls).toHaveLength(0);
  });

  it('maps prior-PR history: groups overlapping-file rows per PR, orders most-recent-first, caps at 10', async () => {
    const rows = [
      historyRow('pr-a', { number: 20, title: 'Touch A', path: 'src/shared/helper.ts', updatedAt: new Date('2026-05-10') }),
      historyRow('pr-a', { number: 20, title: 'Touch A', path: 'src/other.ts', updatedAt: new Date('2026-05-10') }),
      historyRow('pr-b', { number: 15, title: 'Touch B', path: 'src/shared/helper.ts', updatedAt: new Date('2026-04-01'), openedAt: new Date('2026-03-20') }),
    ];

    const blast: BlastResult = { changedSymbols: [], callers: [], impactedEndpoints: [], degraded: false };
    const llm = new MockLLMProvider();
    const db = makeDb(rows);
    const repoIntel = makeRepoIntel(blast, fullState());
    const container = makeContainer(repoIntel, db, llm);
    const service = new BlastService(container);

    const result = await service.getBlast('ws-1', makePr(), ['src/shared/helper.ts', 'src/other.ts']);

    expect(result.history).toHaveLength(2);
    expect(result.history[0]).toEqual({
      pr_number: 20,
      title: 'Touch A',
      merged_at: new Date('2026-05-10').toISOString(),
      author: 'other.dev',
      files_overlap: ['src/shared/helper.ts', 'src/other.ts'],
      notes: '',
    });
    expect(result.history[1]!.pr_number).toBe(15);

    expect(llm.calls).toHaveLength(0);
  });

  it('skips the history query entirely when there are no changed paths', async () => {
    const blast: BlastResult = { changedSymbols: [], callers: [], impactedEndpoints: [], degraded: false };
    const llm = new MockLLMProvider();
    const db = makeDb([]);
    const repoIntel = makeRepoIntel(blast, fullState());
    const container = makeContainer(repoIntel, db, llm);
    const service = new BlastService(container);

    const result = await service.getBlast('ws-1', makePr(), []);

    expect(result.history).toEqual([]);
    expect((db.select as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
