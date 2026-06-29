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

## Tool & Library Notes

- **2026-06-14** — New DB columns: edit `db/schema/*.ts`, then `npm run db:generate` (drizzle-kit) auto-generates `00NN_*.sql` (e.g. `0010_solid_baron_zemo.sql` = `ALTER TABLE … ADD COLUMN`). Never hand-write migration SQL; apply with `npm run db:migrate`.

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

## Open Questions

- **2026-06-14** — PR-list "latest review batch" uses a 120s `ranAt` window as a proxy for a review session. If a real review-session / batch id is ever added to the schema, swap the window for exact grouping in `pulls/routes.ts`.
