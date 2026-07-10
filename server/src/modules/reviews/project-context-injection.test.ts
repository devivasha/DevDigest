/**
 * AC-18/AC-19/AC-21/AC-22/AC-23/AC-24 + AC-35 companion — end-to-end
 * project-context spec injection through `ReviewRunExecutor.executeRuns`.
 *
 * Hermetic: a real temp dir stands in for the repo's clone (so `readDocument`
 * exercises real fs + the T3 path guard), a stub `GitClient` only implements
 * `clonePathFor`/`diff`, `RunBus` is the real in-memory class (no I/O), and
 * `MockLLMProvider` (adapters/mocks.ts) returns a fixture `Review` whose one
 * finding cites a real diff line so it survives `groundFindings()` — proving
 * the AC-35 "grounded finding survives" half at the injection call site (the
 * e2e, T17, covers the injection-visibility half).
 *
 * Onion note: this drives `ReviewRunExecutor` with hand-built test doubles for
 * `Container`/`ReviewRepository` (only the properties this code path actually
 * reads), cast `as unknown as X` — the same pattern already used in
 * `modules/blast/service.test.ts` (see insights/INSIGHTS.md, 2026-07-06) and
 * `modules/reviews/repository/run.repo.severity.test.ts`. No real Postgres.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitClient, Intent, RunTrace, Finding, LLMProvider } from '@devdigest/shared';
import { MockLLMProvider } from '../../adapters/mocks.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { RunBus } from '../../platform/sse.js';
import type { Container } from '../../platform/container.js';
import type { AgentRow, PullRow } from '../../db/rows.js';
import type { ReviewRepository } from './repository.js';
import type { LinkedSkillRow } from '../agents/repository.js';
import * as t from '../../db/schema.js';
import { ReviewRunExecutor } from './run-executor.js';

// ---- Fixed diff: one file, one hunk, new-side lines [1,2,3,4] -------------
const RAW_DIFF = [
  'diff --git a/src/foo.ts b/src/foo.ts',
  '--- a/src/foo.ts',
  '+++ b/src/foo.ts',
  '@@ -1,3 +1,4 @@',
  ' line1',
  '+added line',
  ' line2',
  ' line3',
].join('\n');
const DIFF = parseUnifiedDiff(RAW_DIFF);

const STORED_INTENT: Intent = { intent: 'Add a line', in_scope: [], out_of_scope: [] };

/** A Finding whose file+line range intersects DIFF's real hunk — must survive groundFindings(). */
const GROUNDED_FINDING: Finding = {
  id: 'finding-1',
  severity: 'WARNING',
  category: 'bug',
  title: 'Example finding',
  file: 'src/foo.ts',
  start_line: 2,
  end_line: 2,
  rationale: 'Example rationale',
  confidence: 0.9,
};

function makeGit(cloneRoot: string): GitClient {
  return {
    clonePathFor: () => cloneRoot,
    diff: async () => DIFF,
  } as unknown as GitClient;
}

function makeSkillRow(overrides: Partial<typeof t.skills.$inferSelect> = {}): typeof t.skills.$inferSelect {
  return {
    id: 'skill-1',
    workspaceId: 'ws-1',
    name: 'Test Skill',
    description: 'desc',
    type: 'convention',
    source: 'manual',
    body: 'Skill body rules',
    enabled: true,
    version: 1,
    evidenceFiles: null,
    threatLevel: 'unknown',
    attachedDocPaths: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as typeof t.skills.$inferSelect;
}

function makeAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'agent-1',
    workspaceId: 'ws-1',
    name: 'Test Agent',
    description: '',
    provider: 'openai',
    model: 'gpt-4.1',
    systemPrompt: 'You are a reviewer.',
    outputSchema: null,
    strategy: 'single-pass',
    ciFailOn: 'critical',
    repoIntel: false, // skip repo-intel enrichment entirely — not under test here
    enabled: true,
    version: 1,
    createdBy: null,
    attachedDocPaths: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as AgentRow;
}

function makePull(overrides: Partial<PullRow> = {}): PullRow {
  return {
    id: 'pr-1',
    workspaceId: 'ws-1',
    repoId: 'repo-1',
    number: 42,
    title: 'Add a line',
    author: 'octocat',
    branch: 'feature/x',
    base: 'main',
    headSha: 'deadbeef',
    lastReviewedSha: null,
    additions: 1,
    deletions: 0,
    filesCount: 1,
    status: 'needs_review',
    body: null,
    openedAt: null,
    updatedAt: null,
    ...overrides,
  } as PullRow;
}

function makeRepoRow(overrides: Partial<typeof t.repos.$inferSelect> = {}): typeof t.repos.$inferSelect {
  return {
    id: 'repo-1',
    workspaceId: 'ws-1',
    owner: 'acme',
    name: 'widgets',
    fullName: 'acme/widgets',
    defaultBranch: 'main',
    clonePath: null,
    lastPolledAt: null,
    createdBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as typeof t.repos.$inferSelect;
}

/** Fake ReviewRepository — only the methods this code path touches, capturing
 *  what's persisted so tests can assert on it. */
function makeFakeRepo() {
  const savedTraces: RunTrace[] = [];
  const insertedFindingsByReview: Finding[][] = [];
  const completed: unknown[] = [];

  const repo = {
    getIntent: async () => STORED_INTENT, // stored → skips IntentService.computeForRun (no extra LLM call)
    insertReview: async (values: Record<string, unknown>) => ({ id: 'review-1', ...values }),
    insertFindings: async (_reviewId: string, findings: Finding[]) => {
      insertedFindingsByReview.push(findings);
      return findings.map((f, i) => ({ ...f, id: `finding-row-${i}`, reviewId: 'review-1' }));
    },
    markReviewed: async () => undefined,
    completeAgentRun: async (runId: string, values: Record<string, unknown>) => {
      completed.push({ runId, ...values });
    },
    saveRunTrace: async (_runId: string, trace: RunTrace) => {
      savedTraces.push(trace);
    },
  };

  return {
    repo: repo as unknown as ReviewRepository,
    savedTraces,
    insertedFindingsByReview,
    completed,
  };
}

function makeContainer(git: GitClient, llm: LLMProvider, linkedSkills: LinkedSkillRow[]): Container {
  const container = {
    runBus: new RunBus(),
    git,
    llm: async () => llm,
    agentsRepo: { linkedSkills: async () => linkedSkills },
  };
  return container as unknown as Container;
}

let cloneRoot: string;

beforeEach(async () => {
  cloneRoot = await mkdtemp(join(tmpdir(), 'dd-project-context-injection-'));
});

afterEach(async () => {
  await rm(cloneRoot, { recursive: true, force: true });
});

describe('ReviewRunExecutor — project-context spec injection', () => {
  it('injects both the agent doc and the enabled skill doc, deduped, in deterministic order', async () => {
    await mkdir(join(cloneRoot, 'docs'), { recursive: true });
    await mkdir(join(cloneRoot, 'specs'), { recursive: true });
    await writeFile(join(cloneRoot, 'docs', 'api.md'), 'AGENT DOC BODY', 'utf8');
    await writeFile(join(cloneRoot, 'specs', 'policy.md'), 'SKILL DOC BODY', 'utf8');

    const agent = makeAgent({ attachedDocPaths: ['docs/api.md'] });
    const linkedSkills: LinkedSkillRow[] = [
      { skill: makeSkillRow({ attachedDocPaths: ['specs/policy.md'] }), order: 0 },
    ];
    const mockLLM = new MockLLMProvider('openai', { structured: reviewFixture([GROUNDED_FINDING]) });
    const container = makeContainer(makeGit(cloneRoot), mockLLM, linkedSkills);
    const { repo, savedTraces, insertedFindingsByReview } = makeFakeRepo();
    const executor = new ReviewRunExecutor(container, repo, container.agentsRepo);

    await executor.executeRuns('ws-1', makePull(), makeRepoRow(), [{ agent, runId: 'run-1' }]);

    expect(savedTraces).toHaveLength(1);
    const trace = savedTraces[0]!;
    // Deterministic order: agent path(s) first, then skill path(s) (AC-19/AC-21).
    expect(trace.specs_read).toEqual(['docs/api.md', 'specs/policy.md']);
    expect(trace.specs_missing).toEqual([]);
    expect(trace.prompt_assembly.specs).toContain('AGENT DOC BODY');
    expect(trace.prompt_assembly.specs).toContain('SKILL DOC BODY');
    expect(trace.prompt_assembly.user).toContain('## Project context');

    // Exactly one structured-output call (single-pass strategy).
    const structuredCalls = mockLLM.calls.filter((c) => c.method === 'completeStructured');
    expect(structuredCalls).toHaveLength(1);

    // AC-35 companion: the grounded finding survived groundFindings() and was persisted.
    expect(insertedFindingsByReview).toHaveLength(1);
    expect(insertedFindingsByReview[0]).toHaveLength(1);
    expect(insertedFindingsByReview[0]![0]!.id).toBe('finding-1');
  });

  it('skips a stale/missing path but still injects the survivors; stale path lands only in specs_missing', async () => {
    await mkdir(join(cloneRoot, 'docs'), { recursive: true });
    await writeFile(join(cloneRoot, 'docs', 'api.md'), 'AGENT DOC BODY', 'utf8');
    // 'docs/stale.md' is intentionally never written to disk.

    const agent = makeAgent({ attachedDocPaths: ['docs/api.md', 'docs/stale.md'] });
    const mockLLM = new MockLLMProvider('openai', { structured: reviewFixture([]) });
    const container = makeContainer(makeGit(cloneRoot), mockLLM, []);
    const { repo, savedTraces } = makeFakeRepo();
    const executor = new ReviewRunExecutor(container, repo, container.agentsRepo);

    await executor.executeRuns('ws-1', makePull(), makeRepoRow(), [{ agent, runId: 'run-2' }]);

    const trace = savedTraces[0]!;
    expect(trace.specs_read).toEqual(['docs/api.md']);
    expect(trace.specs_missing).toEqual(['docs/stale.md']);
    // Distinct sets — the stale path never appears in specs_read.
    expect(trace.specs_read).not.toContain('docs/stale.md');
    expect(trace.prompt_assembly.specs).toContain('AGENT DOC BODY');
  });

  it('zero attached docs → no "## Project context" section and specs_read: []', async () => {
    const agent = makeAgent({ attachedDocPaths: [] });
    const mockLLM = new MockLLMProvider('openai', { structured: reviewFixture([]) });
    const container = makeContainer(makeGit(cloneRoot), mockLLM, []);
    const { repo, savedTraces } = makeFakeRepo();
    const executor = new ReviewRunExecutor(container, repo, container.agentsRepo);

    await executor.executeRuns('ws-1', makePull(), makeRepoRow(), [{ agent, runId: 'run-3' }]);

    const trace = savedTraces[0]!;
    expect(trace.specs_read).toEqual([]);
    expect(trace.prompt_assembly.specs).toBeNull();
    expect(trace.prompt_assembly.user).not.toContain('## Project context');
  });

  it('provider call count is identical whether or not project-context docs are attached', async () => {
    await mkdir(join(cloneRoot, 'docs'), { recursive: true });
    await writeFile(join(cloneRoot, 'docs', 'api.md'), 'AGENT DOC BODY', 'utf8');

    const withDocs = makeAgent({ attachedDocPaths: ['docs/api.md'] });
    const withoutDocs = makeAgent({ attachedDocPaths: [] });

    const llmWith = new MockLLMProvider('openai', { structured: reviewFixture([]) });
    const llmWithout = new MockLLMProvider('openai', { structured: reviewFixture([]) });

    const containerWith = makeContainer(makeGit(cloneRoot), llmWith, []);
    const containerWithout = makeContainer(makeGit(cloneRoot), llmWithout, []);

    const withRepo = makeFakeRepo();
    const withoutRepo = makeFakeRepo();

    await new ReviewRunExecutor(containerWith, withRepo.repo, containerWith.agentsRepo).executeRuns(
      'ws-1',
      makePull(),
      makeRepoRow(),
      [{ agent: withDocs, runId: 'run-4a' }],
    );
    await new ReviewRunExecutor(
      containerWithout,
      withoutRepo.repo,
      containerWithout.agentsRepo,
    ).executeRuns('ws-1', makePull(), makeRepoRow(), [{ agent: withoutDocs, runId: 'run-4b' }]);

    const callsWith = llmWith.calls.filter((c) => c.method === 'completeStructured').length;
    const callsWithout = llmWithout.calls.filter((c) => c.method === 'completeStructured').length;
    expect(callsWith).toBe(callsWithout);
    expect(callsWith).toBe(1);
  });
});

/** Build a fixture matching the `Review` Zod schema for MockLLMProvider. */
function reviewFixture(findings: Finding[]): unknown {
  return {
    verdict: findings.length > 0 ? 'request_changes' : 'approve',
    summary: 'Test summary',
    score: findings.length > 0 ? 60 : 95,
    findings,
  };
}
