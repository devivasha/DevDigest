import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EvalCase,
  EvalCaseInput,
  EvalCaseStatus,
  EvalCompare,
  EvalDashboard,
  EvalRun,
  EvalSetRunRecord,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { EvalService } from './service.js';

/**
 * eval module routes (T8) — Eval Pipeline (L06).
 *
 *   GET    /agents/:id/eval-cases              → list an agent's eval cases
 *   GET    /agents/:id/eval-cases/status         → latest run status per case (AC-19 icons)
 *   POST   /agents/:id/eval-cases                → manual create
 *   POST   /agents/:id/eval-cases/from-finding    → create from a triaged finding
 *   PATCH  /eval-cases/:caseId                    → manual update
 *   DELETE /eval-cases/:caseId                    → delete
 *   POST   /agents/:id/eval-cases/:caseId/run     → run ONE case (rate-limited)
 *   POST   /agents/:id/eval-runs                  → run the whole set (rate-limited)
 *   GET    /agents/:id/eval-runs                  → run history
 *   GET    /agents/:id/eval-compare?base=&head=  → compare two runs
 *   GET    /agents/:id/eval-dashboard            → per-agent dashboard
 *   GET    /eval/dashboard                       → all-agents dashboard
 *
 * Onion layer: presentation — every handler resolves tenancy via `getContext`
 * FIRST (AC-24), then makes exactly one `EvalService` call, then replies. No
 * business logic lives here.
 *
 * Security (finding #4 / IDOR): for `POST .../eval-cases/from-finding`, the
 * route's `:id` is passed to the service ONLY as an authorization
 * cross-check against the finding's own review agent — the service derives
 * the true owner server-side and never trusts a caller-supplied agent id.
 */

/** Case editor / manual-create body — owner is derived from the route's
 *  `:id` (the agent), never accepted from the request body. */
const CreateEvalCaseBody = EvalCaseInput.omit({ owner_kind: true, owner_id: true });

/** Manual update (PATCH) — same fields as create, all optional. Mirrors
 *  `UpdateEvalCaseInput` (`repository.ts`) field-for-field. */
const UpdateEvalCaseBody = CreateEvalCaseBody.partial();

/** `POST .../eval-cases/from-finding` — the client sends only the finding
 *  id; the owning agent is derived server-side (finding #4). */
const CreateFromFindingBody = z.object({ finding_id: z.string() });

/** `/eval-cases/:caseId` addresses a case directly (not nested under an agent). */
const CaseIdParams = z.object({ caseId: z.string().uuid() });

/** `POST .../eval-cases/:caseId/run` — case scoped under its owning agent. */
const AgentCaseIdParams = z.object({ id: z.string(), caseId: z.string() });

/** `GET .../eval-compare` selects exactly two set runs by id (AC-13). */
const CompareQuery = z.object({
  base: z.string().uuid(),
  head: z.string().uuid(),
});

export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  // =========================================================================
  // Case CRUD
  // =========================================================================

  app.get(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, response: { 200: z.array(EvalCase) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new EvalService(app.container, req.log);
      return service.listCases(workspaceId, 'agent', req.params.id);
    },
  );

  // Registered before `POST /agents/:id/eval-cases/:caseId/run` — a distinct,
  // static-suffixed GET path, so there's no ambiguity with the list route
  // above (`/agents/:id/eval-cases`) or the parametric run route below.
  app.get(
    '/agents/:id/eval-cases/status',
    { schema: { params: IdParams, response: { 200: z.array(EvalCaseStatus) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new EvalService(app.container, req.log);
      return service.caseStatuses(workspaceId, 'agent', req.params.id);
    },
  );

  app.post(
    '/agents/:id/eval-cases',
    {
      schema: {
        params: IdParams,
        body: CreateEvalCaseBody,
        response: { 201: EvalCase },
      },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new EvalService(app.container, req.log);
      const created = await service.createCase(workspaceId, {
        ...req.body,
        owner_kind: 'agent',
        owner_id: req.params.id,
      });
      reply.status(201);
      return created;
    },
  );

  app.post(
    '/agents/:id/eval-cases/from-finding',
    {
      schema: {
        params: IdParams,
        body: CreateFromFindingBody,
        response: { 201: EvalCase },
      },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new EvalService(app.container, req.log);
      // `:id` is used only as an authorization cross-check inside the
      // service — the owning agent is derived from the finding's own
      // review (finding #4 / IDOR guard).
      const created = await service.createFromFinding(workspaceId, req.params.id, req.body.finding_id);
      reply.status(201);
      return created;
    },
  );

  app.patch(
    '/eval-cases/:caseId',
    {
      schema: {
        params: CaseIdParams,
        body: UpdateEvalCaseBody,
        response: { 200: EvalCase },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new EvalService(app.container, req.log);
      return service.updateCase(workspaceId, req.params.caseId, req.body);
    },
  );

  app.delete(
    '/eval-cases/:caseId',
    { schema: { params: CaseIdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new EvalService(app.container, req.log);
      await service.deleteCase(workspaceId, req.params.caseId);
      return { ok: true };
    },
  );

  // =========================================================================
  // Runs (AC-11, AC-12, AC-13, AC-15, AC-17, AC-18, AC-19)
  // =========================================================================

  app.post(
    '/agents/:id/eval-cases/:caseId/run',
    {
      schema: { params: AgentCaseIdParams, response: { 200: EvalCaseStatus } },
      // A single-case run is much cheaper than a full-set run but still fans
      // out to one model-backed review — cap at 20/min per caller.
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new EvalService(app.container, req.log);
      return service.runCase(workspaceId, req.params.id, req.params.caseId);
    },
  );

  app.post(
    '/agents/:id/eval-runs',
    {
      schema: { params: IdParams, response: { 200: EvalRun } },
      // Each request fans out to a full model-backed review per case — cap
      // at 10/min per caller (Non-functional, spec rate limit).
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new EvalService(app.container, req.log);
      return service.runSet(workspaceId, req.params.id);
    },
  );

  app.get(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams, response: { 200: z.array(EvalSetRunRecord) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new EvalService(app.container, req.log);
      return service.history(workspaceId, 'agent', req.params.id);
    },
  );

  app.get(
    '/agents/:id/eval-compare',
    {
      schema: {
        params: IdParams,
        querystring: CompareQuery,
        response: { 200: EvalCompare },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new EvalService(app.container, req.log);
      return service.compare(workspaceId, req.query.base, req.query.head);
    },
  );

  // =========================================================================
  // Dashboard (AC-14, AC-20, AC-21)
  // =========================================================================

  app.get(
    '/agents/:id/eval-dashboard',
    { schema: { params: IdParams, response: { 200: EvalDashboard } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new EvalService(app.container, req.log);
      return service.dashboard(workspaceId, 'agent', req.params.id);
    },
  );

  app.get(
    '/eval/dashboard',
    { schema: { response: { 200: EvalDashboard } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new EvalService(app.container, req.log);
      return service.dashboardAll(workspaceId);
    },
  );
}
