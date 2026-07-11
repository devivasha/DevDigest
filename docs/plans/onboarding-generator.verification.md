# Onboarding Generator — Plan Verification (Step 5, plan-verifier)

**Verdict: MERGE-READY.** All 19 EARS acceptance criteria implemented, tested (AC-derived,
not tautological), and committed on `labs-5`. Typecheck green across server/client/reviewer-core.

Sources: `specs/2026-07-11-onboarding-generator.md` (AC-1…AC-19),
`docs/plans/onboarding-generator.md` (traceability matrix), commits `2601ba8` (code) + `03a79b3` (tests).

Live re-run at verification time: server hermetic **188/188**, server integration **7/7 onboarding**
(Docker/testcontainers), client **48/48** — including 24 new server unit + 7 integration + 5 client tests.

## Traceability (AC → impl → test → commit)

| AC | Implemented (file:line) | Tested (test:case) | Status |
|----|--------------------------|---------------------|--------|
| AC-1 | `onboarding/facts.ts` `collectFacts` — facade-only, no db/llm/fs | `facts.test.ts` throwing db/llm proxy | ✅ |
| AC-2 | `facts.ts` header from `getIndexState()`; `service.ts` `lastRefreshedAt=generatedAt`; `TourHeader.tsx` | `facts.test.ts`, `service.test.ts`, `OnboardingTourView.test.tsx` | ✅ |
| AC-3 | `repo-intel/types.ts` 5 new facade methods | `onboarding-facade.it.test.ts` (real Postgres) | ✅ |
| AC-4 | `extractor.ts` exactly one `completeStructured` | `extractor.test.ts` (call count=1), `service.test.ts` | ✅ |
| AC-5 | `extractor.ts` `{invalid:true}`; `service.ts` → `buildSkeleton` | `extractor.test.ts`, `skeleton.test.ts` | ✅ |
| AC-6 | contract diagram string + narrative≤1200; `ArchitectureSection.tsx` `<MermaidDiagram>` | `extractor.test.ts`, `OnboardingTourView.test.tsx` | ✅ |
| AC-7 | pinned `score=rank*(1+normImp)`, tie-breaks; importer counts facade method | `facts.test.ts` (hand-computed), `onboarding-facade.it.test.ts` | ✅ |
| AC-8 | `getSetupCommands` display-only; `CopyButton.tsx` clipboard-only, no exec | `OnboardingTourView.test.tsx` | ✅ |
| AC-9 | `facts.ts` rank DESC preserved; repository `ORDER BY rank DESC` | `facts.test.ts`, `onboarding-facade.it.test.ts` | ✅ |
| AC-10 | `skeleton.ts` firstTasks, cap 5 | `skeleton.test.ts`, `OnboardingTourView.test.tsx` | ✅ |
| AC-11 | `service.ts` degraded → skeleton, no LLM; `DegradedBanner.tsx` text+icon badge | `service.test.ts`, `skeleton.test.ts`, `OnboardingTourView.test.tsx` | ✅ |
| AC-12 | `service.ts` clone-dir guard → skeleton, never index/refresh; CTA link | `service.test.ts`, `skeleton.test.ts`, `OnboardingTourView.test.tsx` | ✅ |
| AC-13 | `extractor.ts` `isGroundedPath` + `groundSections` drop unverifiable | `extractor.test.ts` | ✅ |
| AC-14 | `repository.ts` upsert; `service.ts` getTour re-serves, zero LLM | `service.test.ts`, `repository.it.test.ts` | ✅ |
| AC-15 | `ON CONFLICT DO UPDATE`, `generatedAt=now()`; no re-index | `service.test.ts`, `repository.it.test.ts` | ✅ |
| AC-16 | `service.ts` stale = index.updatedAt > row.indexUpdatedAt; `StaleHint.tsx` | `service.test.ts`, `OnboardingTourView.test.tsx` | ✅ |
| AC-17 | `TourHeader.tsx` Share copies in-app route, no fetch/public URL | `OnboardingTourView.test.tsx` | ✅ |
| AC-18 | route `/repos/[repoId]/onboarding`; `activeKeyFor` tightened; i18n namespace; wizard untouched | grep: no hardcoded JSX literals; RTL via i18n | ✅ |
| AC-19 | `constants.ts` caps + Zod `.max(n)` + extractor slice; "large repo" note | `facts.test.ts`, `extractor.test.ts`, `OnboardingTourView.test.tsx` | ✅ |

## Non-AC promises

- 4 required repo-intel capabilities exist as facade methods (stack, routes, setup commands, importer counts) — ✅
- Shared `OnboardingTour` contract present; client copy byte-identical — ✅
- Pre-existing unused `onboarding` table dropped; `onboarding_tours` created in migration `0012` — ✅
- Prompt template `onboarding.system.md` realigned to the 5-section shape — ✅
- reviewer-core & e2e untouched — ✅
- Untrusted repo facts wrapped (`wrapUntrusted`) + injection guard + mermaid sanitizer — ✅

## Gaps / drift

- **Gaps:** none.
- **Drift:** none material. One cosmetic note — `OnboardingRepository.toDto()` computes `lastRefreshedAt`
  from `indexUpdatedAt ?? generatedAt`, but both `service.ts` call sites overwrite it with `generatedAt`
  (spec ASSUMPTION), so the intermediate value is never observed. Harmless; follow-up cleanup only.

## Pipeline (commit per SDD step)

| Step | Agent(s) | Commit |
|------|----------|--------|
| 1 spec | spec-creator | `ab0b378` |
| 2 plan | implementation-planner + cross-model review (Sonnet 5, REVISE→resolved) | `2351d19`, `c3f50fb` |
| 3 code | implementer ×11 (DAG waves) | `2601ba8` |
| 4 tests + arch review | test-writer ×2 (AC-derived) + architecture-reviewer (PASS) | `03a79b3` |
| 5 verify | plan-verifier (this report) | — |

## Architecture review (Step 4)

Gate **PASS** (0 critical, 0 high). Two findings (direct DB read in `service.ts`; `new Service` per route
handler) mirror the repo-wide `conventions/` precedent — inherited pattern, not regressions. Security note
(repo lookup lacks a `workspaceId` filter, same as `conventions`) flagged as a repo-wide follow-up.
