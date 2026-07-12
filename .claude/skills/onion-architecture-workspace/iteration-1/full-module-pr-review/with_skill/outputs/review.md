# Architecture review — `billing` module

Reviewed against the onion-architecture rules (inward-only dependencies, four-layer split). There are a number of layering violations across all four files. Grouped by file below, each with the offending line, why it breaks the rule, and the fix. The blocking ones are marked **CRITICAL**.

---

## `routes.ts` (Presentation)

**1. CRITICAL — Route imports and instantiates its own repository, skipping the service.**
`import { BillingRepository } from './repository.js';` (line 5) and `const repo = new BillingRepository(app.container.db);` (line 29).
Presentation may only import its own `service.ts`. A route reaching into `repository.ts` bypasses the application layer entirely (dependency-rule: "Own module's `repository.ts` — May NOT import").
Fix: delete the repository import; get all data through `service`.

**2. CRITICAL — `/billing/summary` handler contains business logic.**
Lines 32–41 loop over invoices, sum `amountCents` for `open` invoices, and compute a dunning tier (`none`/`warning`/`suspend`) with threshold branching. That is a business rule, not HTTP shaping. Routes do exactly three things: validate, call one service method, respond (presentation-layer: "The Three-Step Rule"). Branching + loops must move to the service.
Fix: add `service.getSummary(workspaceId)` that returns `{ total_due_cents, tier }`; the handler becomes `return service.getSummary(workspaceId);`.

**3. CRITICAL — Manual `workspaceId` extraction from headers.**
`const workspaceId = req.headers['x-workspace-id'] as string;` (lines 23, 28, 46).
The rule is explicit: never pull `workspaceId` from `req.headers` in a handler; use `getContext(container, req)` from `modules/_shared/context.ts` (presentation-layer: "Context Extraction"). The `as string` cast also silently accepts a missing header.
Fix: `const { workspaceId } = await getContext(app.container, req);` at the top of each handler.

Minor: the `GET` handlers declare no response schema, and the module is wired via the `app.container` decorator rather than the documented `FastifyPluginAsync<{ container: Container }>` plugin-option pattern (di-container: "Module Registration"). Not blocking, but worth aligning with the other modules.

---

## `service.ts` (Application)

**4. CRITICAL — Service imports Drizzle and the DB schema.**
`import { eq } from 'drizzle-orm';` (line 1) and `import * as t from '../../db/schema.js';` (line 3).
Application may not import `drizzle-orm` or `db/schema/*` (dependency-rule allow-list). Those belong to infrastructure only.

**5. CRITICAL — Direct DB query in `openInvoiceCount`.**
Lines 24–28 run `this.container.db.select().from(t.invoices)...` and filter in JS. Services must never touch `container.db`; they delegate to the repository (application-layer: "What Services MUST NOT Do").
Fix: add `BillingRepository.countOpen(workspaceId)` (do the filtering in SQL) and call `this.repo.countOpen(workspaceId)`. This also removes finding 4's imports.

**6. CRITICAL — Adapter instantiated in the service, and secret read from `process.env`.**
`const stripe = new StripeClient(process.env.STRIPE_KEY!);` (line 32) plus `import { StripeClient } from '../../adapters/stripe/stripe.js';` (line 4).
Two violations: (a) `new` on an adapter is only allowed in `container.ts` — services pull adapters from the Container (di-container: "The One Rule: `new` Only in Container"; application-layer: "Receiving Adapters from Container"); (b) only `LocalSecretsProvider` may read `process.env` — everywhere else uses the injected `SecretsProvider` (CLAUDE.md "Secrets").
Fix: wire Stripe in `container.ts` (with the key fetched via `container.secrets`), expose it as e.g. `container.stripe`, and in the service use `const stripe = await this.container.stripe;`.

**7. CRITICAL — Service returns a raw Drizzle row type.**
`async listInvoices(...): Promise<InvoiceRow[]>` (line 19) returns `InvoiceRow` (= `$inferSelect`, imported from the repo on line 5). Services must return DTOs from `vendor/shared/contracts/`, never DB rows — the Drizzle type is leaking two layers out (application-layer: "Returning raw DB rows"; core principle #4).
Fix: return `Invoice[]` (the contract type); have the repository map with `toDomain()` (see finding 9).

---

## `repository.ts` (Infrastructure)

**8. CRITICAL — Repository imports another module's repository.**
`import { AgentsRepository } from '../agents/repository.js';` (line 4), used in `seatCount` (lines 29–33) via `new AgentsRepository(this.db)`.
Infrastructure may not import another module's `repository.ts` — cross-module data goes through that module's service, or a shared repo exposed on the Container (dependency-rule: "Cross-Module Communication"). Instantiating a sibling repo with `new` compounds it.
Fix: move seat counting up to `BillingService`, which reads agents via `container.agentsRepo` (the pre-built shared repo). Drop `seatCount` from this file.

**9. CRITICAL — `$inferSelect` is exported and returned instead of a domain type.**
`export type InvoiceRow = typeof t.invoices.$inferSelect;` (line 10), and every public method returns `InvoiceRow`. `$inferSelect` must stay private and never leave the repository; public methods return contract types via a private `toDomain()` mapper (infrastructure-layer: "Data Mapper Rules", core principle #4). There is no `toDomain()` here at all — the `Invoice` contract type exists but is never used.
Fix: make the row type a private, non-exported `type InvoiceRow = ...`; add `private toDomain(row): Invoice`; return `Invoice` / `Invoice[]` from all public methods.

**10. CRITICAL — Missing workspace scoping on `getById` and `markPaid`.**
`getById` (line 21) and `markPaid` (line 25) filter on `id` only. Every tenant-data query must also filter by `workspaceId` or it's a cross-tenant leak (infrastructure-layer: "Workspace Scoping — MANDATORY"). `markPaid` is in the charge path, so an unscoped update is especially dangerous.
Fix: thread `workspaceId` through both and use `and(eq(t.invoices.id, id), eq(t.invoices.workspaceId, workspaceId))`.

---

## `contracts-billing.ts` (Domain)

**11. CRITICAL — Domain contract imports Zod.**
`import { z } from 'zod';` (line 1) and `export const InvoiceSchema = z.object({...})` (lines 19–23).
Domain has a zero-import rule — no `zod`, `drizzle-orm`, or `fastify` (domain-layer: "The Zero-Import Rule"). Its snake_case fields (`amount_cents`) show it is actually an HTTP wire schema, not a domain type.
Fix: move `InvoiceSchema` to the billing `routes.ts` (or `modules/_shared/schemas.ts`). Keep this file pure TypeScript types only.

**12. HIGH — Domain contracts are in the wrong location.**
Domain types live in `src/vendor/shared/contracts/`, not inside `modules/billing/` (layers: "Layer → Project Folder Mapping"). Keeping `Invoice` / `Subscription` in the module also blocks the client from importing them, which the file header says is the intent.
Fix: move the interfaces/types to `src/vendor/shared/contracts/billing.ts`; delete `contracts-billing.ts`.

Minor: `InvoiceSchema` (`amount_cents`) and the `Invoice` interface (`amountCents`) disagree on casing — resolved naturally once the schema moves to presentation (wire = snake_case) and the interface stays the domain shape (camelCase).

---

## Summary

| # | File | Issue | Severity |
|---|------|-------|----------|
| 1 | routes.ts | Imports/instantiates own repository, skips service | CRITICAL |
| 2 | routes.ts | Business logic (summing + dunning tier) in handler | CRITICAL |
| 3 | routes.ts | Manual `workspaceId` from headers instead of `getContext` | CRITICAL |
| 4 | service.ts | Imports `drizzle-orm` + `db/schema` | CRITICAL |
| 5 | service.ts | Direct `container.db` query | CRITICAL |
| 6 | service.ts | `new StripeClient(process.env...)` — adapter + secret in service | CRITICAL |
| 7 | service.ts | Returns raw `InvoiceRow` (`$inferSelect`) | CRITICAL |
| 8 | repository.ts | Imports another module's repository | CRITICAL |
| 9 | repository.ts | Exports `$inferSelect`, no `toDomain()` mapper | CRITICAL |
| 10 | repository.ts | Missing `workspaceId` scope on `getById` / `markPaid` | CRITICAL |
| 11 | contracts-billing.ts | Domain type imports Zod | CRITICAL |
| 12 | contracts-billing.ts | Domain types live in module, not `vendor/shared/contracts/` | HIGH |

The common thread: infrastructure concerns (Drizzle, adapters, DB rows, secrets) have leaked up into the service and route layers, and the repository/routes reach sideways into other modules. Push all I/O back into `repository.ts` + the Container, have the repo map rows to the `Invoice` contract, move the wire schema into `routes.ts`, and relocate the domain types to `vendor/shared/contracts/`. That resolves every finding above.
