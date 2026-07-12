# Placing usage-based billing across the module

Everything lives in one new module, `server/src/modules/billing/`, plus one new adapter and (per the onion rule) the Stripe interface + proration logic in the domain. The load-bearing idea: **the Stripe SDK, Drizzle, and Fastify never touch the same file.** Each of your five pieces lands in exactly one layer, and they only ever talk *inward*.

```
server/src/
├── adapters/
│   └── stripe/
│       └── stripe-client.ts       ← (1) Stripe I/O — implements a domain interface
├── vendor/shared/
│   ├── contracts/
│   │   └── billing.ts             ← domain DTOs: Subscription, Invoice, UpgradeQuote, BillingSummary
│   ├── adapters.ts                ← add BillingGateway interface (Stripe's contract)
│   └── billing/
│       └── proration.ts           ← (2) pure proration math — no I/O, no Zod
├── modules/billing/
│   ├── routes.ts                  ← (3 HTTP-shape) + (5) GET /billing/summary, POST /billing/upgrade
│   ├── service.ts                 ← orchestrator — the only file that knows the whole flow
│   └── repository.ts              ← (4) Drizzle persistence for invoices
├── db/schema/billing.ts           ← invoices table
└── platform/container.ts          ← wires the Stripe adapter + billing repo (only place with `new`)
```

## Where each of the five pieces lives

### (1) Pull subscription + past invoices from Stripe → **Infrastructure adapter**

Stripe is external I/O, so it goes in `src/adapters/stripe/stripe-client.ts`, **not** in `modules/`. It's the only file allowed to import the `stripe` SDK. It implements an interface you define in `vendor/shared/adapters.ts`:

```typescript
// vendor/shared/adapters.ts
export interface BillingGateway {
  getSubscription(customerId: string): Promise<Subscription>;
  listInvoices(customerId: string): Promise<Invoice[]>;
  applyUpgrade(customerId: string, plan: PlanId): Promise<Subscription>;
}
```

The adapter maps Stripe's SDK objects into your domain `Subscription` / `Invoice` contract types at its boundary — the same discipline as a repository's `toDomain()`. No raw `Stripe.Invoice` ever leaves this file. The service depends on the `BillingGateway` *interface*, never on Stripe directly, which is what lets you swap a mock in tests via `ContainerOverrides`.

### (2) Compute proration on mid-cycle upgrade → **Domain**

Proration is pure business computation — money math with invariants, no database, no HTTP, no Stripe call. That makes it a domain service function in `vendor/shared/billing/proration.ts`:

```typescript
// vendor/shared/billing/proration.ts — zero framework imports
export function computeProration(input: {
  currentPlan: Plan;
  targetPlan: Plan;
  cycleStart: Date;
  cycleEnd: Date;
  now: Date;
}): UpgradeQuote {
  // pure arithmetic; throw AppError('invalid_proration', …) on a broken invariant
}
```

Rules from the skill that apply here: **no `zod`, no `drizzle-orm`, no `fastify` imports** — validate invariants with plain guard clauses that throw `AppError`. Keeping this pure is what makes proration unit-testable without a DB or Stripe stub. If you already have real proration numbers from Stripe's preview API, that *fetch* is adapter work (piece 1); this function is for the math you own/verify.

### (3) Validate the upgrade request body → **Presentation (mostly)**

The wire-shape check — is `plan` present, a known enum, is the body well-formed — is an HTTP concern. It's a Zod schema at the top of `routes.ts` (or `_shared/schemas.ts` if reused), registered via the Fastify `schema` option so `fastify-type-provider-zod` rejects bad shapes with a 422 before your handler runs:

```typescript
// modules/billing/routes.ts
const UpgradeBody = z.object({ plan: z.enum(['pro', 'scale', 'enterprise']) });
```

Keep this to *shape only*. Business preconditions that need a lookup — "is this workspace already on that plan or higher?", "is there an active subscription to upgrade?" — are **not** HTTP validation; they belong in the service as guard clauses throwing `AppError(..., 422)`. Don't duplicate a check across both layers.

### (4) Persist invoices to Postgres → **Infrastructure repository**

`modules/billing/repository.ts` is the only billing file that speaks Drizzle. Define the table in `db/schema/billing.ts` (generate + run a migration explicitly — never auto-run). The repo exposes methods returning domain `Invoice[]`, with `$inferSelect`/`$inferInsert` kept **private** behind `toDomain()` / `toDb()` mappers. Every query is **workspace-scoped** (`where(and(eq(invoices.id, id), eq(invoices.workspaceId, workspaceId)))`) — mandatory, no exceptions, or you leak cross-tenant data. If saving invoices must be atomic (e.g. bulk sync), the repository owns the `db.transaction()` boundary, not the service.

### (5) Expose the two routes → **Presentation**

`modules/billing/routes.ts` is a Fastify plugin taking `{ container }`. Each handler does exactly three things: resolve context → call **one** service method → send the reply.

```typescript
export const billingRoutes: FastifyPluginAsync<{ container: Container }> = async (fastify, { container }) => {
  const service = new BillingService(container);

  fastify.get('/billing/summary', { schema: { response: { 200: BillingSummaryResponse } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      return reply.send(await service.getSummary(workspaceId));
    });

  fastify.post('/billing/upgrade', { schema: { body: UpgradeBody, response: { 200: UpgradeResultResponse } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      return reply.send(await service.upgrade(workspaceId, req.body.plan));
    });
};
```

No `if/else`, no loops, no repo/adapter access, no error catching — let `AppError`s propagate to the global handler in `app.ts`. Register the plugin in `app.ts`: `await fastify.register(billingRoutes, { container })`.

## How they talk to each other

The **application service (`modules/billing/service.ts`) is the hub** — the one file that knows the whole workflow. It receives `Container` in its constructor, instantiates its own cheap repo, and pulls the Stripe adapter lazily from the container. Nothing else orchestrates.

```typescript
export class BillingService {
  private repo: BillingRepository;
  constructor(private container: Container) {
    this.repo = new BillingRepository(container.db);   // own repo: cheap, instantiate here
  }

  async getSummary(workspaceId: string): Promise<BillingSummary> {
    const customerId = await this.repo.getCustomerId(workspaceId);        // infra
    const billing = this.container.billing;                              // adapter from container
    const [subscription, invoices] = await Promise.all([                // Stripe I/O (piece 1)
      billing.getSubscription(customerId),
      billing.listInvoices(customerId),
    ]);
    await this.repo.upsertInvoices(workspaceId, invoices);              // persist (piece 4)
    return { subscription, invoices };                                  // domain DTO out
  }

  async upgrade(workspaceId: string, plan: PlanId): Promise<UpgradeResult> {
    const sub = await this.container.billing.getSubscription(await this.repo.getCustomerId(workspaceId));
    if (sub.plan === plan) throw new AppError('already_on_plan', 'Already on this plan', 422); // app precondition
    const quote = computeProration({ currentPlan: sub.plan, targetPlan: plan, /* … */ });      // domain (piece 2)
    const updated = await this.container.billing.applyUpgrade(sub.customerId, plan);           // Stripe I/O
    const invoice = await this.repo.recordUpgradeInvoice(workspaceId, quote);                  // persist
    return { subscription: updated, quote, invoice };
  }
}
```

The data flowing between layers is always **domain contract types** (`Subscription`, `Invoice`, `UpgradeQuote`) from `vendor/shared/contracts/billing.ts` — never a raw Stripe object, never a Drizzle row. That shared contract is also what the Next.js client imports for type safety.

Dependency directions, all inward:
- `routes.ts` → `service.ts` (never the repo or adapter directly)
- `service.ts` → `BillingGateway` interface, `BillingRepository`, `computeProration()` (domain) — never the Stripe SDK, never Drizzle, never `db/schema`
- `repository.ts` → `drizzle-orm`, `db/schema/billing.ts`, domain contracts — never the service
- `adapters/stripe/` → `stripe` SDK, domain contracts — never a module
- `proration.ts` (domain) → nothing but other domain types + `AppError`

## Wiring (`platform/container.ts`)

The container is the **only** place `new StripeClient(...)` and `new BillingRepository(db)` may appear. Add the Stripe adapter as a lazy async factory (it needs an API key from the injected `SecretsProvider` — the secret must not be read via `process.env` anywhere but `LocalSecretsProvider`):

```typescript
get billing(): BillingGateway {
  return (this._billing ??= new StripeClient(/* key from this.secrets */));
}
```

Add `billing?: BillingGateway` to `ContainerOverrides` so integration tests inject a mock gateway (a fake Stripe) via the container instead of `vi.mock()` — real Postgres, no real Stripe calls.

## Validation, summarized (each check in exactly one place)

| Check | Layer | Mechanism |
|---|---|---|
| Body shape / `plan` is a known enum | Presentation | Zod schema in `routes.ts` (422 auto) |
| Active subscription exists; not already on plan | Application | guard clause in `service.ts` → `AppError` |
| Proration invariants (non-negative, within cycle) | Domain | plain guard in `proration.ts` → `AppError` |
| `workspace_id NOT NULL`, invoice `id` unique | Database | Drizzle schema constraints |
