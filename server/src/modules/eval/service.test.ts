/**
 * service.test.ts — hermetic unit test for `EvalService` (L06, T7/T16).
 *
 * No Docker, no real Postgres, no live LLM. The LLM is stubbed at the PORT
 * level (`LLMProvider` — `MockLLMProvider` from `src/adapters/mocks.ts`, plus
 * two small prompt-dependent doubles for the AC-16 sensitivity/broken-prompt
 * scenarios, since `MockLLMProvider` itself does not vary its fixture by
 * prompt content). `Container`/`EvalRepository` are hand-built fakes exposing
 * only the surface `EvalService` actually touches (the established pattern in
 * this codebase — see `blast/service.test.ts`), cast `as unknown as Container`
 * / `as unknown as EvalRepository`.
 *
 * METHODOLOGY: expected outcomes are derived from the spec ACs (AC-1..AC-4,
 * AC-7, AC-8, AC-11, AC-12, AC-16, AC-17, AC-18, AC-24) and the plan's pinned
 * metric semantics (finding #2: precision over producedAll, citation over
 * kept/dropped) — NOT from reading service.ts's implementation and recording
 * what it happens to return. service.ts/repository.ts/scorer.ts were read
 * only to learn exact import paths, method signatures, and row shapes.
 */
import { describe, it, expect, vi } from 'vitest';
import type { z } from 'zod';
import type {
  ChatMessage,
  EvalCase,
  EvalCaseInput,
  EvalCaseStatus,
  EvalExpectation,
  LLMProvider,
  Review,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { FindingRow, PullRow } from '../../db/rows.js';
import { NotFoundError } from '../../platform/errors.js';
import { MockLLMProvider } from '../../adapters/mocks.js';
import { EvalService } from './service.js';
import type {
  InsertCaseRunRow,
  InsertSetRunRow,
  SetRunAggregatePatch,
  UpdateEvalCaseInput,
} from './repository.js';

// ---------------------------------------------------------------------------
// A diff whose only hunk covers new-side lines 10-12 of src/config.ts (same
// fixture shape as test/reviews.it.test.ts, confirmed by server INSIGHTS.md
// to keep a finding at line 11/12 and drop one at line 999).
// ---------------------------------------------------------------------------
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** A diff with no recognizable diff markers — triggers the AC-17 degraded path. */
const UNPARSEABLE_DIFF = '';

/** A diff whose content carries a marker string, used to trigger a simulated
 *  provider outage for exactly one case (AC-18). */
const TRIGGER_ERROR_DIFF = `diff --git a/src/trigger.ts b/src/trigger.ts
--- a/src/trigger.ts
+++ b/src/trigger.ts
@@ -1,1 +1,2 @@
 TRIGGER_ERROR_MARKER context line
+added line`;

const WS = 'ws-1';
const AGENT_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_AGENT_ID = '22222222-2222-2222-2222-222222222222';

// ---------------------------------------------------------------------------
// Row fixtures (only fields EvalService reads)
// ---------------------------------------------------------------------------

function makeFindingRow(overrides: Partial<FindingRow> = {}): FindingRow {
  return {
    id: 'finding-1',
    reviewId: 'review-1',
    file: 'src/config.ts',
    startLine: 11,
    endLine: 11,
    severity: 'CRITICAL',
    category: 'security',
    title: 'Hardcoded Stripe secret key',
    rationale: 'A live key is committed in source.',
    suggestion: null,
    confidence: 0.9,
    kind: 'finding',
    trifectaComponents: null,
    acceptedAt: null,
    dismissedAt: null,
    ...overrides,
  } as unknown as FindingRow;
}

function makeReviewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'review-1',
    workspaceId: WS,
    prId: 'pr-1',
    agentId: AGENT_ID,
    runId: null,
    kind: 'review',
    verdict: 'comment',
    summary: '',
    score: 90,
    model: 'gpt-4.1',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

function makePullRow(overrides: Partial<PullRow> = {}): PullRow {
  return {
    id: 'pr-1',
    workspaceId: WS,
    repoId: 'repo-1',
    number: 482,
    title: 'Add rate limiting',
    author: 'marisa.koch',
    branch: 'feat/rl',
    base: 'main',
    headSha: 'a1b2c3d4',
    lastReviewedSha: null,
    additions: 1,
    deletions: 0,
    filesCount: 1,
    status: 'needs_review',
    body: null,
    openedAt: null,
    updatedAt: null,
    ...overrides,
  } as unknown as PullRow;
}

function makeRepoRow(overrides: Record<string, unknown> = {}) {
  return { id: 'repo-1', workspaceId: WS, owner: 'acme', name: 'app', fullName: 'acme/app', ...overrides };
}

function makeAgentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: AGENT_ID,
    workspaceId: WS,
    provider: 'openai' as const,
    model: 'gpt-4.1',
    systemPrompt: 'You are a reviewer.',
    version: 1,
    strategy: 'single-pass' as const,
    ...overrides,
  };
}

function mustFindExpectation(overrides: Partial<EvalExpectation['findings'][number]> = {}): EvalExpectation {
  return {
    kind: 'must_find',
    findings: [
      {
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
        severity: 'CRITICAL',
        category: 'security',
        title: 'secret',
        ...overrides,
      },
    ],
  };
}

function mustNotFlagExpectation(
  overrides: Partial<EvalExpectation['findings'][number]> = {},
): EvalExpectation {
  return {
    kind: 'must_not_flag',
    findings: [
      {
        file: 'src/config.ts',
        start_line: 12,
        end_line: 12,
        severity: 'SUGGESTION',
        category: 'style',
        title: 'do not flag',
        ...overrides,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// FakeEvalRepo — in-memory double of EvalRepository's public surface. Tracks
// `workspaceId` per stored row (mirroring the real repository's tenancy
// columns) even though the DTOs returned to callers omit it.
// ---------------------------------------------------------------------------

interface StoredCase {
  workspaceId: string;
  row: EvalCase;
}
interface StoredSetRun {
  workspaceId: string;
  id: string;
  ownerKind: string;
  ownerId: string;
  agentVersion: number | null;
  systemPrompt: string | null;
  model: string | null;
  recall: number;
  precision: number;
  citationAccuracy: number | null;
  tracesPassed: number;
  tracesTotal: number;
  durationMs: number | null;
  costUsd: number | null;
  underMin: boolean;
}

class FakeEvalRepo {
  private caseSeq = 0;
  private setRunSeq = 0;
  private caseRunSeq = 0;

  cases: StoredCase[] = [];
  setRunRows: StoredSetRun[] = [];
  /** Every persisted per-case run row, in insertion order. */
  caseRuns: (InsertCaseRunRow & { id: string; caseName: string | null })[] = [];

  async listCasesByOwner(workspaceId: string, ownerKind: string, ownerId: string): Promise<EvalCase[]> {
    return this.cases
      .filter((c) => c.workspaceId === workspaceId && c.row.owner_kind === ownerKind && c.row.owner_id === ownerId)
      .map((c) => c.row);
  }

  async getCase(workspaceId: string, caseId: string): Promise<EvalCase | undefined> {
    return this.cases.find((c) => c.workspaceId === workspaceId && c.row.id === caseId)?.row;
  }

  async createCase(workspaceId: string, input: EvalCaseInput): Promise<EvalCase> {
    this.caseSeq += 1;
    const row: EvalCase = {
      id: `case-${this.caseSeq}`,
      owner_kind: input.owner_kind,
      owner_id: input.owner_id,
      name: input.name,
      input_diff: input.input_diff,
      input_files: input.input_files ?? null,
      input_meta: input.input_meta ?? null,
      expected_output: input.expected_output,
      notes: input.notes ?? null,
    };
    this.cases.push({ workspaceId, row });
    return row;
  }

  async updateCase(workspaceId: string, caseId: string, patch: UpdateEvalCaseInput): Promise<EvalCase | undefined> {
    const entry = this.cases.find((c) => c.workspaceId === workspaceId && c.row.id === caseId);
    if (!entry) return undefined;
    entry.row = { ...entry.row, ...patch } as EvalCase;
    return entry.row;
  }

  async deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    const before = this.cases.length;
    this.cases = this.cases.filter((c) => !(c.workspaceId === workspaceId && c.row.id === caseId));
    return this.cases.length < before;
  }

  async insertSetRun(workspaceId: string, row: InsertSetRunRow): Promise<string> {
    this.setRunSeq += 1;
    const id = `setrun-${this.setRunSeq}`;
    this.setRunRows.push({
      workspaceId,
      id,
      ownerKind: row.ownerKind,
      ownerId: row.ownerId,
      agentVersion: row.agentVersion,
      systemPrompt: row.systemPrompt,
      model: row.model,
      recall: 0,
      precision: 0,
      citationAccuracy: null,
      tracesPassed: 0,
      tracesTotal: 0,
      durationMs: null,
      costUsd: null,
      underMin: false,
    });
    return id;
  }

  async updateSetRunAggregate(
    workspaceId: string,
    setRunId: string,
    patch: SetRunAggregatePatch,
  ): Promise<StoredSetRun | undefined> {
    const entry = this.setRunRows.find((s) => s.workspaceId === workspaceId && s.id === setRunId);
    if (!entry) return undefined;
    entry.recall = patch.recall;
    entry.precision = patch.precision;
    entry.citationAccuracy = patch.citationAccuracy;
    entry.tracesPassed = patch.tracesPassed;
    entry.tracesTotal = patch.tracesTotal;
    entry.durationMs = patch.durationMs;
    entry.costUsd = patch.costUsd;
    entry.underMin = patch.underMin;
    return entry;
  }

  async insertCaseRun(row: InsertCaseRunRow, caseName: string | null = null) {
    this.caseRunSeq += 1;
    const id = `caserun-${this.caseRunSeq}`;
    this.caseRuns.push({ ...row, id, caseName });
    return {
      id,
      case_id: row.caseId,
      case_name: caseName,
      ran_at: new Date().toISOString(),
      actual_output: row.actualOutput,
      pass: row.pass,
      recall: row.recall,
      precision: row.precision,
      citation_accuracy: row.citationAccuracy,
      duration_ms: row.durationMs,
      cost_usd: row.costUsd,
      set_run_id: row.setRunId,
      version: row.agentVersion,
    };
  }

  async listSetRuns(): Promise<never[]> {
    return [];
  }
  async getSetRun(): Promise<undefined> {
    return undefined;
  }
  async getTwoSetRuns(): Promise<undefined> {
    return undefined;
  }
  async listCaseRunsForSet(): Promise<never[]> {
    return [];
  }

  /** Mirrors `EvalRepository.latestCaseRunsForOwner` — latest (last inserted)
   *  run per case, scoped to the owner + workspace. */
  async latestCaseRunsForOwner(workspaceId: string, ownerKind: string, ownerId: string): Promise<EvalCaseStatus[]> {
    const ownedCaseIds = new Set(
      this.cases
        .filter((c) => c.workspaceId === workspaceId && c.row.owner_kind === ownerKind && c.row.owner_id === ownerId)
        .map((c) => c.row.id),
    );
    const latestByCase = new Map<string, (typeof this.caseRuns)[number]>();
    for (const run of this.caseRuns) {
      if (run.workspaceId !== workspaceId || !ownedCaseIds.has(run.caseId)) continue;
      latestByCase.set(run.caseId, run); // insertion order -> last write wins (most recent)
    }
    return Array.from(latestByCase.values()).map((row) => {
      const actual = row.actualOutput as { produced?: unknown; degraded?: unknown } | null;
      return {
        case_id: row.caseId,
        name: row.caseName ?? '',
        pass: row.pass ?? false,
        produced_count: Array.isArray(actual?.produced) ? (actual!.produced as unknown[]).length : null,
        degraded: actual?.degraded === true,
        duration_ms: row.durationMs,
        cost_usd: row.costUsd,
        ran_at: new Date().toISOString(),
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Container factory — only the properties EvalService reads.
// ---------------------------------------------------------------------------

function makeContainer(parts: {
  evalRepo: FakeEvalRepo;
  reviewRepo?: Record<string, unknown>;
  agentsRepo?: Record<string, unknown>;
  llm?: LLMProvider;
  git?: { diff: ReturnType<typeof vi.fn> };
}): Container {
  return {
    evalRepo: parts.evalRepo,
    reviewRepo: parts.reviewRepo ?? {},
    agentsRepo: parts.agentsRepo ?? {},
    git: parts.git ?? { diff: vi.fn().mockRejectedValue(new Error('no git configured in this test')) },
    llm: vi.fn().mockResolvedValue(parts.llm ?? new MockLLMProvider()),
  } as unknown as Container;
}

/** Loads a real DIFF via the container's `git.diff` seam (used by `loadDiff`
 *  inside `createFromFinding`) instead of falling back to pr_files reconstruction. */
function gitDiffOf(raw: string) {
  return vi.fn().mockImplementation(async () => {
    const { parseUnifiedDiff } = await import('../../adapters/git/diff-parser.js');
    return parseUnifiedDiff(raw);
  });
}

// ---------------------------------------------------------------------------
// A small prompt-dependent LLMProvider double (AC-16 sensitivity + finding #5
// all-dropped / AC-18 flaky provider). MockLLMProvider (adapters/mocks.ts)
// cannot vary its fixture by PROMPT content — only by schemaName — so these
// scenarios need a custom double that inspects `req.messages`.
// ---------------------------------------------------------------------------

class PromptMarkerLLMProvider implements LLMProvider {
  readonly id: 'openai' = 'openai';
  calls: StructuredRequest<unknown>[] = [];

  constructor(private byMarker: Record<string, Review>) {}

  async listModels() {
    return [];
  }
  async complete(): Promise<never> {
    throw new Error('complete() not used in this test');
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push(req as StructuredRequest<unknown>);
    const promptText = req.messages.map((m: ChatMessage) => m.content).join('\n');
    const marker = Object.keys(this.byMarker).find((m) => promptText.includes(m));
    const fixture = marker ? this.byMarker[marker]! : { verdict: 'approve', summary: '', score: 100, findings: [] };
    const parsed = (req.schema as z.ZodType<T>).safeParse(fixture);
    if (!parsed.success) throw new Error(`fixture failed schema: ${parsed.error.message}`);
    return { data: parsed.data, model: req.model, tokensIn: 10, tokensOut: 10, costUsd: 0.001, raw: '', attempts: 1 };
  }
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => []);
  }
}

/** A provider that throws for exactly the requests whose prompt carries the
 *  failure marker, and otherwise returns a fixed fixture (AC-18). */
class FlakyLLMProvider implements LLMProvider {
  readonly id: 'openai' = 'openai';
  constructor(
    private failMarker: string,
    private okFixture: Review,
  ) {}
  async listModels() {
    return [];
  }
  async complete(): Promise<never> {
    throw new Error('complete() not used in this test');
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const promptText = req.messages.map((m: ChatMessage) => m.content).join('\n');
    if (promptText.includes(this.failMarker)) throw new Error('simulated provider outage');
    const parsed = (req.schema as z.ZodType<T>).safeParse(this.okFixture);
    if (!parsed.success) throw new Error(`fixture failed schema: ${parsed.error.message}`);
    return { data: parsed.data, model: req.model, tokensIn: 10, tokensOut: 10, costUsd: 0.001, raw: '', attempts: 1 };
  }
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => []);
  }
}

// ===========================================================================
// AC-1 / AC-2 / AC-3 — createFromFinding
// ===========================================================================

describe('EvalService.createFromFinding (AC-1, AC-2, AC-3)', () => {
  it('an ACCEPTED finding creates a must_find case with owner_id derived from the review agent and a non-empty input_diff', async () => {
    const evalRepo = new FakeEvalRepo();
    const finding = makeFindingRow({ acceptedAt: new Date('2026-07-05T00:00:00Z') });
    const review = makeReviewRow();
    const pull = makePullRow();
    const reviewRepo = {
      findingContext: vi.fn().mockResolvedValue({ finding, review, pull }),
      getRepo: vi.fn().mockResolvedValue(makeRepoRow()),
    };
    const container = makeContainer({ evalRepo, reviewRepo, git: { diff: gitDiffOf(DIFF) } });
    const service = new EvalService(container);

    const created = await service.createFromFinding(WS, AGENT_ID, finding.id);

    expect(created.owner_kind).toBe('agent');
    // Owner derived from review.agentId — the SAME value as routeAgentId here,
    // proving derivation happened via the review, not a pass-through of the param.
    expect(created.owner_id).toBe(review.agentId);
    expect(created.input_diff.length).toBeGreaterThan(0);

    const expectation = created.expected_output as EvalExpectation;
    expect(expectation.kind).toBe('must_find');
    expect(expectation.findings).toHaveLength(1);
    expect(expectation.findings[0]).toMatchObject({
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
    });
  });

  it('a DISMISSED finding creates a must_not_flag case', async () => {
    const evalRepo = new FakeEvalRepo();
    const finding = makeFindingRow({ acceptedAt: null, dismissedAt: new Date('2026-07-05T00:00:00Z') });
    const review = makeReviewRow();
    const pull = makePullRow();
    const reviewRepo = {
      findingContext: vi.fn().mockResolvedValue({ finding, review, pull }),
      getRepo: vi.fn().mockResolvedValue(makeRepoRow()),
    };
    const container = makeContainer({ evalRepo, reviewRepo, git: { diff: gitDiffOf(DIFF) } });
    const service = new EvalService(container);

    const created = await service.createFromFinding(WS, AGENT_ID, finding.id);
    const expectation = created.expected_output as EvalExpectation;
    expect(expectation.kind).toBe('must_not_flag');
  });

  it('an UNTRIAGED finding (neither accepted nor dismissed) is rejected — no case is created (AC-4)', async () => {
    const evalRepo = new FakeEvalRepo();
    const finding = makeFindingRow({ acceptedAt: null, dismissedAt: null });
    const review = makeReviewRow();
    const pull = makePullRow();
    const reviewRepo = {
      findingContext: vi.fn().mockResolvedValue({ finding, review, pull }),
      getRepo: vi.fn().mockResolvedValue(makeRepoRow()),
    };
    const container = makeContainer({ evalRepo, reviewRepo });
    const service = new EvalService(container);

    await expect(service.createFromFinding(WS, AGENT_ID, finding.id)).rejects.toThrow();
    expect(evalRepo.cases).toHaveLength(0);
  });
});

// ===========================================================================
// Finding #4 / AC-24 — route :id must match the finding's own review agent
// ===========================================================================

describe('EvalService.createFromFinding — IDOR guard (finding #4 / AC-24)', () => {
  it('refuses (NotFoundError) when the route :id does not match the review agentId — no case is ever created', async () => {
    const evalRepo = new FakeEvalRepo();
    const finding = makeFindingRow({ acceptedAt: new Date() });
    const review = makeReviewRow({ agentId: AGENT_ID });
    const pull = makePullRow();
    const reviewRepo = {
      findingContext: vi.fn().mockResolvedValue({ finding, review, pull }),
      getRepo: vi.fn(),
    };
    const container = makeContainer({ evalRepo, reviewRepo });
    const service = new EvalService(container);

    await expect(service.createFromFinding(WS, OTHER_AGENT_ID, finding.id)).rejects.toThrow(NotFoundError);
    expect(evalRepo.cases).toHaveLength(0);
    // The mismatch is caught before the diff is ever loaded — no wasted work.
    expect(reviewRepo.getRepo).not.toHaveBeenCalled();
  });

  it('refuses (NotFoundError) when the review/pull resolve to a DIFFERENT workspace than the caller', async () => {
    const evalRepo = new FakeEvalRepo();
    const finding = makeFindingRow({ acceptedAt: new Date() });
    const review = makeReviewRow({ workspaceId: 'other-ws', agentId: AGENT_ID });
    const pull = makePullRow({ workspaceId: 'other-ws' });
    const reviewRepo = {
      findingContext: vi.fn().mockResolvedValue({ finding, review, pull }),
      getRepo: vi.fn(),
    };
    const container = makeContainer({ evalRepo, reviewRepo });
    const service = new EvalService(container);

    await expect(service.createFromFinding(WS, AGENT_ID, finding.id)).rejects.toThrow(NotFoundError);
    expect(evalRepo.cases).toHaveLength(0);
  });
});

// ===========================================================================
// AC-11 / AC-12 — runSet: N per-case rows + set-run aggregate, pinned version+prompt
// ===========================================================================

describe('EvalService.runSet (AC-11, AC-12)', () => {
  it('runs the agent once per case and writes N per-case rows (each carrying workspace_id) plus a set-run aggregate with traces_total===N and the pinned agent_version + system_prompt', async () => {
    const evalRepo = new FakeEvalRepo();
    const N = 4;
    for (let i = 0; i < N; i++) {
      await evalRepo.createCase(WS, {
        owner_kind: 'agent',
        owner_id: AGENT_ID,
        name: `case-${i}`,
        input_diff: DIFF,
        input_files: null,
        input_meta: null,
        expected_output: mustFindExpectation(),
        notes: null,
      });
    }
    const agent = makeAgentRow({ version: 7, systemPrompt: 'REVIEW EVERYTHING CAREFULLY' });
    const agentsRepo = { getById: vi.fn().mockResolvedValue(agent) };
    const reviewFixture: Review = {
      verdict: 'comment',
      summary: 'ok',
      score: 90,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'secret',
          file: 'src/config.ts',
          start_line: 11,
          end_line: 11,
          rationale: 'r',
          confidence: 0.9,
          kind: 'finding',
        },
      ],
    };
    const llm = new MockLLMProvider('openai', { structured: reviewFixture });
    const container = makeContainer({ evalRepo, agentsRepo, llm });
    const service = new EvalService(container);

    const result = await service.runSet(WS, AGENT_ID);

    expect(result.traces_total).toBe(N);
    expect(evalRepo.caseRuns).toHaveLength(N);
    for (const row of evalRepo.caseRuns) {
      expect(row.workspaceId).toBe(WS);
      expect(row.agentVersion).toBe(7);
      expect(row.setRunId).toEqual(expect.any(String));
    }

    const setRun = evalRepo.setRunRows.find((s) => s.workspaceId === WS)!;
    expect(setRun).toBeDefined();
    expect(setRun.agentVersion).toBe(7);
    expect(setRun.systemPrompt).toBe('REVIEW EVERYTHING CAREFULLY');
    expect(setRun.tracesTotal).toBe(N);
  });
});

// ===========================================================================
// AC-7 / AC-8 — precision over producedAll, citation over kept/dropped
// ===========================================================================

describe('EvalService.runSet — metric semantics (AC-7, AC-8)', () => {
  it('precision is computed over producedAll (kept UNION dropped) and citation_accuracy from the review outcome kept/dropped counts', async () => {
    const evalRepo = new FakeEvalRepo();
    await evalRepo.createCase(WS, {
      owner_kind: 'agent',
      owner_id: AGENT_ID,
      name: 'precision-case',
      input_diff: DIFF,
      input_files: null,
      input_meta: null,
      expected_output: mustNotFlagExpectation({ start_line: 12, end_line: 12 }),
      notes: null,
    });
    const agent = makeAgentRow();
    const agentsRepo = { getById: vi.fn().mockResolvedValue(agent) };
    // The model produces TWO findings: one lands ON the must_not_flag target
    // (line 12, inside the diff hunk -> grounding KEEPS it), one is
    // hallucinated off-diff (line 999 -> grounding DROPS it).
    const reviewFixture: Review = {
      verdict: 'comment',
      summary: 'flags things',
      score: 70,
      findings: [
        {
          id: 'f-onmustnotflag',
          severity: 'SUGGESTION',
          category: 'style',
          title: 'flagged anyway',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'r',
          confidence: 0.8,
          kind: 'finding',
        },
        {
          id: 'f-hallucinated',
          severity: 'WARNING',
          category: 'bug',
          title: 'off-diff',
          file: 'src/config.ts',
          start_line: 999,
          end_line: 999,
          rationale: 'r',
          confidence: 0.5,
          kind: 'finding',
        },
      ],
    };
    const llm = new MockLLMProvider('openai', { structured: reviewFixture });
    const container = makeContainer({ evalRepo, agentsRepo, llm });
    const service = new EvalService(container);

    await service.runSet(WS, AGENT_ID);

    expect(evalRepo.caseRuns).toHaveLength(1);
    const row = evalRepo.caseRuns[0]!;
    // producedAll = 2 (kept 1 + dropped 1); 1 of the 2 matches the
    // must_not_flag target -> precision = (2-1)/2 = 0.5.
    expect(row.precision).toBeCloseTo(0.5);
    // citation = kept/(kept+dropped) = 1/2 = 0.5.
    expect(row.citationAccuracy).toBeCloseTo(0.5);
    // the must_not_flag target WAS produced -> the case fails.
    expect(row.pass).toBe(false);
  });

  it('finding #5 — an all-dropped grounding result (every produced finding lands off-diff) still records a run with citation_accuracy===0.0, not an error', async () => {
    const evalRepo = new FakeEvalRepo();
    await evalRepo.createCase(WS, {
      owner_kind: 'agent',
      owner_id: AGENT_ID,
      name: 'all-dropped-case',
      input_diff: DIFF,
      input_files: null,
      input_meta: null,
      expected_output: mustFindExpectation(),
      notes: null,
    });
    const agent = makeAgentRow();
    const agentsRepo = { getById: vi.fn().mockResolvedValue(agent) };
    const reviewFixture: Review = {
      verdict: 'comment',
      summary: 'hallucinated only',
      score: 60,
      findings: [
        {
          id: 'f-off-1',
          severity: 'WARNING',
          category: 'bug',
          title: 'phantom 1',
          file: 'src/config.ts',
          start_line: 998,
          end_line: 998,
          rationale: 'r',
          confidence: 0.4,
          kind: 'finding',
        },
        {
          id: 'f-off-2',
          severity: 'WARNING',
          category: 'bug',
          title: 'phantom 2',
          file: 'src/config.ts',
          start_line: 999,
          end_line: 999,
          rationale: 'r',
          confidence: 0.4,
          kind: 'finding',
        },
      ],
    };
    const llm = new MockLLMProvider('openai', { structured: reviewFixture });
    const container = makeContainer({ evalRepo, agentsRepo, llm });
    const service = new EvalService(container);

    // Must NOT throw — an all-dropped outcome is valid, not an error.
    const result = await service.runSet(WS, AGENT_ID);

    expect(result.traces_total).toBe(1);
    const row = evalRepo.caseRuns[0]!;
    expect(row.citationAccuracy).toBe(0.0);
    expect(row.pass).toBe(false); // the must_find target was never surfaced (kept=[])
  });
});

// ===========================================================================
// AC-18 — a single case's provider error is isolated, the set still aggregates
// ===========================================================================

describe('EvalService.runSet — per-case error isolation (AC-18)', () => {
  it('one case whose review call throws is marked failed; the set still aggregates over the surviving case(s)', async () => {
    const evalRepo = new FakeEvalRepo();
    const okCase = await evalRepo.createCase(WS, {
      owner_kind: 'agent',
      owner_id: AGENT_ID,
      name: 'ok-case',
      input_diff: DIFF,
      input_files: null,
      input_meta: null,
      expected_output: mustFindExpectation(),
      notes: null,
    });
    const failCase = await evalRepo.createCase(WS, {
      owner_kind: 'agent',
      owner_id: AGENT_ID,
      name: 'fail-case',
      input_diff: TRIGGER_ERROR_DIFF,
      input_files: null,
      input_meta: null,
      expected_output: mustFindExpectation(),
      notes: null,
    });
    const agent = makeAgentRow();
    const agentsRepo = { getById: vi.fn().mockResolvedValue(agent) };
    const okFixture: Review = {
      verdict: 'comment',
      summary: 'ok',
      score: 90,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'secret',
          file: 'src/config.ts',
          start_line: 11,
          end_line: 11,
          rationale: 'r',
          confidence: 0.9,
          kind: 'finding',
        },
      ],
    };
    const llm = new FlakyLLMProvider('TRIGGER_ERROR_MARKER', okFixture);
    const container = makeContainer({ evalRepo, agentsRepo, llm });
    const service = new EvalService(container);

    // Must NOT throw — the set continues past the failed case.
    const result = await service.runSet(WS, AGENT_ID);

    expect(result.traces_total).toBe(2);
    const failedRow = evalRepo.caseRuns.find((r) => r.caseId === failCase.id)!;
    expect(failedRow).toBeDefined();
    expect(failedRow.pass).toBe(false);

    const okRow = evalRepo.caseRuns.find((r) => r.caseId === okCase.id)!;
    expect(okRow).toBeDefined();
    expect(okRow.pass).toBe(true);
  });
});

// ===========================================================================
// AC-17 — unparseable/empty input_diff degrades: review skipped, citation null
// ===========================================================================

describe('EvalService.runSet — degraded fallback (AC-17)', () => {
  it('an unparseable/empty input_diff SKIPS reviewPullRequest entirely (no completeStructured call for that case) and degrades citation_accuracy to null with precision 1.0 — no crash', async () => {
    const evalRepo = new FakeEvalRepo();
    await evalRepo.createCase(WS, {
      owner_kind: 'agent',
      owner_id: AGENT_ID,
      name: 'degraded-case',
      input_diff: UNPARSEABLE_DIFF,
      input_files: null,
      input_meta: null,
      expected_output: mustNotFlagExpectation(),
      notes: null,
    });
    const agent = makeAgentRow();
    const agentsRepo = { getById: vi.fn().mockResolvedValue(agent) };
    const completeStructuredSpy = vi.fn().mockRejectedValue(new Error('must never be called'));
    const llm: LLMProvider = {
      id: 'openai',
      listModels: vi.fn().mockResolvedValue([]),
      complete: vi.fn(),
      completeStructured: completeStructuredSpy,
      embed: vi.fn(),
    } as unknown as LLMProvider;
    const container = makeContainer({ evalRepo, agentsRepo, llm });
    const service = new EvalService(container);

    // Must NOT throw/crash.
    await service.runSet(WS, AGENT_ID);

    expect(completeStructuredSpy).not.toHaveBeenCalled();
    const row = evalRepo.caseRuns[0]!;
    expect(row.citationAccuracy).toBeNull();
    expect(row.precision).toBe(1.0);
  });
});

// ===========================================================================
// AC-24 — runSet against an out-of-workspace agent is refused
// ===========================================================================

describe('EvalService.runSet — workspace tenancy (AC-24)', () => {
  it('refuses (NotFoundError) when the agent does not resolve within the caller workspace', async () => {
    const evalRepo = new FakeEvalRepo();
    const agentsRepo = { getById: vi.fn().mockResolvedValue(undefined) };
    const container = makeContainer({ evalRepo, agentsRepo });
    const service = new EvalService(container);

    await expect(service.runSet(WS, AGENT_ID)).rejects.toThrow(NotFoundError);
    expect(evalRepo.setRunRows).toHaveLength(0);
  });
});

// ===========================================================================
// AC-19 — runCase: single-case run (per-row "play" button on the Evals tab)
// ===========================================================================

describe('EvalService.runCase (AC-19)', () => {
  it('runs exactly one case (LLM stubbed at the port level) and returns an EvalCaseStatus, persisting exactly one eval_runs row with set_run_id = null', async () => {
    const evalRepo = new FakeEvalRepo();
    const created = await evalRepo.createCase(WS, {
      owner_kind: 'agent',
      owner_id: AGENT_ID,
      name: 'single-case',
      input_diff: DIFF,
      input_files: null,
      input_meta: null,
      expected_output: mustFindExpectation(),
      notes: null,
    });
    const agent = makeAgentRow();
    const agentsRepo = { getById: vi.fn().mockResolvedValue(agent) };
    const reviewFixture: Review = {
      verdict: 'comment',
      summary: 'ok',
      score: 90,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'secret',
          file: 'src/config.ts',
          start_line: 11,
          end_line: 11,
          rationale: 'r',
          confidence: 0.9,
          kind: 'finding',
        },
      ],
    };
    const llm = new MockLLMProvider('openai', { structured: reviewFixture });
    const container = makeContainer({ evalRepo, agentsRepo, llm });
    const service = new EvalService(container);

    const status = await service.runCase(WS, AGENT_ID, created.id);

    expect(status.case_id).toBe(created.id);
    expect(status.name).toBe('single-case');
    expect(status.pass).toBe(true);

    expect(evalRepo.caseRuns).toHaveLength(1);
    const row = evalRepo.caseRuns[0]!;
    expect(row.caseId).toBe(created.id);
    expect(row.setRunId).toBeNull();
    expect(row.workspaceId).toBe(WS);
    // A single-case run never creates a set-run aggregate row.
    expect(evalRepo.setRunRows).toHaveLength(0);
  });

  it('refuses (NotFoundError) when the case does not belong to the given agent (ownership/tenancy)', async () => {
    const evalRepo = new FakeEvalRepo();
    const created = await evalRepo.createCase(WS, {
      owner_kind: 'agent',
      owner_id: OTHER_AGENT_ID,
      name: 'someone-elses-case',
      input_diff: DIFF,
      input_files: null,
      input_meta: null,
      expected_output: mustFindExpectation(),
      notes: null,
    });
    const agent = makeAgentRow();
    const agentsRepo = { getById: vi.fn().mockResolvedValue(agent) };
    const container = makeContainer({ evalRepo, agentsRepo });
    const service = new EvalService(container);

    await expect(service.runCase(WS, AGENT_ID, created.id)).rejects.toThrow(NotFoundError);
    expect(evalRepo.caseRuns).toHaveLength(0);
  });
});

// ===========================================================================
// AC-16 — prompt sensitivity: same fixed set, two prompts move the metrics
// ===========================================================================

describe('EvalService.runSet — AC-16 prompt sensitivity (explicit)', () => {
  it('an "old" prompt that misses the target vs a "new" prompt that finds it yields a non-zero recall delta on the IDENTICAL fixed case', async () => {
    const evalRepo = new FakeEvalRepo();
    await evalRepo.createCase(WS, {
      owner_kind: 'agent',
      owner_id: AGENT_ID,
      name: 'mf-case',
      input_diff: DIFF,
      input_files: null,
      input_meta: null,
      expected_output: mustFindExpectation(),
      notes: null,
    });

    const oldPromptReview: Review = { verdict: 'approve', summary: 'nothing found', score: 95, findings: [] };
    const newPromptReview: Review = {
      verdict: 'request_changes',
      summary: 'found it',
      score: 60,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'secret',
          file: 'src/config.ts',
          start_line: 11,
          end_line: 11,
          rationale: 'r',
          confidence: 0.9,
          kind: 'finding',
        },
      ],
    };
    const provider = new PromptMarkerLLMProvider({
      PROMPT_MARKER_OLD: oldPromptReview,
      PROMPT_MARKER_NEW: newPromptReview,
    });
    const agent = makeAgentRow({ systemPrompt: 'PROMPT_MARKER_OLD reviewer instructions', version: 1 });
    const agentsRepo = { getById: vi.fn(async () => ({ ...agent })) };
    const container = makeContainer({ evalRepo, agentsRepo, llm: provider });
    const service = new EvalService(container);

    const runOld = await service.runSet(WS, AGENT_ID);
    // Same fixed case set, only the agent's system prompt changed between runs.
    agent.systemPrompt = 'PROMPT_MARKER_NEW reviewer instructions';
    agent.version = 2;
    const runNew = await service.runSet(WS, AGENT_ID);

    expect(runOld.recall).toBe(0.0);
    expect(runNew.recall).toBe(1.0);
    expect(runNew.recall - runOld.recall).not.toBe(0);
  });

  it('a deliberately-broken prompt that reproduces a must_not_flag target DROPS precision vs a clean prompt on the same fixed case', async () => {
    const evalRepo = new FakeEvalRepo();
    await evalRepo.createCase(WS, {
      owner_kind: 'agent',
      owner_id: AGENT_ID,
      name: 'mnf-case',
      input_diff: DIFF,
      input_files: null,
      input_meta: null,
      expected_output: mustNotFlagExpectation({ start_line: 12, end_line: 12 }),
      notes: null,
    });

    const cleanReview: Review = { verdict: 'approve', summary: 'clean', score: 95, findings: [] };
    const brokenReview: Review = {
      verdict: 'comment',
      summary: 'flags the forbidden target',
      score: 80,
      findings: [
        {
          id: 'f1',
          severity: 'SUGGESTION',
          category: 'style',
          title: 'do not flag',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'r',
          confidence: 0.7,
          kind: 'finding',
        },
      ],
    };
    const provider = new PromptMarkerLLMProvider({
      PROMPT_MARKER_CLEAN: cleanReview,
      PROMPT_MARKER_BROKEN: brokenReview,
    });
    const agent = makeAgentRow({ systemPrompt: 'PROMPT_MARKER_CLEAN reviewer instructions', version: 1 });
    const agentsRepo = { getById: vi.fn(async () => ({ ...agent })) };
    const container = makeContainer({ evalRepo, agentsRepo, llm: provider });
    const service = new EvalService(container);

    const runClean = await service.runSet(WS, AGENT_ID);
    agent.systemPrompt = 'PROMPT_MARKER_BROKEN reviewer instructions';
    agent.version = 2;
    const runBroken = await service.runSet(WS, AGENT_ID);

    expect(runClean.precision).toBe(1.0);
    expect(runBroken.precision).toBeLessThan(runClean.precision);
  });
});
