# Answer Key — planted onion-architecture violations

> NOT given to any run. Used only for grading. Fixtures contain no comments hinting at these.

## TC1 — `fixtures/tc1-billing-module/` (full-module PR review)

| # | File | What's wrong | Layer / rule |
|---|------|--------------|--------------|
| V1 | service.ts `openInvoiceCount` | Service runs `this.container.db.select().from(t.invoices)` directly + `import * as t from db/schema` | Application must not touch DB / import Drizzle schema — delegate to repo |
| V2 | service.ts `chargeWorkspace` | Service does `new StripeClient(process.env.STRIPE_KEY!)` — adapter instantiated in service + secret via `process.env` | Adapters only from Container (composition root); secrets via injected SecretsProvider |
| V3 | service.ts `listInvoices` / repo return types | Service returns `InvoiceRow[]` ($inferSelect) — raw Drizzle row leaks past the application layer instead of a domain DTO | Drizzle types stay in infra; services return `vendor/shared/contracts` DTOs |
| V4 | routes.ts `/billing/summary` | Handler does `new BillingRepository(app.container.db)` — route bypasses the service layer | Presentation may import own service.ts only, never own repository.ts |
| V5 | routes.ts `/billing/summary` | Handler has a for-loop + if/else dunning-tier computation — business logic in a route | Routes are thin: validate → one service call → reply |
| V6 | routes.ts (all 3 handlers) | `req.headers['x-workspace-id']` read manually instead of `getContext(app.container, req)` | Context/workspace resolution goes through `_shared/context.ts` |
| V7 | repository.ts `seatCount` | `import { AgentsRepository } from '../agents/repository.js'` + `new AgentsRepository(this.db)` — infra reaches into another module's repository | Cross-module access only through the other module's service |
| V8 | repository.ts `getById` | Query filters by `id` only — missing `workspaceId` scope (cross-tenant leak) | Every tenant query must filter by workspaceId |
| V9 | repository.ts | `export type InvoiceRow = $inferSelect` exported + public methods return raw rows, no `toDomain()` mapper | $inferSelect stays private; map to domain before returning |
| V10 | contracts-billing.ts | Domain/contract file `import { z } from 'zod'` + `InvoiceSchema` | Domain zero-import rule — no zod/fastify/drizzle in contracts |

Notes for grading:
- V3 and V9 are the same underlying defect (raw row leak) seen at two layers. Credit either the service-side or repo-side observation; don't double-penalize a reviewer that merges them.
- Strong finds: V2 (secret + adapter), V7 (cross-module repo), V8 (workspace scope), V9/V3 ($inferSelect leak), V10 (zod in domain) are the DevDigest-specific ones a generic reviewer often misses.

## TC2 — `fixtures/tc2-usage/service.ts` (subtle, single file, NOT told to audit)

| # | File | What's wrong | Layer / rule |
|---|------|--------------|--------------|
| U1 | service.ts `monthlyTokens` | Direct `container.db.select()` in service (no repository at all) + imports db/schema | Application must not query DB |
| U2 | service.ts `summarizeUsage` | `new OpenAIProvider(process.env.OPENAI_API_KEY!)` — adapter instantiated in service + secret via process.env | Adapters from `container.llm(...)`; secrets via SecretsProvider |
| U3 | (structural) | No repository layer exists — all I/O lives in the service | Should introduce repository.ts for the DB access |

The key question for TC2: does the run *proactively* raise architecture concerns even though the prompt only says "about to commit, anything you'd flag?" (not "audit the architecture").

## TC3 — placement / greenfield design (no fixture)

Expected correct placement:
- Stripe pull → new adapter under `src/adapters/stripe/`, implements a port; wired in `platform/container.ts`; consumed via `container`.
- Proration math → pure domain function (domain layer), no I/O; orchestrated by the service.
- Validate upgrade body → Zod HTTP schema at top of `routes.ts` (presentation).
- Persist invoices → `repository.ts` (infra), workspace-scoped, with `toDomain()` mapper.
- Endpoints → thin handlers: `getContext` → one service method → reply.
- `Invoice` / `PlanTier` types → `vendor/shared/contracts/`, zero framework imports.
- Composition (`new StripeAdapter()`) → only in `container.ts`.

Tests placement vocabulary + decision trees, not detection.

## TC3 (eval id 3) — `fixtures/tc4-webhooks-clean/` (false-positive control)

This module is **fully compliant**. There are NO planted violations. Correct grade = the run reports zero architecture violations.

Compliance checklist (all satisfied):
- contracts-webhooks.ts — pure types, zero framework imports.
- repository.ts — `$inferSelect` (`WebhookRow`) is private/unexported, every public method returns the `WebhookSubscription` DTO via `toDomain()`, all queries filter by `workspaceId`, no cross-module imports.
- service.ts — takes `Container`, delegates to repo only (no `container.db`, no `new SomeAdapter()`), application-level limit check via `AppError`, returns DTOs.
- routes.ts — thin handlers: `getContext` → one service call → reply; Zod HTTP schemas at top; no business logic; errors propagate.

A run FAILS this case if it fabricates a layering/dependency violation. Acceptable: minor optional nitpicks (naming, a suggested index, etc.) as long as they are not framed as onion-architecture violations. The key metric: did the skill make the model *over-report* on clean code?
