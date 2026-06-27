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

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
