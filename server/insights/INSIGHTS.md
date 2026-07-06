# Insights — server

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

## What Doesn't Work

## What Works

- **2026-06-29** — `deriveFileSummary(patch)` in `smart-diff-classifier.ts` extracts "What this does" text purely from the patch string — no LLM call. Priority: (1) up to 3 exported symbol names → "Adds: rateLimit, bucketKey"; (2) first meaningful added line that isn't an import, comment, or brace; (3) `null` (caller hides the section). Works reliably for TypeScript/JavaScript files; returns `null` for lock files and binary diffs. ref: `server/src/modules/pulls/smart-diff-classifier.ts:13`

## Codebase Patterns

- **2026-06-29** — Smart Diff classifier (`smart-diff-classifier.ts`) uses priority order `boilerplate → wiring → core` (first match wins). All pattern arrays and numeric thresholds (`LARGE_PR_THRESHOLD`, `LARGE_FILE_THRESHOLD`) are exported constants — never inline in route logic. The route imports these constants so the client can reference thresholds without duplicating them. ref: `server/src/modules/pulls/smart-diff-classifier.ts:1`

- **2026-06-14** — Shared contracts (`@devdigest/shared`) are vendored as TWO hand-maintained copies — `server/src/vendor/shared/` and `client/src/vendor/shared/` — resolved by tsconfig path alias, NOT auto-synced. Adding a field means editing both in lock-step; the only diffs between copies are comments. Evidence: `server/src/vendor/shared/contracts/trace.ts`, `platform.ts`.
- **2026-06-14** — PR-list per-PR aggregates (score, cost) are computed ON READ in `GET /repos/:id/pulls` via one `inArray` query + JS grouping, never denormalized onto `pull_requests`. "Latest review batch" cost has no batch id in the schema — approximated by summing `agent_runs.cost_usd` within a 120s window of the PR's newest priced run. Evidence: `server/src/modules/pulls/routes.ts`.
- **2026-06-14** — `completeAgentRun`'s `values` shape is declared in TWO places that must match: the repo fn (`repository/run.repo.ts`) AND the interface wrapper (`repository.ts:151`). Adding a field (e.g. `costUsd`) needs both or typecheck fails.

- **2026-07-06** — The server barrel `vendor/shared/index.ts` uses explicit `.js` extension re-exports (`export * from './contracts/brief.js'`), while the client's mirrored barrel `client/src/vendor/shared/index.ts` omits the extension (`export * from './contracts/brief'`) — both compile fine under each package's own `tsconfig`/`moduleResolution`, but a byte-identical copy of the barrel itself would fail one side. Only the per-contract files (e.g. `contracts/blast.ts`) need to be byte-identical; the barrel line must match each side's existing extension convention. ref: `server/src/vendor/shared/index.ts:19`, `client/src/vendor/shared/index.ts:19`

- **2026-07-06** — `RepoIntelRepository.getResolvedCallers` (`repository.ts:503`) INNER JOINs `file_rank` on `(repoId, fromPath)`. A `references` row whose `fromPath` has NO matching `file_rank` row is silently dropped from `tryPersistentBlast`'s caller list — no error, no degraded flag, the caller just vanishes from the `BlastResponse`. Any seed/backfill of blast demo data must insert a `file_rank` row for every caller file, not just for the changed (decl) file. ref: `server/src/modules/repo-intel/repository.ts:503`

## Tool & Library Notes

- **2026-06-14** — New DB columns: edit `db/schema/*.ts`, then `npm run db:generate` (drizzle-kit) auto-generates `00NN_*.sql` (e.g. `0010_solid_baron_zemo.sql` = `ALTER TABLE … ADD COLUMN`). Never hand-write migration SQL; apply with `npm run db:migrate`.
- **2026-07-06** — `db/schema/context.ts`'s `references` table has NO unique index/constraint at all (unlike `symbols`, which has `symbols_repo_path_name_kind_line_uq`). `.onConflictDoNothing()` on an insert into `references` is a no-op guard — Postgres has no constraint to conflict on, so re-running an insert unconditionally duplicates rows. Idempotent seeding of `references` requires a manual `SELECT` of existing `(fromPath, toSymbol, line)` keys first, then filtering the insert batch in JS. ref: `server/src/db/seed.ts` (Blast Radius demo data block), `server/src/db/schema/context.ts:97`

- **2026-07-06** — For a hermetic unit test of a `class Foo { constructor(private container: Container) {} }` service, don't construct a real `Container` (its constructor builds `LocalNoAuthProvider`/`JobRunner` from a real `db` and can surprise you later if those constructors start doing I/O). Instead build a plain object with only the properties the service actually reads (`{ db, repoIntel, llm }`) and cast `as unknown as Container`. TypeScript's structural typing doesn't check this at the cast site, so it compiles even though most of `Container`'s surface is missing — fine as long as the service under test never touches an untyped property (verify by reading the service body first). ref: `server/src/modules/blast/service.test.ts:97`
- **2026-07-06** — When a join query is grouped/aggregated in JS after the query returns (e.g. `prFiles` ⋈ `pullRequests`, then collapsed to one entry per PR with accumulated `files_overlap`), do NOT put `.limit(N)` on the SQL query itself — a flat row-level limit can truncate before all of one PR's overlapping-file rows are collected, or cut off entire trailing PRs unevenly. Fetch unbounded (ordered DESC), aggregate in JS, then `.slice(0, N)` on the aggregated list. ref: `server/src/modules/blast/service.ts:150`

## Recurring Errors & Fixes

- **2026-06-14** — Adding a required field to a Zod contract (`RunStats.cost_usd`) breaks the inline fixture in `server/test/contracts.test.ts` (RunTrace parse). Update the `stats: {…}` fixture in the same change. Evidence: `server/test/contracts.test.ts:160`.

- **2026-06-29** — "column 'created_at' does not exist" on the Conventions page means migration 0009 (adds `created_at` to `conventions`) was never applied to the running DB. Fix: `cd server && pnpm db:migrate`. Migrations are never auto-run on boot — they must be applied manually after pulling schema changes. ref: `server/src/db/schema/knowledge.ts`, `server/drizzle/`

- **2026-06-29** — `prFiles` table can accumulate duplicate rows for the same path (seed data or concurrent GitHub-sync races). The `/pulls/:id/smart-diff` route must deduplicate by path with a `Set<string>` before grouping, otherwise clients receive duplicate array entries and React renders duplicate keys. ref: `server/src/modules/pulls/routes.ts`

## Session Notes

### 2026-06-20
- Added FINDINGS column to PR list (`PrMeta.findings` = `{CRITICAL, WARNING, SUGGESTION, items[5]}`): server does 3 queries in `GET /repos/:id/pulls` (runs, sev counts, preview items); client renders severity pips in `PRRow` + `FindingsPopover` on hover.
- Extended `RunSummary` with `severity_counts` + `findings_preview`: `listRunsForPull` now does 3 queries (runs, sev counts, preview items) — same pattern as the PR-list endpoint.
- Severity filter bar on PR Detail page: filter state lifted to `FindingsTab`, prop-drilled through `ReviewRunAccordion` → `FindingsPanel` → `visibleFindings(findings, hideLow, severityFilter)`.

### 2026-06-29
- Smart Diff feature: `GET /pulls/:id/smart-diff` classifies `prFiles` rows into core/wiring/boilerplate using pure regex patterns, joins latest review findings for per-file `finding_lines`, and populates `pseudocode_summary` from static patch analysis. Zero LLM calls at render time. Files: `smart-diff-classifier.ts`, `pulls/routes.ts`.
- Conventions `created_at` bug: migration 0009 was not applied to the running DB — running `pnpm db:migrate` fixed "column 'created_at' does not exist".

### 2026-06-14
- Re-introduced per-run cost (USD) end-to-end (lesson reversing the earlier removal in `d45ab0d`/`58c6ac7`): `cost_usd` column on `agent_runs` (migration 0010), captured in `run-executor` (was discarding `outcome.costUsd`), surfaced in `RunSummary`/`RunStats`/`PrMeta`.
- Decision: PR-list COST = sum of the latest review batch via a 120s window heuristic (no batch id in schema). Cost persisted (accurate `outcome.costUsd`), not recomputed; historical runs → null → "—".

### 2026-07-06
- Blast Radius backend (T2/T3/T8 of the Blast Radius plan): `blast/service.ts` maps `container.repoIntel.getBlastRadius` + `getIndexState` (facade, zero LLM) plus a `prFiles`⋈`pullRequests` prior-PRs join into the `BlastResponse` contract; `blast/routes.ts` mirrors the `/pulls/:id/smart-diff` thin-plugin shape and is registered in `modules/index.ts`. `blast/service.test.ts` covers persistent/degraded/empty/history paths + a zero-LLM assertion, using a hand-built fake `Container` (see Tool & Library Notes) rather than the real class. Files: `server/src/modules/blast/service.ts`, `server/src/modules/blast/routes.ts`, `server/src/modules/blast/service.test.ts`, `server/src/modules/index.ts`.
- Blast Radius demo seed data (this session): added an idempotent block to `seed.ts` (outside the `!pr` guard, so it backfills onto an already-seeded PR #482) populating `symbols`, `references`, `file_rank`, `file_facts`, and `repo_index_state` (`status: 'full'`) for a shared `src/api/rate-limit.ts` helper (`rateLimit`, `bucketKey`) called from 4 files. Verified live end-to-end: `GET /pulls/:id/blast` on the seeded PR returns `status: "full"`, `degraded: false`, `rateLimit` with 4 callers, `bucketKey` with 2 callers, 3 `impacted_endpoints`, 1 `impacted_crons` — confirmed the PERSISTENT path (not the ripgrep-degraded fallback) drives the demo. `REPO_INTEL_ENABLED=true` was already set in `server/.env`, no config change needed. Files: `server/src/db/seed.ts`.

## Open Questions

- **2026-06-14** — PR-list "latest review batch" uses a 120s `ranAt` window as a proxy for a review session. If a real review-session / batch id is ever added to the schema, swap the window for exact grouping in `pulls/routes.ts`.
