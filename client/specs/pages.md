# Spec: Pages & Data Flow

Each page, its data sources, and TanStack Query keys.

## `/` — Dashboard

**Component:** `app/page.tsx` (RSC)
**Data:** Repo list via `GET /repos`
**Query key:** `["repos"]`
**Behavior:** If no repos exist, redirects to `/onboarding`.

## `/onboarding` — First-Run Setup

**Component:** `app/onboarding/page.tsx` (client)
**Data:** `GET /settings` to check if API keys are configured
**Query key:** `["settings"]`
**Behavior:** Multi-step wizard. On completion, navigates to `/`.

## `/repos/:id/pulls` — PR List

**Component:** `app/repos/[id]/pulls/page.tsx` (RSC shell + client list)
**Data:**
- `GET /repos/:id` — repo details
- `GET /repos/:id/pulls` — PR list
**Query keys:** `["repo", id]`, `["pulls", repoId]`
**Actions:** "Import PRs" button → `POST /repos/:id/pulls/import`

## `/pulls/:id` — PR Detail

**Component:** `app/pulls/[id]/page.tsx` (RSC shell + client detail)
**Data:**
- `GET /pulls/:id` — PR with diff
- `GET /pulls/:id/reviews` — list of reviews with findings
**Query keys:** `["pull", id]`, `["reviews", pullId]`
**Actions:**
- "Run Review" → `POST /pulls/:id/review` → receives `runId` → subscribes to `useRunEvents(runId)`
- Reviews list updates via `invalidateQueries(["reviews", pullId])` on `completed` SSE event

## `/repos/:id/onboarding` — Onboarding Tour

**Component:** `app/repos/[repoId]/onboarding/page.tsx` (thin RSC shell → `OnboardingTourView` client component)
**Data:** `useOnboardingTour(repoId)` → `GET /repos/:id/onboarding`
**Query key:** `["onboarding-tour", repoId]`
**Actions:** "Regenerate" → `useRegenerateTour(repoId)` → `POST /repos/:id/onboarding/generate` (body-less) → on success, writes the response straight into the `["onboarding-tour", repoId]` cache entry via `setQueryData`. Distinct from the first-run wizard at `/onboarding` — this is a per-repo surface, not a workspace setup flow.

## `/agents` — Agent Management

**Component:** `app/agents/page.tsx` (client)
**Data:** `GET /agents`
**Query key:** `["agents"]`
**Actions:** Create / edit / delete agents. All mutations invalidate `["agents"]`.

## `/settings` — Settings

**Component:** `app/settings/page.tsx` (client)
**Data:** `GET /settings`
**Query key:** `["settings"]`
**Actions:** `PUT /settings` — updates API keys and LLM provider. Keys are never returned in full (masked). Mutation invalidates `["settings"]`.
