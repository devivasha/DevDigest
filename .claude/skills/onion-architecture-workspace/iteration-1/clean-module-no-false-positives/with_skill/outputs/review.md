# Architecture review — `webhooks` module

**Verdict: Compliant.** I found no onion-architecture violations across the four files. Each layer imports only inward, Drizzle stays in the repository, business rules sit in the service, and the routes stay thin. This module is safe to open a PR against on structural grounds. Details below.

## Per-file findings

### `routes.ts` (Presentation) — clean
- Imports are all presentation-legal: `fastify`, `fastify-type-provider-zod`, `zod`, `_shared/context`, `_shared/schemas` (`IdParams`), `platform/errors`, and its own `service.ts`. No `repository.ts`, no `drizzle-orm`, no `db/schema`, no adapters.
- HTTP-shape Zod schemas (`WebhookEventEnum`, `CreateWebhookBody`, `SetActiveBody`) are declared at the top of the file and describe wire shape only — no business rules embedded (the "max 20" rule correctly lives in the service, not here).
- Each handler does the three permitted things: `getContext()` → one `service.*` call → reply. No loops, no multi-step orchestration, no DB/adapter access.
- `if (!webhook) throw new NotFoundError(...)` is a thin null→404 guard, not business branching, and `platform/errors` is on the presentation allow-list, so this is fine. (Optional, non-blocking: the skill's canonical pattern lets the *service* raise `NotFoundError` and the route just propagate it — see the validation-stack "does this exist? → service" row. Moving the guard down would match the reference style, but the current placement is not a violation.)

### `service.ts` (Application) — clean
- Imports only inward: `Container` type, domain contracts from `@devdigest/shared`, `platform/errors`, and its own repository. No `drizzle-orm`, no `fastify`, no `db/schema`, no adapter imports.
- Own-module repo is instantiated in the constructor (`new WebhooksRepository(container.db)`) — the documented pattern; no adapter is `new`-ed here.
- `create()` performs an application-level precondition (`MAX_WEBHOOKS_PER_WORKSPACE`) via a repo lookup and throws `AppError(..., 422)` — exactly the layer-2 validation pattern from the skill.
- All methods return domain DTOs (`WebhookSubscription`), never raw rows. No SQL, no `reply`, no HTTP types.

### `repository.ts` (Infrastructure) — clean
- The only file that speaks Drizzle (`and`, `desc`, `eq`, `db/schema`) — correct.
- `WebhookRow = typeof t.webhookSubscriptions.$inferSelect` is module-private: never exported, never in a public return type. All public methods return contract types.
- `toDomain()` is `private` and is the sole boundary where the row type touches the domain type.
- **Workspace scoping is present on every query** — `list`, `getById`, `setActive`, and `deleteById` all filter by `workspaceId` (the multi-tenant rule the skill marks MANDATORY). No unscoped lookups.
- No imports from `service.ts` or `fastify`.

### `contracts-webhooks.ts` (Domain) — clean
- Pure TypeScript types (`WebhookEvent`, `WebhookSubscription`) with **zero imports** — no `zod`, no `drizzle-orm`, no `fastify`, no `Container`. Satisfies the domain zero-import rule.
- Consumed by service and repository via the `@devdigest/shared` alias, which is the correct way for the domain layer to be shared between server and client.

## Summary

| File | Layer | Result |
|---|---|---|
| `routes.ts` | Presentation | Compliant |
| `service.ts` | Application | Compliant |
| `repository.ts` | Infrastructure | Compliant |
| `contracts-webhooks.ts` | Domain | Compliant |

No required changes. One optional style alignment noted (NotFoundError placement in `routes.ts`), which is not a violation.
