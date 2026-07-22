import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CiExport, CiExportInput, CiFile, CiIngestInput, CiInstallation, CiRun } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { CiService } from './service.js';

/**
 * ci module routes (T6) — Export-to-CI (L06).
 *
 *   POST   /agents/:id/export-ci          → generate + (optionally) ship a CI bundle (AC-26, AC-28)
 *   POST   /agents/:id/ci/preview         → side-effect-free bundle preview, same bytes as export (AC-7)
 *   GET    /ci/runs                       → workspace-wide CI-sourced run history (AC-15)
 *   GET    /agents/:id/ci/installations   → an agent's CI installations (AC-18)
 *   GET    /agents/:id/ci/runs            → an agent's CI run history (AC-19)
 *   POST   /ci/ingest                     → CI runner reports results back (AC-21, AC-22, AC-25)
 *
 * Onion layer: presentation — every handler resolves tenancy via `getContext`
 * FIRST, then makes exactly one `CiService` call, then replies. No business
 * logic — including ownership/IDOR checks — lives here; those live in
 * `CiService` (e.g. `listAgentInstallations`/`listAgentCiRuns` verify the
 * agent belongs to the workspace before touching `ci_installations`/`ci_runs`,
 * neither of which carry a `workspace_id` column of their own).
 *
 * `POST /ci/ingest` is the ONE exception (D4/AC-25): the CI runner has no
 * session, so it does NOT call `getContext` for tenancy. It authenticates via
 * a per-installation secret carried in the `x-devdigest-ingest-secret`
 * header; `CiService.ingest` derives the workspace itself from
 * `installation_id -> installation.agentId -> agent.workspaceId` and throws a
 * 401 `AppError` for any missing/unknown installation or mismatched secret
 * (never trusting a caller-supplied workspace). The header value is never
 * logged.
 */

/** `POST /agents/:id/export-ci` body — full `CiExportInput` (all fields
 *  default, so an empty body `{}` still parses); the response is the plain
 *  `CiExport` contract — the service's `CiExportResult` is a strict superset
 *  (adds `pr_open_reason`, already present on `CiExport` as `.nullish()`) and
 *  serializes cleanly against it via `fastify-type-provider-zod`. */
const ExportCiBody = CiExportInput;

/** `POST /ci/ingest` reads the per-installation secret from a request header
 *  (never the body) — matches `CiExport.ingest_secret`'s doc comment. Absent
 *  header parses to `undefined`, which `CiService.ingest`/`secretMatches`
 *  already treat as an auth failure (fails closed). */
const IngestHeaders = z
  .object({ 'x-devdigest-ingest-secret': z.string().optional() })
  .passthrough();

export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/agents/:id/export-ci',
    {
      schema: {
        params: IdParams,
        body: ExportCiBody,
        response: { 200: CiExport },
      },
    },
    async (req) => {
      const ctx = await getContext(app.container, req);
      const service = new CiService(app.container, undefined, req.log);
      return service.export(req.params.id, req.body, ctx);
    },
  );

  app.post(
    '/agents/:id/ci/preview',
    {
      schema: {
        params: IdParams,
        body: ExportCiBody,
        response: { 200: z.array(CiFile) },
      },
    },
    async (req) => {
      const ctx = await getContext(app.container, req);
      const service = new CiService(app.container, undefined, req.log);
      return service.previewFiles(req.params.id, req.body, ctx);
    },
  );

  app.get(
    '/ci/runs',
    { schema: { response: { 200: z.array(CiRun) } } },
    async (req) => {
      const ctx = await getContext(app.container, req);
      const service = new CiService(app.container);
      return service.listWorkspaceRuns(ctx.workspaceId);
    },
  );

  app.get(
    '/agents/:id/ci/installations',
    { schema: { params: IdParams, response: { 200: z.array(CiInstallation) } } },
    async (req) => {
      const ctx = await getContext(app.container, req);
      const service = new CiService(app.container);
      return service.listAgentInstallations(ctx.workspaceId, req.params.id);
    },
  );

  app.get(
    '/agents/:id/ci/runs',
    { schema: { params: IdParams, response: { 200: z.array(CiRun) } } },
    async (req) => {
      const ctx = await getContext(app.container, req);
      const service = new CiService(app.container);
      return service.listAgentCiRuns(ctx.workspaceId, req.params.id);
    },
  );

  app.post(
    '/ci/ingest',
    {
      schema: {
        headers: IngestHeaders,
        body: CiIngestInput,
        response: { 200: z.array(CiRun) },
      },
    },
    async (req) => {
      // No `getContext` here (see module doc comment above) — the CI runner
      // has no session. Auth + tenancy are entirely derived server-side by
      // `CiService.ingest` from the header secret + `installation_id`.
      const providedSecret = req.headers['x-devdigest-ingest-secret'];
      const service = new CiService(app.container, undefined, req.log);
      return service.ingest(
        req.body.installation_id,
        req.body.pr_number ?? null,
        req.body,
        providedSecret,
      );
    },
  );
}
