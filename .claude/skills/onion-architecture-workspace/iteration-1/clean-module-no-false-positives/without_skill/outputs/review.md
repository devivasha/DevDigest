# Pre-PR review — `server/src/modules/webhooks/`

**Verdict: no architecture problems found.** The module follows the backend's onion layering and the inward-only dependency rule cleanly. Nothing here should block the PR. Details below, plus one optional thing to confirm against our conventions.

## Layer-by-layer check

### `contracts-webhooks.ts` — domain contracts ✅
- Pure types only (`WebhookEvent`, `WebhookSubscription`), zero imports, no framework/DB coupling. This is exactly what an inner-layer contract should be.
- Correctly positioned as the shared source of truth ("shared between the webhooks module and the client settings page"), consistent with it being consumed via `@devdigest/shared`.

### `repository.ts` — infrastructure (data access) ✅
- Drizzle (`drizzle-orm`, `db/client`, `db/schema`) is confined to this file. This is the single most important onion rule for us, and it holds — no schema/query leakage into the service or routes.
- Owns exactly one table (`webhook_subscriptions`) and every query is workspace-scoped (`eq(...workspaceId...)`), which is the correct tenancy boundary.
- `toDomain()` maps rows to the domain type at the infra boundary, so persistence shapes (e.g. `Date` → ISO string) never escape outward. Good.

### `service.ts` — application ✅
- Contains the business logic (the `MAX_WEBHOOKS_PER_WORKSPACE` invariant, `AppError` with a domain code), which is where it belongs — not in the route.
- Imports only inward/lateral dependencies: `Container`, domain types from `@devdigest/shared`, `platform/errors`, and the repository. **No Drizzle, no `db/schema` import** — the boundary is respected.
- Depends on the repository for all persistence; it never touches the DB directly.

### `routes.ts` — presentation ✅
- Zod request schemas (`CreateWebhookBody`, `SetActiveBody`, `IdParams`) live at the edge; validation is a presentation concern and is correctly placed here.
- Handlers are thin: resolve workspace context, delegate to the service, translate "not found"/status codes to HTTP. No business rules embedded in handlers.
- Depends inward on the service only; never imports the repository or Drizzle. Correct direction.

## Dependency-flow summary
```
routes.ts ──▶ service.ts ──▶ repository.ts ──▶ db (drizzle)
   │              │               │
   └──────────────┴───────────────┴──▶ contracts (@devdigest/shared)  [pure, imports nothing]
```
All arrows point inward. Domain has no outward dependencies, and infrastructure (Drizzle) is not referenced by any layer above the repository.

## One thing to confirm (not a violation)
Wiring is done by manual construction: `routes.ts` does `new WebhooksService(app.container)` and `service.ts` does `new WebhooksRepository(container.db)`. This is internally consistent — the `Container` is threaded inward and Drizzle stays in the repo — so it does **not** break layering.

The only open question is whether it matches how our other modules obtain collaborators. If our convention is to register/resolve services and repositories from the container (rather than `new`-ing them at each layer), align with that for consistency — e.g. resolve the service from `app.container` in the route and inject the repository into the service's constructor instead of constructing it inside. If manual construction is the established module pattern, leave it as-is. This is a convention-consistency check, not an onion breach — I flag it only because I reviewed these four files in isolation and can't see the container wiring the rest of the backend uses.

## Nits (optional, non-architectural)
- `service.ts` stores `private container` but only ever uses `container.db` (in the constructor). You could pass `container.db` directly or drop the retained field; harmless either way.
- `repository.ts` uses `row!` / `as WebhookEvent[]` casts at the mapping boundary — acceptable localized casts, just keep them confined to `toDomain`/`insert` as they are now.
