# Cross-model review — Eval Pipeline plan (raw output)

**Reviewer model:** `google/gemini-2.5-pro` (via OpenRouter) · staff-engineer role, no access to the authoring chat
**Date:** 2026-07-12
**Reviewed:** the approved spec (`specs/2026-07-12-eval-pipeline.md`) + the plan (`docs/plans/eval-pipeline.md`)
**Usage:** 27,601 prompt / 5,791 completion tokens · cost ≈ $0.092 · temperature 0.3

## Provenance

This file is the **verbatim raw output** of one cross-model review run. The reviewer is a
different model family from the author (author: Anthropic Opus; reviewer: Google Gemini 2.5 Pro),
invoked with no access to the authoring conversation, in a staff-engineer role. The
**dispositions folded into the plan** live in `docs/plans/eval-pipeline.md` →
section *"Cross-model review (Gemini 2.5 Pro) — findings & dispositions"*.

Verdict: **ship-with-listed-fixes**. Single most important change before coding: add a
`workspace_id` column to `eval_runs` (structural tenancy, AC-24).

---

MODEL: google/gemini-2.5-pro
USAGE: prompt_tokens=27601, completion_tokens=5791, total_tokens=33392, cost=$0.09241125 (temperature=0.3)

----- REVIEW -----
This is a high-quality, detailed implementation plan. The author has clearly internalized the spec, identified key implementation details from the existing codebase, and structured the work for parallel execution. The critique below focuses on hardening the design against subtle but severe bugs.

### 1. TOP RISKS (ranked, most severe first; each: what breaks, why, and a concrete fix)

1.  **Data Leakage via Transitive Tenancy.** The `eval_runs` table lacks a `workspace_id` and relies on a join through `eval_set_runs` for tenancy enforcement. This is fragile and will inevitably lead to a cross-workspace data leak. A future developer, tasked with a seemingly simple query like "find the most recent run for this case," could easily query `eval_runs` filtering only by `case_id` and `ran_at`, bypassing the `eval_set_runs` join and its `workspace_id` check. This would leak run data to any user who knows a valid `case_id`.
    *   **What breaks:** AC-24 (workspace scoping) is violated, leading to a severe security/tenancy bug.
    *   **Why:** The data model outsources tenancy enforcement to developer discipline on every future query path, rather than enforcing it structurally. This pattern is a known anti-pattern in multi-tenant systems.
    *   **Concrete fix:** Add `workspace_id uuid NOT NULL` to the `eval_runs` table in T2. Populate it in T7 (`insertCaseRun`) by copying it from the parent `eval_set_runs` row. Modify the repository (T5) to filter *every* query on `eval_runs` with `and(eq(tables.evalRuns.workspaceId, workspaceId), ...)`. This provides defense-in-depth and makes direct queries on the table safe.

2.  **Incorrect Precision/Recall from Ambiguous "Produced Findings".** The plan assumes in T7 that the "produced findings" used for recall/precision scoring are the *post-grounding* (`kept`) findings from `reviewPullRequest`. The spec is ambiguous, simply saying "produced findings". This creates a correctness risk. If a model produces 10 findings, but 9 are dropped by grounding, the plan would score precision against only the 1 kept finding. This hides the model's poor grounding performance from the precision metric, likely inflating it. A user might expect precision to reflect *all* model output, as `must_not_flag` is about what the agent *should not have said at all*.
    *   **What breaks:** AC-7 (precision) and AC-6 (recall) may be calculated against a different set of findings than the product owner intended, leading to misleading metrics.
    *   **Why:** The term "produced findings" is not precisely defined in the spec as pre- or post-grounding. The plan makes a logical but unconfirmed assumption.
    *   **Concrete fix:** Before implementation, confirm with the product owner: should recall/precision be calculated on pre-grounding findings (`kept` + `dropped`) or post-grounding findings (`kept` only)? Update T4 and T7 accordingly. The most likely correct behavior is:
        *   **Precision:** Numerator is `(total pre-grounding findings) - (pre-grounding findings that match a must_not_flag target)`. Denominator is `total pre-grounding findings`. This correctly penalizes the model for any invalid output.
        *   **Recall:** Numerator is `(# must_find expectations matched by at least one *kept* finding)`. Denominator is `total # must_find expectations`. A finding that was produced but dropped by grounding should not count as a successful recall.

3.  **Flaky/Broken Dev Environment from Non-Idempotent Seeding.** The plan correctly identifies in T15's "Known gotchas" that `eval_cases` has no unique constraint and `onConflictDoNothing` will fail silently. However, this risk is severe enough to be elevated. If the select-then-insert logic is implemented incorrectly, running `pnpm db:seed` multiple times will create duplicate eval cases. This will break tests for AC-15 (under-min warning), AC-16 (sensitivity), and any UI test that assumes a fixed number of cases.
    *   **What breaks:** The development and CI environments become unreliable due to data duplication. Tests for AC-15, AC-16, and others will become flaky.
    *   **Why:** The database schema lacks a constraint that can be used for robust, declarative upserting. The fallback procedural logic is easy to get wrong.
    *   **Concrete fix:** In T2, add a unique constraint to `eval_cases` on `(workspace_id, owner_id, name)`. Then, in T15, the seed script can use Drizzle's `onConflictDoUpdate` or `onConflictDoNothing` reliably, making the seed operation atomic and robustly idempotent. This is safer than procedural select-then-insert logic.

### 2. CONCRETE GAPS (missing tasks/edge-cases/assumptions, with the specific file or AC they touch)

1.  **Unconfirmed Assumption on Degraded Diff Handling (AC-17).** Rec-D and T7 correctly plan to handle an unparseable `input_diff` by setting `citation_accuracy = null`. However, the plan also assumes the entire `reviewPullRequest` step should be skipped. This is logical, but unconfirmed. If skipped, no findings are produced, leading to `precision = 1.0` and `recall = 0.0` (or `1.0` if no `must_find`s). This needs to be explicitly confirmed as the desired behavior.
    *   **Touches:** T7 (`service.ts`), AC-17.

2.  **Ambiguity in `createFromFinding` Agent Ownership (AC-3).** T7's plan for `createFromFinding` needs to associate the new case with an agent. It says "resolve the live agent row" and "the review's agent". The path is not explicit. The `findings` table has a `review_id`, which links to the `reviews` table, which has an `agent_id`. This chain must be followed. The API signature in T8 (`POST /agents/:id/eval-cases/from-finding`) suggests the `agentId` is passed in the URL, which is redundant if it can be derived from the `findingId`. This creates a potential conflict.
    *   **Touches:** T7 (`service.ts`), T8 (`routes.ts`), AC-3.
    *   **Fix:** Clarify the source of truth. The most robust path is to derive `agentId` from `findingId` via the database join (`finding -> review -> agent`). The `agentId` in the URL should be removed to prevent inconsistencies, or used only for an authorization check (`is this finding owned by a review from this agent?`).

3.  **Race Condition in `input_diff` Capture (AC-3).** The spec requires capturing the PR's diff as a *fixed* input. T7 plans to reload the diff at case creation time. There is a small but real race condition: the PR's underlying code could be force-pushed between the user seeing the finding on the UI and the server processing the "create case" request. The captured diff might not match the code that produced the original finding.
    *   **Touches:** T7 (`service.ts`), AC-3.
    *   **Note:** This is a low-probability, hard-to-fix issue inherited from the spec. The plan's approach is pragmatic. The gap is the lack of acknowledgement of this known limitation. No immediate code change is required, but it's an assumption that should be documented.

4.  **All-Dropped Grounding Result is Not an Error (AC-8).** The plan's "Risks" section correctly notes that an all-dropped result is valid. This needs to be explicitly asserted in a test. It's a common mistake to assume that an empty `review.findings` array from `reviewPullRequest` indicates an error, when it's a valid state representing 100% hallucinated findings.
    *   **Touches:** T7 (`service.ts`), T16 (`service.test.ts`), AC-8.
    *   **Fix:** Add a specific test case to T16 where the `MockLLMProvider` returns findings that do not overlap with the diff, `reviewPullRequest` returns an empty `kept` array and a non-empty `dropped` array, and the resulting `citation_accuracy` is correctly calculated as `0.0`.

### 3. THINGS IT GOT RIGHT (brief)

*   **Excellent Structure:** The plan's breakdown into a DAG, concurrency waves, and non-overlapping `Owned paths` is superb for enabling parallel work. The traceability matrix is complete.
*   **Robust Test Strategy:** The plan for a pure, LLM-free scorer (T4) and the hermetic test for prompt sensitivity (AC-16 in T16) are both excellent, ensuring the core logic is provably correct and testable without flaky network calls.
*   **Pragmatic Schema Design:** The introduction of `eval_set_runs` (Rec-B) is an elegant solution that solves both the set-grouping (GAP-2) and reproducibility (GAP-1) problems at the correct level of granularity.
*   **Codebase Awareness:** The "Known gotchas" and "server INSIGHTS" show deep familiarity with the existing codebase, correctly identifying pitfalls with Drizzle migrations, seed idempotency, and `reviewer-core` contracts. This de-risks implementation significantly.
*   **Safe Contract Evolution:** The strategy in Rec-C to tighten contracts at the write boundary (`eval-ci.ts`) while leaving the broadly-consumed read model (`knowledge.ts`) permissive is a smart, defensive choice that minimizes blast radius.

### 4. VERDICT

**ship-with-listed-fixes**.

The plan is exceptionally strong but contains a critical, high-risk tenancy flaw. The other risks are also significant enough to warrant fixes before coding begins. The plan is otherwise well-prepared for implementation.

The single most important thing to change before coding is **to fix the tenancy model by adding a `workspace_id` column to the `eval_runs` table.** This is a non-negotiable security requirement for a multi-tenant application and is far cheaper to fix in the schema design phase than after an incident.
