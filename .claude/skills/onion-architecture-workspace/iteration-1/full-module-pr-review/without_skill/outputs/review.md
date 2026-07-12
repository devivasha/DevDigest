# Billing module — pre-PR architecture review

Reviewed `server/src/modules/billing/{routes,service,repository,contracts-billing}.ts`.
The module works, but several things cut across our onion layering (Presentation → Application → Infrastructure → Domain, dependencies point inward only) and our DI/secrets discipline. Findings below, ordered by severity, each with the file and a concrete fix.

---

## Critical

### 1. `service.ts` — Stripe adapter is `new`'d and reads `process.env` directly
```ts
// service.ts:31-33
async chargeWorkspace(...) {
  const stripe = new StripeClient(process.env.STRIPE_KEY!);
  ...
}
```
Two structural violations in one line:

- **Secrets rule.** `LocalSecretsProvider` is the *only* place allowed to touch `process.env`. Everywhere else consumes the injected `SecretsProvider`. Reading `process.env.STRIPE_KEY!` here breaks that and makes the service impossible to test without setting real env.
- **DI / inward dependency.** The Application layer (service) should depend on an *injected* adapter obtained from the container, not construct a concrete Infrastructure class itself. `new StripeClient(...)` hard-wires the service to a concrete implementation and to its constructor shape.

**Fix.** Resolve the Stripe client from the container (which already holds the wired adapter built with a secret from `SecretsProvider`):
```ts
constructor(private container: Container) {
  this.repo = new BillingRepository(container.db);
}
async chargeWorkspace(workspaceId: string, amountCents: number) {
  const charge = await this.container.stripe.charge({ workspaceId, amountCents });
  await this.repo.markPaid(charge.invoiceId);
  return charge.id;
}
```
Wire `StripeClient` once in the container/composition root, passing the key from `secrets.get('STRIPE_KEY')`.

---

## High

### 2. `routes.ts` — `/billing/summary` handler contains business logic and reaches past the service into the DB
```ts
// routes.ts:27-43
const repo = new BillingRepository(app.container.db);
const invoices = await repo.listByWorkspace(workspaceId);
let total = 0; let tier = 'none';
for (const inv of invoices) { if (inv.status === 'open') total += inv.amountCents; }
if (total > 100_000) tier = 'suspend'; else if (total > 10_000) tier = 'warning';
```
The Presentation layer is doing two things it shouldn't:
- Instantiating a **repository** (Infrastructure) directly and pulling `app.container.db` — Presentation should never skip the Application layer to touch data access.
- Computing the amount-due total and the dunning-tier thresholds — that's domain/application logic living in a route handler. The `100_000` / `10_000` thresholds are business policy and belong next to the rest of billing logic where they can be unit-tested.

**Fix.** Move this into the service and let the route just call it:
```ts
// service.ts
async getSummary(workspaceId: string): Promise<{ totalDueCents: number; tier: DunningTier }> {
  const invoices = await this.repo.listByWorkspace(workspaceId);
  const totalDueCents = invoices
    .filter(i => i.status === 'open')
    .reduce((sum, i) => sum + i.amountCents, 0);
  const tier = totalDueCents > 100_000 ? 'suspend'
             : totalDueCents > 10_000 ? 'warning' : 'none';
  return { totalDueCents, tier };
}
// routes.ts
app.get('/billing/summary', async (req) =>
  service.getSummary(req.headers['x-workspace-id'] as string));
```

### 3. `service.ts` — service queries the DB directly, bypassing its repository
```ts
// service.ts:23-29
async openInvoiceCount(workspaceId: string) {
  const rows = await this.container.db.select().from(t.invoices)
    .where(eq(t.invoices.workspaceId, workspaceId));
  return rows.filter(r => r.status === 'open').length;
}
```
The Application layer is issuing a raw Drizzle query and importing the DB schema (`import * as t from '../../db/schema.js'`, line 3). Data access and knowledge of table shapes belong in the repository (Infrastructure). Every other method in this same class correctly goes through `this.repo`; this one is the odd one out.

**Fix.** Add the query to `BillingRepository` and delegate. Also drop the `db/schema` import from the service so the Application layer no longer knows about tables:
```ts
// repository.ts
async openInvoiceCount(workspaceId: string): Promise<number> {
  const rows = await this.listByWorkspace(workspaceId);
  return rows.filter(r => r.status === 'open').length;
}
// service.ts
openInvoiceCount(workspaceId: string) { return this.repo.openInvoiceCount(workspaceId); }
```

### 4. `repository.ts` — billing repo instantiates another module's repository (cross-module coupling at the wrong layer)
```ts
// repository.ts:4, 29-33
import { AgentsRepository } from '../agents/repository.js';
async seatCount(workspaceId: string) {
  const agents = new AgentsRepository(this.db);
  return (await agents.list(workspaceId)).length;
}
```
The file header says this repo "Owns `invoices` and `subscriptions`", yet `seatCount` reaches into the **agents** module's repository. Repo-to-repo calls across modules couple two data-access layers directly and make module boundaries meaningless (billing now silently depends on agents' internals). Cross-module composition should happen up in the Application layer, not repo-to-repo.

**Fix.** Let the billing *service* depend on the agents service (or an injected read port) and pass the seat count down, rather than one repository importing another:
```ts
// service.ts — compose across modules here, via the container
async seatCount(workspaceId: string) {
  return this.container.agentsService.countForWorkspace(workspaceId);
}
```
Keep `BillingRepository` restricted to the `invoices`/`subscriptions` tables it owns.

---

## Medium

### 5. `routes.ts` — `BillingService` is constructed with `new` instead of resolved from the container
```ts
// routes.ts:20
const service = new BillingService(app.container);
```
Not fatal (it does thread the container through), but it bypasses DI: the route decides how to build the service. Consistent with the rest of the backend, the service should be resolved from the container (`app.container.billingService`) so wiring stays in the composition root and handlers stay ignorant of construction. This also removes the `new BillingRepository(...)` in the summary handler once finding #2 is applied.

### 6. `contracts-billing.ts` — Zod schema and TS types have drifted, and the file is likely in the wrong place
```ts
// contracts-billing.ts
export interface Invoice { id; workspaceId; amountCents; status; createdAt }
export const InvoiceSchema = z.object({
  id: z.string().uuid(),
  amount_cents: z.number().int().nonnegative(),   // snake_case
  status: z.enum([...]),                            // missing workspaceId, createdAt
});
export type InvoiceStatus = 'draft'|'open'|'paid'|'void';  // duplicates the enum
```
Three issues:
- **Divergent source of truth.** `Invoice.amountCents` (camelCase) vs `InvoiceSchema.amount_cents` (snake_case), and the schema omits `workspaceId`/`createdAt`. The interface and the validator describe different shapes. Derive one from the other with `z.infer<typeof InvoiceSchema>` so they can't drift, and pick one casing convention for the wire.
- **`InvoiceStatus` duplicated** as both a hand-written union and the enum inside the schema — collapse to a single definition.
- **Placement.** The header says these contracts are "used by the billing module … and the client billing dashboard." Types shared between server and client live in the shared package (`server/src/vendor/shared/`, the `@devdigest/shared` alias), not inside a server module — the client can't import from `server/src/modules/billing`. If it's truly shared, move it to shared; if it's server-only, drop the "client dashboard" claim.

---

## Minor / nits
- `routes.ts` — `x-workspace-id` is read and cast `as string` in three handlers with no validation; a missing header yields `undefined` silently. Consider a shared header schema / preHandler so workspace scoping is enforced in one place.
- `routes.ts` — routes define request schemas but no **response** schemas, so `fastify-type-provider-zod` can't serialize/validate output. Wire the contract schemas as `response` on each route.
- Response payloads use snake_case (`total_due_cents`, `charge_id`) while internal types use camelCase — fine, but make it a deliberate, documented boundary rather than ad hoc per handler.

---

### Summary of layer violations
| # | File | Problem | Layer rule broken |
|---|------|---------|-------------------|
| 1 | service.ts | `new StripeClient(process.env.…)` | secrets + DI; App→concrete Infra |
| 2 | routes.ts | summary handler = repo access + business logic | Presentation skips App / holds domain logic |
| 3 | service.ts | direct Drizzle query + schema import | App doing Infra's job |
| 4 | repository.ts | imports agents repo | cross-module repo-to-repo coupling |
| 5 | routes.ts | `new BillingService` | DI construction in Presentation |
| 6 | contracts-billing.ts | schema/type drift + placement | single source of truth / shared-contract location |
