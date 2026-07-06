# Insights — client

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

- **2026-06-14** — `formatCost` (`src/lib/cost.ts`) distinguishes MISSING data (`null`/`undefined` → "—") from a genuine zero (`0` → "$0.00"), widens precision for sub-cent values (~2 sig figs), and trims trailing zeros to a 2dp floor ("$0.06" not "$0.060", "$0.0013" not "$0.00"). Reuse it for any per-run money display.

## What Doesn't Work

- **2026-06-20** — `position: absolute` popovers rendered inside the PR-list table are silently clipped: `tableCard` has `overflow: hidden` for its border-radius. Fix: use `position: fixed` + capture `getBoundingClientRect()` on `mouseEnter` and pass `{ top, left }` to the popover component. Evidence: `client/src/app/repos/[repoId]/pulls/styles.ts` (`tableCard`), `client/src/components/FindingsPopover.tsx`.
- **2026-06-20** — React hooks (`useState`, `useRef`) cannot be called inside a `.map()` render callback — React will throw "Rendered more hooks than during the previous render". If a list item needs its own hover or ref state, extract it to a named component (e.g. `RunRow` from `RunHistory`, `PRRow`). Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx`.

## Codebase Patterns

- **2026-06-20** — `vendor/shared/` contracts (`@devdigest/shared`) are mirrored in BOTH `client/src/vendor/shared/` and `server/src/vendor/shared/` — NOT auto-synced. Any schema change (e.g. adding a field to `PrMeta` or `RunSummary`) must be applied to both copies in the same edit. Evidence: `client/src/vendor/shared/contracts/platform.ts`, `trace.ts`.
- **2026-06-14** — Cross-route shared components live in `src/components/<Name>/` with an `index.ts` barrel, imported via `@/components/<Name>` (e.g. `RunCostBadge`, `diff-viewer`). Vendored UI primitives (`Badge`, `CircularScore`) live in `src/vendor/ui` under `@devdigest/ui` — different home. Evidence: `client/src/components/RunCostBadge/`.
- **2026-06-14** — The PR-list table is driven by two parallel constants that MUST stay length-aligned: `COLUMN_KEYS` (header keys + order) and `GRID` (CSS grid-template tracks). Adding a column = add to both AND render a matching cell in `PRRow.tsx`, else header/cells misalign silently. Evidence: `client/src/app/repos/[repoId]/pulls/constants.ts`.
- **2026-06-14** — i18n has only the `en` locale (`client/messages/en/`); new UI strings need a key under the right namespace file (e.g. `prReview.json`, `runs.json`) read via `useTranslations("<ns>")`. A missing key renders the raw key, not an error.

- **2026-07-06** — When adding a new shared contract file (e.g. `contracts/blast.ts`), the contract file itself must be byte-identical between `server/src/vendor/shared/` and `client/src/vendor/shared/`, but the barrel `index.ts` re-export line is NOT byte-identical across the two — server's barrel uses `.js` extensions (`export * from './contracts/blast.js'`), client's omits them (`export * from './contracts/blast'`). Match each barrel's existing convention rather than copying the barrel line verbatim. ref: `client/src/vendor/shared/index.ts:19`, `server/src/vendor/shared/index.ts:19`

## Tool & Library Notes

- **2026-07-06** — `@testing-library/user-event` is NOT installed in `client/` (import fails with "Failed to resolve import" in vitest) — use `fireEvent` from `@testing-library/react` instead, matching the existing pattern in `FindingCard.test.tsx`. ref: `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/BlastRadiusCard.test.tsx`

## Recurring Errors & Fixes

- **2026-06-29** — React duplicate-key warning from the diff viewer ("Encountered two children with the same key, `CLAUDE.md`") traced to duplicate rows in the `prFiles` DB table, not to a bug in the component. The key was the file path — unique in theory but not in the data. Fix: server deduplicates before returning, and `SmartDiffViewer` adds a client-side `Set<string>` guard for stale cache (60 s `staleTime`). ref: `client/src/components/diff-viewer/SmartDiffViewer/SmartDiffViewer.tsx:45`

- **2026-06-29** — `"Package"` is not a valid icon name in `@devdigest/ui`'s icon registry — TypeScript throws `Type '"Package"' is not assignable`. Use `"Boxes"` as the nearest substitute for a package/container icon. ref: `client/src/components/diff-viewer/SmartDiffViewer/GroupSection.tsx`

- **2026-07-06** — `"Network"` and `"ArrowUpRight"` are not valid icon names in `@devdigest/ui`'s icon registry either (same class of gap as `"Package"`) — the registry only re-exports a fixed lucide-react subset (`client/src/vendor/ui/icons.tsx`). Used `"Workflow"` for a graph-view toggle and `"CornerDownRight"` for a caller-arrow bullet as the nearest substitutes. Check `icons.tsx`'s export list before assuming a lucide icon name is available. ref: `client/src/vendor/ui/icons.tsx`, `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/BlastRadiusCard.tsx`

- **2026-07-06** — Next build error "Module not found: Can't resolve './brief.js'" came from a new client shared-contract file (`contracts/blast.ts`) importing a SIBLING contract with a `.js` extension (`import { ChangedSymbol } from './brief.js'`). CORRECTS the earlier "contract files are byte-identical across client/server" note: intra-contract relative imports ALSO follow each side's extension convention — server uses `./brief.js` (NodeNext ESM), client uses `./brief` (webpack/Next can't resolve a `.js` specifier that points at a `.ts` source). So a contract file that imports a sibling is NOT byte-identical across the two vendors; only extension-free contracts are. Fix: drop `.js` on the client copy, matching `review-api.ts`'s `from './brief'`. ref: `client/src/vendor/shared/contracts/blast.ts:2`, `client/src/vendor/shared/contracts/review-api.ts:3`

- **2026-07-05** — "Cannot reach the DevDigest engine at http://localhost:3001. Is the API running?" is a CATCH-ALL for ANY failed `fetch` in `api.ts` — including a CORS rejection — NOT proof the API is down (the API can return 200 on `/health` while the browser call still fails). Root cause found this session: the client `dev` script defaulted to `next dev -p ${WEB_PORT:-3002}` while the server allows exactly ONE CORS origin `http://localhost:${WEB_PORT}` (=3000, `app.ts:90`). UI served from :3002 → cross-origin fetch to :3001 blocked → TypeError surfaced as the "engine unreachable" message. Fix: align the client default port to 3000. ref: `client/src/lib/api.ts:37`, `client/package.json`

## Session Notes

- **2026-06-29** — Smart Diff feature (token-free): `SmartDiffViewer` groups changed files into core/wiring/boilerplate sections using pure path-pattern classification on the server; finding badges per file and line-level severity chips link to the Agent runs tab via `targetFindingId` state + `data-finding-id` + `scrollIntoView`. "What this does" section uses static patch analysis (no LLM). Files: `SmartDiffViewer/`, `CodeLine/CodeLine.tsx`, `DiffTab/DiffTab.tsx`, `page.tsx`, `ReviewRunAccordion/ReviewRunAccordion.tsx`.
- **2026-06-29** — Conventions "suggested skills": `useSkills()` + filter `type === 'convention'` gives the skills already formalized from prior scans; passed as `suggestedSkills` prop to `ConventionCard` and rendered as accent chips. Files: `ConventionsView/ConventionsView.tsx`, `ConventionCard/ConventionCard.tsx`.

- **2026-07-06** — Blast Radius card polish: placed Intent + Blast cards side-by-side in `OverviewTab.tsx` (a `flex` row of two `flex: 1 1 360px` columns, `flexWrap: wrap` so they stack on narrow viewports, `alignItems: flex-start` so unequal heights don't stretch). Filtered caller-less symbols out of the tree so only symbols with ≥1 caller render (`symbolsWithCallers`). Interim experiment to hide zero-count segments in the top summary + show a "downstream not determined" badge was REVERTED per user — the summary strip keeps full counts incl. zeros. Files: `OverviewTab/OverviewTab.tsx`, `OverviewTab/BlastRadiusCard.tsx`, `messages/en/blast.json`.

## Codebase Patterns

- **2026-06-29** — Cross-tab click-to-navigate (diff → findings) pattern: `page.tsx` holds `targetFindingId` state; `handleFindingClick` sets it and switches the tab; `FindingsTab` passes it to `ReviewRunAccordion`; the accordion `useEffect` opens itself if it owns the target finding and calls `querySelector('[data-finding-id="…"]').scrollIntoView()` after an 80 ms delay (accordion animation). ref: `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`, `_components/ReviewRunAccordion/ReviewRunAccordion.tsx`

- **2026-06-29** — Convention skills have `type === 'convention'` (set by `createSkillFromAccepted` on the server). Filter `useSkills()` result by this type to find skills that originated from the Conventions workflow — used to show "Suggested skills" chips on `ConventionCard`. ref: `client/src/app/conventions/_components/ConventionsView/ConventionsView.tsx:29`

- **2026-07-06** — Mocking a hook via its `@/` tsconfig-path alias (e.g. `vi.mock("@/lib/hooks/pulls", () => ({ useBlastRadius: ... }))`) resolves correctly in vitest and matches the same module the component under test imports — no need to compute a deep relative path (`../../../../../lib/hooks/pulls`) like older tests in this codebase do. Simplifies mocking hooks for components several directories deep. ref: `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/BlastRadiusCard.test.tsx`

## Open Questions
