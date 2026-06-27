# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

| Layer | Technology |
|-------|-----------|
| UI | Next.js 15, React 19, TanStack Query, Tailwind CSS |
| API | Fastify 5, Drizzle ORM, Zod, fastify-type-provider-zod |
| DB | PostgreSQL + pgvector (Docker) |
| Review engine | Pure TypeScript — no framework, injected LLM provider |
| Tests | vitest + jsdom (client), vitest + testcontainers (server), agent-browser (e2e) |

Prerequisites: Node ≥22, pnpm ≥10, Docker.

## Packages

| Package | Path | Port |
|---------|------|------|
| `@devdigest/api` | `server/` | 3001 |
| `@devdigest/web` | `client/` | 3000 |
| `@devdigest/reviewer-core` | `reviewer-core/` | — |
| `@devdigest/e2e` | `e2e/` | — |
| `@devdigest/shared` | `server/src/vendor/shared/` | — (alias only) |

Not a monorepo. Cross-package code sharing is done via TypeScript path aliases — no `workspace:*`, no published packages.

## Commands

```bash
# Full stack (preferred)
./scripts/dev.sh              # Postgres + API (seeded) + web
./scripts/dev.sh --no-seed    # skip demo data
./scripts/dev.sh --db-only    # migrations only, then exit

# Database (never auto-runs on boot)
cd server && pnpm db:migrate   # apply migrations
cd server && pnpm db:seed      # idempotent demo data
cd server && pnpm db:generate  # generate migration stubs after schema changes

# Tests
cd client        && pnpm test                                        # vitest + jsdom
cd server        && pnpm exec vitest run --exclude '**/*.it.test.ts' # unit (hermetic)
cd server        && pnpm exec vitest run .it.test                    # integration (real Postgres)
cd reviewer-core && npm test                                         # hermetic, LLM stubbed
./scripts/e2e.sh                                                     # hermetic browser e2e

# Typecheck
cd server        && pnpm typecheck
cd client        && pnpm typecheck
cd reviewer-core && npm run typecheck
```

## Key Constraints

- **Secrets** — stored in `~/.devdigest/secrets.json` (mode 0600). `LocalSecretsProvider` is the only place that reads `process.env`. Everywhere else uses the injected `SecretsProvider`.
- **Migrations** — explicit only. Never auto-run on boot. Always `pnpm db:generate` then `pnpm db:migrate`.
- **reviewer-core** — never emits JS. `npm run build` = `tsc --noEmit`. Always consumed as raw TypeScript source.
- **Test split** — `*.it.test.ts` suffix = integration test (real Postgres). Everything else = hermetic unit.

## Read When

- **Modifying the review pipeline** → read `reviewer-core/docs/pipeline.md`
- **Adding or changing an API route** → read `server/docs/api-contracts.md`
- **Changing DI wiring, adapters, or secrets** → read `server/docs/architecture.md`
- **Working on any server module** → read `server/CLAUDE.md`
- **Working on the UI** → read `client/CLAUDE.md`
- **Writing or debugging e2e flows** → read `e2e/docs/flows.md`
- **Hit unexpected behavior** → check `<package>/insights/gotchas.md`
- **Changing DB schema** → read `server/docs/architecture.md` (Drizzle section)
