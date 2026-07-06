# Server Gotchas

## SecretsProvider is the only `process.env` reader

`LocalSecretsProvider` (`src/adapters/secrets.ts`) is the **only** file in the entire codebase that reads `process.env` or `~/.devdigest/secrets.json`. If you need a secret anywhere else, inject `SecretsProvider` and call `.get(key)`. Adding a direct `process.env` read is an architectural violation.

## Rate limit is disabled in test mode

`POST /pulls/:id/review` has a 120/min rate limit. It is silently disabled when `NODE_ENV=test`. If rate limit behavior needs to be tested, it must be tested against a running production-mode server.

## RunBus is in-memory — server restart drops all streams

`platform/sse.ts` `RunBus` is a plain in-memory event emitter. If the server restarts while a review is running, the SSE client loses the stream. There is no replay or reconnect mechanism in L01. The client UI will show a stale "running" state.

## Migrations must be explicit — boot does not migrate

`drizzle-kit` migrations are never applied automatically on server start. Forgetting `pnpm db:migrate` after a schema change will cause runtime DB errors, not startup errors — the server boots fine but queries fail when they hit missing columns.

## `db:migrate` silently no-ops if the DB was migrated on another branch

Drizzle's migrator tracks progress by the journal `when` **timestamp** of the last row in `drizzle.__drizzle_migrations`, not by hash comparison. If your local Postgres was migrated on a branch whose later migrations carry **newer** timestamps than the current branch's pending migrations, `migrate()` decides it is already caught up and applies **nothing** — no error, no output. The pending migrations never run and their columns never appear.

Symptom seen in practice: `GET /repos/:id/conventions` returned `500 … column "created_at" does not exist`. Migrations `0000`–`0008` matched the branch exactly, but DB rows 10–12 were from a divergent lineage (added `conventions.category`, `skills.threat_level`) with timestamps newer than this branch's `0009_fantastic_rogue` (which adds `conventions.created_at`). So `0009` never ran and `pnpm db:migrate` was a no-op.

To diagnose: compare applied hashes to file hashes —
```bash
docker exec devdigest-postgres psql -U devdigest -d devdigest -t -A -F',' \
  -c "select id, hash, created_at from drizzle.__drizzle_migrations order by id;"
# then in server/src/db/migrations:
for f in 0*.sql; do echo "$(shasum -a 256 "$f" | awk '{print $1}')  $f"; done
```
Rows that match no file are from a foreign lineage. Fixes: either a clean reset (`db:migrate` + `db:seed` on a fresh DB — guarantees schema == branch), or apply the missing migration's SQL by hand (preserves data, but leaves the tracker "ahead" and orphan columns behind). Future migrations generated now get current timestamps, so they apply normally either way.

## The DB schema has many empty tables

Tables like `skills`, `memory_items`, `eval_cases`, `blast_radius` are fully defined in the schema and migrations, but empty. They are stubs for future course lessons. Do not delete or rename them — they will be filled in later lessons.

## reviewer-core is consumed as raw TypeScript — no dist/

The server imports `@devdigest/reviewer-core` via a TS path alias pointing to `../reviewer-core/src`. There is no `dist/` directory. If you see a `Cannot find module` error, check `tsconfig.json` paths, not an npm install.

## `*.it.test.ts` naming is load-bearing

The `.it.test.ts` suffix is used in CI `--exclude` and path filter flags to split unit and integration test jobs. Renaming a file or changing this convention will cause integration tests to run in the hermetic CI job (which has no Postgres) and fail silently.
