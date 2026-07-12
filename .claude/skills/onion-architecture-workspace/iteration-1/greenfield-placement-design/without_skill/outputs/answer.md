# Structuring usage-based billing in the DevDigest backend

Short version: keep a single `billing/` module, and split it by *responsibility* along the same seams the rest of the backend uses — HTTP boundary, business logic, external I/O, and DB access. Each of your five pieces maps cleanly onto one of those seams. The rule that keeps this maintainable: **the route layer never talks to Stripe or Postgres directly, and the Stripe/Postgres code never contains billing rules.** Everything meets in a service that orchestrates them.

## Module layout

```
server/src/modules/billing/
  routes.ts          # (5) HTTP: GET /billing/summary, POST /billing/upgrade
  schema.ts          # (3) Zod request/response schemas + inferred types
  service.ts         # (2) proration + orchestration (the brain)
  stripe.gateway.ts  # (1) Stripe client wrapper (subscription + invoices)
  repository.ts      # (4) Drizzle persistence for invoices
  db.schema.ts       # Drizzle table definition for invoices
  billing.types.ts   # shared domain types (Invoice, Subscription, Proration…)
```

The important idea is the direction of dependencies: `routes → service → { stripe.gateway, repository }`. The service depends on the gateway and repository through **interfaces**, not concrete classes, so it stays pure and unit-testable (you stub Stripe and the DB). Nothing points "outward" from the service back into Fastify or Stripe types.

## Where each of the five pieces lives

### (1) Pull subscription + past invoices from Stripe → `stripe.gateway.ts`
Wrap the Stripe SDK in a thin gateway that exposes intent-shaped methods, not raw SDK surface:

```ts
export interface StripeGateway {
  getSubscription(workspaceStripeId: string): Promise<Subscription>;
  listInvoices(workspaceStripeId: string): Promise<Invoice[]>;
  previewProration(sub: Subscription, newPlan: PlanId): Promise<ProrationPreview>;
  applyUpgrade(sub: Subscription, newPlan: PlanId): Promise<Invoice>;
}
```

This is the only file that imports the `stripe` package and knows about Stripe object shapes. It **maps Stripe's response objects into your own domain types** (`billing.types.ts`) at the boundary, so a Stripe SDK upgrade or a provider swap never leaks past this file. The Stripe secret key comes from the injected `SecretsProvider` (per the repo's secrets rule — never `process.env` here).

### (2) Proration on mid-cycle upgrade → `service.ts`
Proration is a *business rule*, so it lives in the service, not the gateway and not the route. Two legitimate designs:

- **Delegate to Stripe** (recommended to start): Stripe already prorates when you update a subscription item. The service calls `gateway.previewProration()` / `applyUpgrade()` and Stripe returns the prorated invoice line items. The service's job is orchestration + validation of the result, not arithmetic.
- **Compute it yourself**: if you need proration independent of Stripe (e.g. to show a preview before committing, or for usage-based metering Stripe doesn't model), put the pure function in the service (or a `proration.ts` helper it calls). Keep it a pure function of `(currentPlan, newPlan, cycleStart, cycleEnd, now)` → amount, with no I/O — that makes it trivially unit-testable.

Either way the service is the single place that decides *what* an upgrade means; the gateway only executes the mechanics.

### (3) Validate the upgrade request body → `schema.ts` (enforced at the route)
Define Zod schemas here and let `fastify-type-provider-zod` validate at the HTTP boundary before the handler runs:

```ts
export const upgradeBody = z.object({
  workspaceId: z.string().uuid(),
  targetPlan: z.enum(["team", "business", "enterprise"]),
  effective: z.enum(["now", "cycle_end"]).default("now"),
});
export type UpgradeBody = z.infer<typeof upgradeBody>;
```

Wire it as the route's `schema.body`. This gives you (a) a 400 with a structured error for free before any billing logic runs, and (b) a typed `request.body` inside the handler. Keep response schemas here too so the summary payload is serialization-validated. Business-level validation that needs data (e.g. "you can't downgrade via this endpoint", "workspace already on this plan") belongs in the **service**, not Zod — Zod only checks shape.

### (4) Persist invoices to Postgres → `repository.ts` (+ `db.schema.ts`)
The repository is the only file that imports Drizzle and the table definition. Expose intent methods:

```ts
export interface InvoiceRepository {
  upsertMany(workspaceId: string, invoices: Invoice[]): Promise<void>;
  listForWorkspace(workspaceId: string): Promise<Invoice[]>;
}
```

Use `upsert` (insert … on conflict) keyed on the Stripe invoice id so re-syncing from Stripe is idempotent — you'll pull the same invoices repeatedly and must not duplicate rows. `db.schema.ts` holds the Drizzle table; generate the migration explicitly (`pnpm db:generate` then `pnpm db:migrate`) — never auto-run. The service decides *when* to persist (e.g. after a successful upgrade, or when reconciling a summary read); the repository just does the write.

### (5) Expose the two routes → `routes.ts`
Handlers stay thin — parse (already validated by Zod), call one service method, return its result. No Stripe calls, no SQL, no proration math here.

```ts
app.get("/billing/summary", { schema: { querystring: summaryQuery, response: {...} } },
  (req) => billingService.getSummary(req.query.workspaceId));

app.post("/billing/upgrade", { schema: { body: upgradeBody, response: {...} } },
  (req) => billingService.upgrade(req.body));
```

## How they talk to each other (the flows)

**GET /billing/summary**
```
route → service.getSummary(workspaceId)
          ├─ gateway.getSubscription()      // current plan/status from Stripe
          ├─ gateway.listInvoices()         // past invoices from Stripe
          ├─ repository.upsertMany(...)      // optional: reconcile to Postgres
          └─ returns { subscription, invoices } (domain types → response schema)
```
Decision to make: is the summary read **live from Stripe every time**, or **read from Postgres with a background/opportunistic sync**? Live-from-Stripe is simpler and always correct but adds a Stripe round-trip per request and couples your uptime to theirs. Reading from your own `invoices` table is faster and resilient, but you must keep it fresh (sync on webhook, on upgrade, or on a schedule). A common middle ground: serve subscription state live, serve invoices from Postgres, refresh invoices on upgrade + Stripe webhook.

**POST /billing/upgrade**
```
Zod validates body (3) ──► route ──► service.upgrade(body)
                                        ├─ load current subscription (gateway)
                                        ├─ apply business rules (no-op upgrade? illegal target?)
                                        ├─ compute/preview proration (2)
                                        ├─ gateway.applyUpgrade() → new prorated invoice
                                        ├─ repository.upsertMany([newInvoice]) (4)
                                        └─ return summary/confirmation
```

## Wiring

Construct the concrete `StripeGateway` and `InvoiceRepository` once at startup (in your container/DI setup or a `billing.plugin.ts` that registers the routes) and inject them into the service; register the service (or the built route plugin) with Fastify. Tests then instantiate the service with fakes for both dependencies — no Stripe, no DB needed for the proration/orchestration unit tests, and an `.it.test.ts` integration test exercises the repository against real Postgres.

## Two things worth deciding up front
1. **Stripe webhooks.** Invoices, payment failures, and subscription changes also arrive asynchronously from Stripe. If you only pull on read, your Postgres copy drifts. Plan a `POST /billing/webhook` (signature-verified via the gateway) that flows into the same `repository.upsertMany` path so there's one place invoices get written.
2. **Idempotency + money.** Send a Stripe idempotency key on `applyUpgrade`, and make invoice persistence upsert-by-Stripe-id, so a retried request can't double-charge or double-insert.
