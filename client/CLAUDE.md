# CLAUDE.md — client

Next.js 15 + React 19 Studio UI. App Router, RSC by default — add `"use client"` only when you need browser APIs or interactivity.

## Route Map

| Route | Purpose |
|-------|---------|
| `/` | Dashboard / repo list |
| `/onboarding` | First-run setup wizard |
| `/repos/:id/pulls` | PR list for a repo |
| `/pulls/:id` | PR detail: diff, findings, run review |
| `/agents` | Manage review agents |
| `/settings` | API keys, LLM provider |

## Conventions

- All server state lives in TanStack Query. Query keys and fetch calls are in `src/lib/api.ts`. Hooks wrap them in `src/lib/hooks/`.
- `@devdigest/shared` resolves to `../server/src/vendor/shared` via TS alias. Import Zod types from there — never redefine contracts locally.
- `fetch` is mocked globally in vitest (`src/test/setup.ts`). Unit tests never hit a real API server.
- i18n via `next-intl`. All user-facing strings go through `useTranslations()`. No hardcoded English strings in JSX.

## SSE (Review Streaming)

Reviews stream `RunEvent` objects from `GET /runs/:id/events`. The SSE subscription hook in `src/lib/hooks/useRunEvents.ts` handles connection lifecycle. Use this hook — do not wire raw `EventSource` manually.

## Do Not Touch Without Reading

- `src/lib/api.ts` — central fetch layer. Changes affect all queries.
- `src/lib/hooks/useRunEvents.ts` — SSE lifecycle. Read `client/docs/ui-architecture.md` first.

## Read When

- **Understanding component boundaries (RSC vs client)** → `client/docs/ui-architecture.md`
- **Adding a new page or understanding data flow** → `client/specs/pages.md`
- **Hit unexpected behavior (alias, i18n, streaming)** → `client/insights/gotchas.md`

## Session Context

Before starting any work in this module, read `insights/INSIGHTS.md` and treat it as high-confidence guidance unless explicitly told otherwise. To confirm active loading: summarize the top 3 most relevant points before beginning.

## End of Session

After completing work in this module, run `/engineering-insights` to update `insights/INSIGHTS.md`. Do not skip — if capture requires a human trigger it will not happen consistently enough to compound.
