import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type {
  CiExport,
  CiExportInputBody,
  CiFailOn,
  CiFile,
  CiIngestInput,
  CiInstallation,
  CiRun,
  Provider,
  RepoRef,
  ReviewStrategy,
} from '@devdigest/shared';
import { CiExportInput } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { RequestContext } from '../_shared/context.js';
import { AppError, ConfigError, NotFoundError, ValidationError } from '../../platform/errors.js';
import * as t from '../../db/schema.js';
import { buildAgentBundle, type CiAgentBundleInput, type CiSkillBundleInput } from './generate.js';
import { buildWorkflowFile } from './workflow.js';
import {
  CI_BRANCH_NAME,
  DEFAULT_COMMIT_MESSAGE,
  DEFAULT_PR_BODY,
  DEFAULT_PR_TITLE,
} from './constants.js';
import { loadRunnerBundleFile, type RunnerBundleLoader } from './runner-bundle.js';
import type { CiIngestArtifact } from './repository.js';

/**
 * Minimal structured logger (pino-compatible: `(obj, msg?) => void`) — ONLY
 * the method this service actually calls (`warn`, on GitHub PR-open
 * degradation). Declared LOCALLY rather than importing `Logger` from
 * `../reviews/run-executor.js` (onion-architecture fix, MEDIUM finding: a
 * sibling module's internal type is not this module's dependency to take —
 * `ci/service.ts` only ever needs one method of it). Structurally compatible
 * with the real Fastify/pino request logger (`req.log`) passed in from
 * `routes.ts`, so no cast is needed at any call site.
 */
export interface CiLogger {
  warn: (obj: unknown, msg?: string) => void;
}

/**
 * Narrow local view of the agent fields `buildBundle`/`export` actually
 * read. Declared LOCALLY rather than importing `AgentRow` from
 * `../agents/repository.js` (onion-architecture fix, MEDIUM finding: `AgentRow`
 * is that module's Drizzle-inferred row type — an infrastructure-layer detail
 * this module has no business depending on). Field types are reused from the
 * shared `@devdigest/shared` enums (`Provider`, `ReviewStrategy`, `CiFailOn`)
 * so this stays in lock-step with the wire contract rather than duplicating
 * ad-hoc string types. Structurally compatible with the real `AgentRow`
 * returned by `agentsRepo.getById` (a superset), so no cast is needed at the
 * call site in `buildBundle`.
 */
export interface CiAgentInput {
  name: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  strategy: ReviewStrategy;
  ciFailOn: CiFailOn;
  version: number;
}

/**
 * T5 — ci application layer: export orchestration (bundle build, GitHub PR +
 * degradation, installation persistence), a side-effect-free preview of the
 * same bundle (`previewFiles`, AC-7), workspace/agent-scoped CI-run and
 * installation reads (with ownership checks — AC-15/AC-18/AC-19), and ingest
 * (auth, idempotent write delegation). No SQL here beyond one narrow,
 * justified direct read (see `resolveAgentWorkspace` below) — everything
 * else goes through `container.agentsRepo` / `container.ciRepo` / the
 * injected GitHub client.
 *
 * Constructed the same way as `EvalService`/other module services —
 * `new CiService(container)` from the route layer (T6); the runner-bundle
 * loader is a second, OPTIONAL constructor argument defaulting to the real
 * filesystem loader, so tests can swap in a stub without changing the call
 * site routes will use.
 */

/**
 * Machine-readable reason `CiExport.pr_url` came back `null` (AC-26). NOT
 * yet part of the shared `CiExport` Zod contract (no `reason`/`pr_open_*`
 * field exists there today — see `server/insights/INSIGHTS.md`, "Open
 * Questions", for the precedent where a similar gap on `CiInstallation` was
 * closed by a follow-up contract amendment). Exposed here as an additional
 * property on the service's return value so:
 *   - hermetic tests (T11) can assert on WHY degradation happened, and
 *   - a future route/contract update can surface it to the client for free
 *     (a Fastify/Zod response schema of `CiExport` will simply strip this
 *     extra key today, which is safe — it does not break the wire contract).
 */
export type CiPrOpenDegradedReason = 'github_token_missing' | 'github_api_error';

export interface CiExportResult extends CiExport {
  pr_open_reason?: CiPrOpenDegradedReason | null;
}

/** `owner/name` — no leading/trailing slash, exactly one separator, no
 *  whitespace in either segment (AC-28). Intentionally permissive on the
 *  character set within each segment; the goal is rejecting malformed shapes
 *  (`"foo"`, `"a/b/c"`, `""`) before any generation happens, not validating
 *  GitHub's exact username rules. */
const REPO_OWNER_NAME_RE = /^[^\s/]+\/[^\s/]+$/;

function assertValidRepo(repo: string): void {
  if (!REPO_OWNER_NAME_RE.test(repo)) {
    throw new ValidationError(`repo must be in "owner/name" form, got: ${JSON.stringify(repo)}`);
  }
}

function splitRepo(repo: string): RepoRef {
  const [owner, name] = repo.split('/');
  return { owner: owner!, name: name! };
}

/**
 * Constant-time compare of the SHA-256 hash of `providedSecret` against the
 * stored hash (AC-25, D4). `crypto.timingSafeEqual` throws on mismatched
 * buffer lengths, so lengths are guarded first rather than relying on the
 * throw — both are always 64-hex-char SHA-256 digests, but a missing/empty
 * stored hash or provided secret must fail closed regardless.
 */
function secretMatches(storedHash: string | null, providedSecret: string | null | undefined): boolean {
  if (!storedHash || !providedSecret) return false;
  const storedBuf = Buffer.from(storedHash, 'utf8');
  const providedBuf = Buffer.from(createHash('sha256').update(providedSecret, 'utf8').digest('hex'), 'utf8');
  if (storedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(storedBuf, providedBuf);
}

/** Thrown for every ingest auth failure (missing installation, missing
 *  secret, or mismatched secret) — deliberately the SAME error/message for
 *  all three so a caller cannot distinguish "no such installation" from
 *  "wrong secret" (AC-25 — no write, no enumeration signal either way). */
function ingestUnauthorized(): AppError {
  return new AppError('ingest_unauthorized', 'Invalid or missing ingest credentials', 401);
}

export class CiService {
  constructor(
    private container: Container,
    private loadRunnerBundle: RunnerBundleLoader = loadRunnerBundleFile,
    private logger?: CiLogger,
  ) {}

  // =========================================================================
  // Export (AC-4, AC-5, AC-7, AC-10, AC-11, AC-24, AC-25, AC-26, AC-28)
  // =========================================================================

  /**
   * Assembles the exact `CiFile[]` bundle for an agent — validate repo shape
   * (AC-28) → load agent + linked skills → `buildAgentBundle` +
   * `buildWorkflowFile` + the runner bundle file. Private and side-effect-
   * free (no DB write, no secret, no GitHub call) — shared verbatim by
   * `export()` (which persists/ships on top of it) and `previewFiles()`
   * (which returns it as-is). This is what GUARANTEES preview bytes === the
   * bytes ultimately committed/returned by `export()` (AC-7).
   */
  private async buildBundle(
    agentId: string,
    input: CiExportInputBody,
    ctx: RequestContext,
  ): Promise<{ files: CiFile[]; parsed: CiExportInput; agent: CiAgentInput }> {
    // Normalize/apply defaults regardless of whether the route already
    // parsed against the full `CiExportInput` schema or forwarded the raw
    // `CiExportInputBody` — cheap and idempotent either way.
    const parsed = CiExportInput.parse(input);

    // AC-28: reject BEFORE any generation.
    assertValidRepo(parsed.repo);

    const agent = await this.container.agentsRepo.getById(ctx.workspaceId, agentId);
    if (!agent) throw new NotFoundError(`Agent not found: ${agentId}`);

    const linkedSkills = await this.container.agentsRepo.linkedSkills(agentId);

    const agentInput: CiAgentBundleInput = {
      name: agent.name,
      provider: agent.provider,
      model: agent.model,
      system_prompt: agent.systemPrompt,
      strategy: agent.strategy,
      ci_fail_on: agent.ciFailOn,
    };
    const skillsInput: CiSkillBundleInput[] = linkedSkills.map((link) => ({
      name: link.skill.name,
      body: link.skill.body,
    }));

    const bundle = buildAgentBundle(agentInput, skillsInput);
    const workflowFile = buildWorkflowFile({ triggers: parsed.triggers, postAs: parsed.post_as });
    const runnerFile = await this.loadRunnerBundle();

    // AC-7: build the file list ONCE — this exact array is what gets
    // committed (when target=gha/open_pr) AND what is returned in the
    // response, so preview and ship are byte-for-byte identical.
    const files: CiFile[] = [...bundle.files, workflowFile, runnerFile];

    return { files, parsed, agent };
  }

  /**
   * AC-7 support: returns the REAL `CiFile[]` bundle for the client's
   * preview step WITHOUT any side effect — no `ci_installations` row, no
   * minted ingest secret, no GitHub call. Shares `buildBundle` with
   * `export()`, so preview bytes are guaranteed identical to shipped bytes.
   * Still runs `assertValidRepo` (AC-28) and the agent-not-found check via
   * `buildBundle`.
   */
  async previewFiles(agentId: string, input: CiExportInputBody, ctx: RequestContext): Promise<CiFile[]> {
    const { files } = await this.buildBundle(agentId, input, ctx);
    return files;
  }

  async export(agentId: string, input: CiExportInputBody, ctx: RequestContext): Promise<CiExportResult> {
    const { files, parsed, agent } = await this.buildBundle(agentId, input, ctx);

    // D4/AC-25: high-entropy secret generated locally (not via
    // SecretsProvider — that channel is for external API keys, this is a
    // freshly minted local credential). Only its hash is ever persisted;
    // the plaintext is returned exactly once, below, and never logged.
    const ingestSecret = randomBytes(32).toString('hex');
    const ingestSecretHash = createHash('sha256').update(ingestSecret, 'utf8').digest('hex');

    let prUrl: string | null = null;
    let prOpenReason: CiPrOpenDegradedReason | null = null;

    if (parsed.target === 'gha' && parsed.action === 'open_pr') {
      try {
        const github = await this.container.github();
        const repoRef = splitRepo(parsed.repo);
        await github.commitFiles(repoRef, {
          branch: CI_BRANCH_NAME,
          base: parsed.base,
          message: DEFAULT_COMMIT_MESSAGE,
          files: files.map((f) => ({ path: f.path, contents: f.contents })),
        });
        const opened = await github.openPullRequest(repoRef, {
          title: DEFAULT_PR_TITLE,
          head: CI_BRANCH_NAME,
          base: parsed.base,
          body: DEFAULT_PR_BODY,
        });
        prUrl = opened.url;
      } catch (err) {
        // AC-26: degrade — never a 500. `container.github()` throws
        // `ConfigError` when no token is configured; any other throw here is
        // a GitHub API error (network, auth, permissions, etc.). Neither the
        // error object nor any token/secret is logged — only a stable,
        // machine-readable reason code.
        prUrl = null;
        prOpenReason = err instanceof ConfigError ? 'github_token_missing' : 'github_api_error';
        this.logger?.warn(
          { agentId, target: parsed.target, reason: prOpenReason },
          'ci export: PR open degraded',
        );
      }
    }

    const installation = await this.container.ciRepo.insertInstallation({
      agentId,
      repo: parsed.repo,
      targetType: parsed.target,
      ingestSecretHash,
      version: agent.version,
    });

    return {
      installation,
      files,
      pr_url: prUrl,
      ingest_secret: ingestSecret,
      pr_open_reason: prOpenReason,
    };
  }

  // =========================================================================
  // Reads (AC-15, AC-18, AC-19) — tenancy/ownership belongs here, not in
  // routes.ts (onion-architecture: presentation stays thin).
  // =========================================================================

  /** Workspace-wide CI-sourced run history (AC-15). No ownership check
   *  beyond `workspaceId` itself — `listWorkspaceCiRuns` is already
   *  workspace-scoped. */
  async listWorkspaceRuns(workspaceId: string): Promise<CiRun[]> {
    return this.container.ciRepo.listWorkspaceCiRuns(workspaceId);
  }

  /**
   * An agent's CI installations (AC-18). `CiRepository.listAgentInstallations`
   * takes only an `agentId` — per its own doc comment, ownership must already
   * be verified by the caller (`ci_installations` carries no `workspace_id`
   * column). Verified here (not in the route) to prevent an IDOR read across
   * workspaces.
   */
  async listAgentInstallations(workspaceId: string, agentId: string): Promise<CiInstallation[]> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError(`Agent not found: ${agentId}`);
    return this.container.ciRepo.listAgentInstallations(agentId);
  }

  /** An agent's CI run history (AC-19). Same IDOR guard as
   *  `listAgentInstallations` — `listAgentCiRuns` is agent-scoped only. */
  async listAgentCiRuns(workspaceId: string, agentId: string): Promise<CiRun[]> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError(`Agent not found: ${agentId}`);
    return this.container.ciRepo.listAgentCiRuns(agentId);
  }

  // =========================================================================
  // Ingest (AC-21, AC-22, AC-23, AC-25)
  // =========================================================================

  /**
   * `ctx` is accepted for call-site symmetry with `export` (and in case the
   * route computes it via `getContext` for logging/consistency regardless),
   * but is NEVER used to resolve tenancy here — per D4/AC-25 the CI runner
   * has no session, so the workspace is derived exclusively from
   * `installationId -> installation.agentId -> agent.workspaceId`
   * (`resolveAgentWorkspace` below). A client-supplied workspace id is never
   * trusted for this endpoint.
   */
  async ingest(
    installationId: string,
    prNumber: number | null,
    input: CiIngestInput,
    providedSecret: string | null | undefined,
    _ctx?: RequestContext,
  ): Promise<CiRun[]> {
    const installation = await this.container.ciRepo.getInstallation(installationId);
    if (!installation) throw ingestUnauthorized();

    if (!secretMatches(installation.ingestSecretHash, providedSecret)) {
      throw ingestUnauthorized();
    }

    const agentWorkspace = await this.resolveAgentWorkspace(installation.agentId);
    if (!agentWorkspace) throw ingestUnauthorized();

    // AC-23: ONE stable `ran_at` resolved for the whole call, reused for
    // every artifact — matches `CiRepository.ingestResults`'s idempotency
    // key `(ci_installation_id, pr_number, ran_at)`. Never call `new Date()`
    // per artifact/per retry, or replays would never collide.
    const ranAt = new Date(input.ran_at);
    // Defense-in-depth: `CiIngestInput.ran_at` is now `z.string().datetime()`
    // (ISO-8601) at the contract layer, but a non-date string that somehow
    // reaches here (e.g. a stale client build validated against an older
    // contract) must be rejected BEFORE any write — an `Invalid Date` would
    // otherwise crash `.toISOString()` deep in `ingestResults`/`toRunDomain`
    // and surface as an unhandled 500 instead of a 422.
    if (Number.isNaN(ranAt.getTime())) {
      throw new ValidationError(`ran_at must be a valid ISO-8601 timestamp, got: ${JSON.stringify(input.ran_at)}`);
    }
    const artifacts: CiIngestArtifact[] = input.results.map((artifact) => ({ artifact, ranAt }));

    const resolvedPrNumber = prNumber ?? input.pr_number ?? null;

    return this.container.ciRepo.ingestResults(
      installation,
      resolvedPrNumber,
      artifacts,
      agentWorkspace.workspaceId,
    );
  }

  /**
   * Narrow, direct `agents` read used ONLY by `ingest` — there is no
   * `AgentsRepository` method to resolve an agent's workspace WITHOUT
   * already knowing that workspace (every existing method is workspace-
   * scoped-in, e.g. `getById(workspaceId, id)`), and `agents/repository.ts`
   * is outside this module's owned paths. This mirrors an existing,
   * established pattern in this codebase: several other services
   * (`blast/service.ts`, `onboarding/service.ts`, `intent/service.ts`,
   * `project-context/service.ts`, `conventions/service.ts`,
   * `brief/service.ts`) already import `db/schema.js` directly for reads no
   * repository method covers, rather than adding narrow one-off methods to
   * another module's repository. Flagged as a follow-up: a
   * `AgentsRepository.getWorkspaceId(agentId)` (or similar) would let this
   * ingest path go through the repository layer like everything else.
   */
  private async resolveAgentWorkspace(
    agentId: string,
  ): Promise<{ workspaceId: string } | undefined> {
    const [row] = await this.container.db
      .select({ workspaceId: t.agents.workspaceId })
      .from(t.agents)
      .where(eq(t.agents.id, agentId));
    return row;
  }
}
