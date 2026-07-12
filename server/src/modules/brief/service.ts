/**
 * brief/service.ts — application layer for the Why+Risk Brief feature (T5).
 *
 * Fuses already-computed, deterministic signals (intent, blast summary,
 * smart-diff group stats, linked issue, attached specs) into a short
 * reviewer briefing via EXACTLY ONE `llm.completeStructured` call. Only
 * headers/summaries/stats enter the prompt — no diff hunks / raw code.
 *
 * Onion layer: application — orchestrates `ReviewRepository` + the reused
 * `IntentService`/`BlastService` + injected `container.llm`/`container.git`/
 * `container.github()`. No SQL here.
 *
 * Security: every enricher (intent, blast, linked issue, specs) is
 * best-effort (`.catch(() => null)` / try-catch) — only a missing PR/repo
 * throws `NotFoundError` (AC-18, AC-20). PR title/body, linked-issue body,
 * and spec text are wrapped via `wrapUntrusted` before entering the prompt
 * (AC-21). Emitted file paths are path-grounded against the repo clone
 * before being persisted (AC-8, Rec2).
 */
import { Brief } from '@devdigest/shared';
import type { BriefRecord, Risk, RiskSeverity, SmartDiffFile } from '@devdigest/shared';
import { stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { renderPrompt } from '../../platform/prompts.js';
import { wrapUntrusted } from '../../platform/prompt.js';
import { ReviewRepository } from '../reviews/repository.js';
import type { PullRow } from '../reviews/repository.js';
import type { Logger } from '../reviews/run-executor.js';
import { IntentService } from '../intent/service.js';
import { BlastService } from '../blast/service.js';
import { groupSmartDiff } from '../pulls/smart-diff-classifier.js';
import { resolveFeatureModel } from '../settings/feature-models.js';

const PROMPT_TEMPLATE = 'brief.system.md';

// ---- Rec1: soft caps enforced in the service (permissive Zod contract) ----
const RISKS_MAX = 7;
const REVIEW_FOCUS_MAX = 7;
const TEXT_MAX = 600;

// Derived from the repository's own public signature (never import
// `db/schema` in the application layer — onion dependency rule: services
// depend on the repository's return type, not on Drizzle's inferred row
// type directly).
type RepoRow = NonNullable<Awaited<ReturnType<ReviewRepository['getRepo']>>>;
type RepoRef = { owner: string; name: string };

/**
 * Narrowed linked-issue shape actually consumed by `buildUserMessage` —
 * deliberately NOT the full `IssueMeta` contract. GitHub's `getPullRequest`
 * fallback (used when the referenced `#N` is a PR, not an issue) has no
 * open/closed "issue state" concept that maps cleanly onto `IssueMeta.state`;
 * mirrors `IntentService`'s own `{ title, body }`-only issue fallback shape.
 */
interface LinkedIssue {
  number: number;
  title: string;
  body: string | null;
}

/** Deterministic per-role smart-diff stats — file counts + line totals only, never patch/code bodies. */
interface GroupStat {
  role: string;
  fileCount: number;
  additions: number;
  deletions: number;
}

export class BriefService {
  private repo: ReviewRepository;

  constructor(
    private container: Container,
    private logger?: Logger,
  ) {
    this.repo = new ReviewRepository(container.db);
  }

  /**
   * Return the cached Brief if present (cache-hit: **zero** LLM calls,
   * AC-9). Compute + persist on miss (AC-10).
   *
   * SECURITY: `pr_brief` has no `workspace_id` column — `getBrief`/
   * `upsertBrief` are keyed only by `prId`. The workspace/tenancy check via
   * `getPull(workspaceId, prId)` MUST happen before the cache read, or a
   * cache hit could return another workspace's Brief for a PR the caller
   * doesn't own (cross-tenant leak). The resolved `pull` is threaded into
   * `compute()` on a cache miss so the PR row is fetched only once.
   */
  async getOrCompute(workspaceId: string, prId: string): Promise<BriefRecord> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError(`Pull request not found: ${prId}`);

    const stored = await this.repo.getBrief(prId);
    if (stored) {
      return { ...stored, pr_id: prId };
    }
    return this.compute(workspaceId, prId, pull);
  }

  /** Always re-computes + upserts (replace), even if a stored Brief exists (AC-11). */
  async regenerate(workspaceId: string, prId: string): Promise<BriefRecord> {
    return this.compute(workspaceId, prId);
  }

  // ---- private orchestration ------------------------------------------------

  /**
   * `prefetchedPull` lets `getOrCompute` pass along the PR row it already
   * loaded for its tenancy check, avoiding a duplicate `getPull` query on a
   * cache miss. `regenerate()` has no prior load, so it omits the argument
   * and this method fetches + tenancy-checks the PR itself.
   */
  private async compute(workspaceId: string, prId: string, prefetchedPull?: PullRow): Promise<BriefRecord> {
    // 1. Tenancy first — `pr_brief` has no workspace_id, so tenancy must be
    //    proven via getPull(workspaceId, prId) before any cache read/write (AC-20).
    const pull = prefetchedPull ?? (await this.repo.getPull(workspaceId, prId));
    if (!pull) throw new NotFoundError(`Pull request not found: ${prId}`);
    const repoRow = await this.repo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError(`Repository not found for PR: ${prId}`);
    const repoRef: RepoRef = { owner: repoRow.owner, name: repoRow.name };

    // 2. Gather reused inputs — every enricher is best-effort (AC-18).
    const intentPromise = new IntentService(this.container, this.logger)
      .getOrCompute(workspaceId, prId)
      .catch(() => null);

    // prFiles can contain duplicate rows per path (seed/sync races) — dedup
    // by path before deriving changedPaths / smart-diff stats (server insight).
    const prFilesRaw = await this.repo.getPrFiles(prId);
    const deduped = dedupeByPath(prFilesRaw);
    const changedPaths = deduped.map((f) => f.path);

    // Empty `changedPaths` (title-only PR): getBlast/groupSmartDiff both
    // handle `[]` safely (edge #5) — no special-casing needed here.
    const blastPromise = new BlastService(this.container)
      .getBlast(workspaceId, pull, changedPaths)
      .catch(() => null);

    const smartDiffFiles: SmartDiffFile[] = deduped.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      finding_lines: [],
      pseudocode_summary: null,
    }));
    const smartDiff = groupSmartDiff(smartDiffFiles);
    const groupStats: GroupStat[] = smartDiff.groups.map((g) => ({
      role: g.role,
      fileCount: g.files.length,
      additions: g.files.reduce((sum, f) => sum + f.additions, 0),
      deletions: g.files.reduce((sum, f) => sum + f.deletions, 0),
    }));

    const issuePromise = this.resolveLinkedIssue(pull, repoRef);
    const specTextsPromise = this.gatherSpecTexts(workspaceId, repoRow);

    const [intent, blast, issue, specTexts] = await Promise.all([
      intentPromise,
      blastPromise,
      issuePromise,
      specTextsPromise,
    ]);

    // 3. Assemble the user message — omit an entire section (heading + body)
    //    whenever its input is absent (never emit a null/empty section).
    const userMsg = this.buildUserMessage({ pull, intent, blast, groupStats, issue, specTexts });

    // 4. Exactly ONE completeStructured call (AC-2, AC-3).
    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'risk_brief');
    const llm = await this.container.llm(provider);
    const system = await renderPrompt(PROMPT_TEMPLATE, {});

    let brief: Brief;
    try {
      const result = await llm.completeStructured<Brief>({
        model,
        schema: Brief,
        schemaName: 'Brief',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userMsg },
        ],
        temperature: 0.2,
      });
      brief = result.data;
      // Observability: log the LLM call's input size so the "input ≤ 8K" bound
      // is verifiable from the server logs (headers/summaries/stats only — no
      // diff bodies enter the prompt).
      this.logger?.info(
        { prId, tokensIn: result.tokensIn, userMsgChars: userMsg.length, model },
        'brief: generated',
      );
    } catch (err) {
      // On throw/parse-failure: do NOT persist, surface a failure the route
      // can propagate (AC-17). Never fabricate a Brief from a failed call.
      this.logger?.warn({ err, prId }, 'brief: completeStructured failed or returned invalid output');
      throw err instanceof Error ? err : new Error('Brief generation failed');
    }

    // 5. Path-ground every emitted file path (AC-8, Rec2 — tightened) AND
    //    constrain file refs to this PR's blast/change map — the changed files,
    //    blast changed-symbol files, and downstream caller files. This makes
    //    "risks point to real files FROM the blast map" a hard guarantee, not
    //    just a prompt instruction: a model can't cite an arbitrary real repo
    //    file that isn't part of this change's blast radius.
    const blastFiles = new Set<string>(
      [
        ...changedPaths,
        ...(blast?.changed_symbols ?? []).map((s) => s.file),
        ...(blast?.downstream ?? []).flatMap((d) => d.callers.map((c) => c.file)),
      ]
        .map((p) => p.trim())
        .filter(Boolean),
    );
    const grounded = await this.groundBrief(repoRef, brief, blastFiles);

    // 6. Soft caps (Rec1) — belt-and-suspenders slicing/truncation.
    const capped = applyCaps(grounded);

    // 7. Persist + return.
    await this.repo.upsertBrief(prId, capped);
    return { ...capped, pr_id: prId };
  }

  /**
   * Best-effort linked-issue resolution, mirroring `IntentService`'s own
   * issue lookup: parse the PR body for the first `#N` / `closes|fixes|
   * resolves #N` reference, then fetch it via GitHub (falling back to
   * `getPullRequest` on 404). `container.github()` is async and THROWS
   * without a configured PAT — caught here so a missing PAT degrades to "no
   * linked issue" rather than failing the whole compute.
   */
  private async resolveLinkedIssue(pull: PullRow, repoRef: RepoRef): Promise<LinkedIssue | null> {
    const github = await this.container.github().catch(() => null);
    if (!github || !pull.body) return null;

    const match =
      pull.body.match(/\b(?:closes|fixes|resolves)\s+#(\d+)\b/i) ?? pull.body.match(/(?<![/\w])#(\d+)\b/);
    const n = match?.[1] ? parseInt(match[1], 10) : null;
    if (n == null) return null;

    try {
      const issue = await github.getIssue(repoRef, n);
      return { number: issue.number, title: issue.title, body: issue.body ?? null };
    } catch {
      try {
        const pr = await github.getPullRequest(repoRef, n);
        return { number: pr.number, title: pr.title, body: pr.body ?? null };
      } catch {
        return null;
      }
    }
  }

  /**
   * Attached project-context specs, scoped to the PR's repo (Q1 / cross-model
   * review #1: "tighten, don't drop").
   *
   * There is NO per-repo agent scoping anywhere in the schema today: `agents`
   * rows carry only `workspace_id` (`server/src/db/schema/agents.ts`) — no
   * `repo_id` column and no join table linking an agent to a repo.
   * `AgentsRepository` only exposes `list`/`listEnabled` BY WORKSPACE
   * (confirmed by reading `modules/agents/repository.ts`,
   * `modules/project-context/service.ts`, and `modules/reviews/service.ts` —
   * none filter agents by repo). Per this plan's own explicit fallback ("if
   * the exact per-repo agent scoping is not cleanly available, degrade to
   * omitting specs rather than pulling everything"), specs are omitted from
   * the prompt entirely here rather than falling back to the
   * explicitly-rejected "union of ALL workspace agents" behaviour, which
   * would leak documents attached to agents that have nothing to do with
   * this PR's repo into every Brief workspace-wide.
   *
   * If a repo-scoping mechanism for agents is added later, this is the
   * single place to wire it back in: filter the scoped agents'
   * `attachedDocPaths`, dedupe, hard-cap at `MAX_SPEC_DOCS` docs /
   * `MAX_SPEC_BYTES` total, and read each path best-effort via
   * `readDocument` (`../project-context/documents.js`).
   */
  private async gatherSpecTexts(
    _workspaceId: string,
    _repoRow: RepoRow,
  ): Promise<{ source: string; text: string }[]> {
    return [];
  }

  /**
   * Builds the single user message, section-by-section, OMITTING an entire
   * section (heading + body) whenever its input is absent — never emits a
   * null/empty section (AC-21, cross-model review #4). Untrusted inputs (PR
   * title/body, linked-issue body, each spec text) are wrapped via
   * `wrapUntrusted`; deterministic pieces (blast summary, group stats) need
   * no wrapping.
   */
  private buildUserMessage(input: {
    pull: PullRow;
    intent: Awaited<ReturnType<IntentService['getOrCompute']>> | null;
    blast: Awaited<ReturnType<BlastService['getBlast']>> | null;
    groupStats: GroupStat[];
    issue: LinkedIssue | null;
    specTexts: { source: string; text: string }[];
  }): string {
    const { pull, intent, blast, groupStats, issue, specTexts } = input;
    const sections: string[] = [];

    // PR title/body is always present (the PR itself is guaranteed by tenancy).
    const prBody = wrapUntrusted('pr', `Title: ${pull.title}\n\n${pull.body ?? ''}`.trim());
    sections.push(`## PR\n${prBody}`);

    if (intent) {
      const lines = [
        `Intent: ${intent.intent}`,
        `In scope: ${intent.in_scope.join(', ') || '(none)'}`,
        `Out of scope: ${intent.out_of_scope.join(', ') || '(none)'}`,
      ];
      sections.push(`## Intent\n${lines.join('\n')}`);
    }

    if (blast) {
      const lines = [
        blast.summary,
        `Impacted endpoints: ${blast.impacted_endpoints.join(', ') || '(none)'}`,
        `Changed symbols: ${
          blast.changed_symbols.map((s) => `${s.name} (${s.file}, ${s.kind})`).join(', ') || '(none)'
        }`,
      ];
      sections.push(`## Blast summary\n${lines.join('\n')}`);
    }

    if (groupStats.length > 0) {
      const lines = groupStats.map(
        (g) => `- ${g.role}: ${g.fileCount} file(s), +${g.additions}/-${g.deletions} lines`,
      );
      sections.push(`## Smart-diff group stats\n${lines.join('\n')}`);
    }

    if (issue) {
      const body = wrapUntrusted('issue', `#${issue.number}: ${issue.title}\n\n${issue.body ?? ''}`.trim());
      sections.push(`## Linked issue\n${body}`);
    }

    if (specTexts.length > 0) {
      const blocks = specTexts.map((s) => wrapUntrusted(`spec:${s.source}`, s.text));
      sections.push(`## Referenced specs\n${blocks.join('\n\n')}`);
    }

    return sections.join('\n\n');
  }

  /**
   * Path-grounds every emitted file path (Rec2 — tightened per cross-model
   * review #3): a ref is grounding-ELIGIBLE only if it is a relative,
   * in-tree file path. Refs that are absolute (start with `/`), contain
   * `..`, or match a URL scheme (`^[a-z][a-z0-9+.-]*:`) are REJECTED outright
   * and pass through unchanged as plain non-link text (endpoint-shaped refs
   * like `GET /pulls/:id` fall into this bucket via the leading `/`). For
   * eligible refs, only those that resolve to a real in-tree file survive —
   * unverifiable ones are dropped from `risk.file_refs` / `review_focus`.
   *
   * Additionally (strict "from the blast map"): an eligible file ref survives
   * only if it is also a member of `blastFiles` — the set of files in this PR's
   * blast/change map. A real-but-off-map repo file is dropped just like a
   * fabricated one. Endpoint/absolute/URL refs still pass through as plain text.
   */
  private async groundBrief(repoRef: RepoRef, brief: Brief, blastFiles: Set<string>): Promise<Brief> {
    const clonePath = this.container.git.clonePathFor(repoRef);

    const groundRefs = async (refs: string[]): Promise<string[]> => {
      const kept: string[] = [];
      for (const ref of refs) {
        if (!isEligiblePathShape(ref)) {
          // Not a file-path shape (absolute / traversal / URL scheme /
          // endpoint) — pass through as plain text, never linked.
          kept.push(ref);
          continue;
        }
        // Strict: keep only refs that are BOTH in the blast/change map AND a
        // real in-tree file — so risks cite files actually in the blast radius.
        if (blastFiles.has(ref) && (await isGroundedPath(clonePath, ref))) kept.push(ref);
        // else: off the blast map (or fabricated) — drop the reference entirely.
      }
      return kept;
    };

    const risks: Risk[] = await Promise.all(
      brief.risks.map(async (r) => ({ ...r, file_refs: await groundRefs(r.file_refs) })),
    );

    const reviewFocusKept = await Promise.all(
      brief.review_focus.map(async (item) => ({
        item,
        ok:
          !isEligiblePathShape(item.path) ||
          (blastFiles.has(item.path) && (await isGroundedPath(clonePath, item.path))),
      })),
    );
    const review_focus = reviewFocusKept.filter((r) => r.ok).map((r) => r.item);

    return { ...brief, risks, review_focus };
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** `prFiles` can contain duplicate rows per path (seed/sync races) — dedup before use. */
function dedupeByPath<T extends { path: string }>(files: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const f of files) {
    if (seen.has(f.path)) continue;
    seen.add(f.path);
    out.push(f);
  }
  return out;
}

const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * True IFF `ref` has the SHAPE of a relative, in-tree file path — i.e. it is
 * NOT absolute, does NOT contain a `..` traversal segment, and does NOT
 * match a URL scheme. Endpoint-shaped refs (`GET /pulls/:id`, `/pulls/:id`)
 * are rejected here via the leading-`/` check and fall through as plain text
 * (Rec2). This is the shape gate only — `isGroundedPath` below does the
 * actual filesystem existence check for refs that pass this gate.
 */
function isEligiblePathShape(ref: string): boolean {
  if (!ref) return false;
  if (ref.startsWith('/')) return false;
  if (ref.includes('..')) return false;
  if (URL_SCHEME_RE.test(ref)) return false;
  return true;
}

/**
 * True IFF `relPath` resolves to a real, in-tree FILE under `clonePath`.
 * Mirrors the onboarding `isGroundedPath` precedent
 * (`server/src/modules/onboarding/extractor.ts`): re-confirms the resolved
 * path stays contained in `clonePath` after resolution (defence in depth
 * beyond the shape gate), then stats it. Returns `false` (never throws) when
 * the clone is absent or the target doesn't exist — best-effort.
 */
async function isGroundedPath(clonePath: string, relPath: string): Promise<boolean> {
  const root = resolve(clonePath) + sep;
  const target = resolve(clonePath, relPath);
  if (!target.startsWith(root)) return false;

  try {
    const info = await stat(target);
    return info.isFile();
  } catch {
    return false;
  }
}

/** Rec1: soft caps enforced by slicing/truncation (permissive Zod contract, no hard `.max()`). */
function applyCaps(brief: Brief): Brief {
  return {
    ...brief,
    what: brief.what.slice(0, TEXT_MAX),
    why: brief.why.slice(0, TEXT_MAX),
    risk_level: brief.risk_level as RiskSeverity,
    risks: brief.risks.slice(0, RISKS_MAX),
    review_focus: brief.review_focus.slice(0, REVIEW_FOCUS_MAX),
  };
}
