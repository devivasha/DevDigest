# CLAUDE.md — server

Fastify 5 REST API. Every feature is an independent plugin under `src/modules/`. Adding a new feature = new module, no existing code touched.

## Module Layout

```
src/
├── modules/          # Feature plugins (routes + service per module)
│   ├── agents/
│   ├── polling/
│   ├── pulls/
│   ├── repo-intel/
│   ├── repos/
│   ├── reviews/
│   ├── settings/
│   └── workspace/
├── adapters/         # Port implementations + mocks.ts for tests
├── platform/         # Container (DI), RunBus (SSE), config, db
└── vendor/shared/    # @devdigest/shared — Zod contracts (single source of truth)
```

## Conventions

- Every route declares `params` / `body` / `response` Zod schemas via `fastify-type-provider-zod`. No manual type casting.
- Services receive all dependencies via constructor injection from `platform/container.ts`. Never instantiate adapters directly in a service.
- All secrets arrive through the injected `SecretsProvider`. Never read `process.env` outside `LocalSecretsProvider`.
- `src/adapters/mocks.ts` provides test doubles for all ports. Use these in unit tests, never mock at the network level.

## Test Split

`*.it.test.ts` = integration test (requires real Postgres via testcontainers). Everything else = hermetic unit. CI runs them in separate jobs using `--exclude '**/*.it.test.ts'` and `.it.test` path filters.

## Do Not Touch Without Reading

- `platform/container.ts` — DI wiring. Read `server/docs/architecture.md` first.
- `adapters/mocks.ts` — shared test doubles. Changes affect all unit tests.
- `vendor/shared/` — Zod contracts shared with client and reviewer-core. Changes cascade to all packages.
- Any migration file in `drizzle/` — never edit existing migrations, always generate new ones.

## Read When

- **Understanding DI flow or adding an adapter** → `server/docs/architecture.md`
- **Adding/changing a route or SSE stream** → `server/docs/api-contracts.md`
- **Tracing the full review lifecycle** → `server/specs/review-flow.md`
- **Hit unexpected behavior** → `server/insights/gotchas.md`

## Session Context

Before starting any work in this module, read `insights/INSIGHTS.md` and treat it as high-confidence guidance unless explicitly told otherwise. To confirm active loading: summarize the top 3 most relevant points before beginning.

## End of Session

After completing work in this module, run `/engineering-insights` to update `insights/INSIGHTS.md`. Do not skip — if capture requires a human trigger it will not happen consistently enough to compound.
