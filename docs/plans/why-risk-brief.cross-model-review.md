# Cross-model review — Why+Risk Brief plan (raw output)

**Reviewer model:** `google/gemini-2.5-pro` (via OpenRouter) · staff-engineer role, no access to the authoring chat
**Date:** 2026-07-11
**Reviewed:** the approved spec (`specs/2026-07-11-why-risk-brief.md`) + the plan (`docs/plans/why-risk-brief.md`)
**Usage:** 18,667 prompt / 4,428 completion tokens · cost ≈ $0.047

## Provenance & important caveat

This file is the **verbatim raw output** of one cross-model review run. The review was invoked twice
(temperature 0.3, so the runs are non-deterministic and **not identical**). The **summary + dispositions
folded into the plan** (`docs/plans/why-risk-brief.md` → section *"Cross-model review (Gemini 2.5 Pro) —
findings & dispositions"*) came from the **sibling run**. The two runs overlap heavily (attached-specs
noise, smart-diff-extraction regression risk) but this captured run **also raised findings that were NOT
folded into the plan**:

- **Compute race condition** in `getOrCompute` ("last-and-potentially-stale-write-wins") — currently
  undocumented in the plan's Risks section.
- **Broken `githubBlobUrl` links for renamed/deleted files** (T8) — a blob URL at head-SHA 404s for files
  whose status is `renamed`/`deleted`; the card doesn't receive `PrFile.status`.
- **Empty-but-valid Brief vs. error state** (T8) — a schema-valid `{what:"", why:"", …}` should render an
  "empty" state distinct from a technical load error.
- **A task to *prove* `pr_brief` is unused** before relying on the no-migration assumption (the plan asserts
  it but `safeParse`/Rec3 only defends, it doesn't verify).

These are **open** (not addressed in the shipped implementation). See the end of this file / ask to fold them in.

---

MODEL: google/gemini-2.5-pro
USAGE: prompt_tokens=18667, completion_tokens=4428, total_tokens=23095, cost=$0.04690925 (cached prompt tokens=18404)

----- REVIEW -----
This is a solid, detailed plan. My review focuses on risks and gaps it understates or creates.

### 1. TOP RISKS

1.  **Correctness: Misleading Brief due to "Attached Specs" Hand-waving (Q1, T5).** This is the most severe risk. The spec assumes a per-PR set of "attached specs" exists; the plan correctly identifies it does not and proposes a "union of all workspace agents' docs" (Q1). This is a significant leap that could feed irrelevant, contradictory, or outdated context into the prompt, poisoning the output. A brief generated from the wrong context is worse than no brief. The proposed cap (5 docs, 12KB) mitigates token cost but not the risk of incorrectness.
2.  **Concurrency: Stale-Write Race Condition in `compute` (T5).** The plan correctly implements the spec's "last write wins" via `upsert`. However, it doesn't address the race condition inherent in the `getOrCompute` logic. Consider two parallel requests for a non-cached brief:
    *   Req A starts `compute`.
    *   Req B starts `compute`.
    *   Req B finishes gathering inputs, gets a fast LLM response, and writes to the DB.
    *   Req A, having started slightly earlier, was gathering inputs that may now be stale. It gets a slow LLM response and overwrites Req B's fresh result with its own stale one.
    This isn't just last-write-wins; it's "last-and-potentially-stale-write-wins". For a summary, this is low-impact but it's a correctness flaw in the compute-and-cache pattern.
3.  **Regression: Smart-Diff Extraction (T3).** The plan correctly identifies this as a "medium" risk, but the potential impact is high. The `pulls/routes.ts` handler is a known-working, legacy piece of code. Refactoring it has a non-zero chance of introducing subtle behavioral changes (e.g., in floating point math, array ordering, or edge cases around the `LARGE_PR_THRESHOLD`). The acceptance criterion "output must be byte-identical" is the right goal but is hard to prove exhaustively. A regression here would affect an existing, user-facing feature.

### 2. CONCRETE GAPS

*   **Missing Task: Proving `pr_brief` is Unused.** The plan and spec assert the `pr_brief` table is "read/written by nothing". This is a critical assumption for a no-migration change. A task is missing to verify this claim, e.g., by searching the codebase for `t.prBrief` or `pr_brief` string literals and confirming no other writers exist. T2's `safeParse` (Rec3) is a good defense, but doesn't replace verification.
*   **Wrong Assumption: `githubBlobUrl` is Sufficient (T8).** The plan assumes `githubBlobUrl` can be built for all file paths. It cannot. For files that were renamed, moved, or deleted in the PR, a link to the `headSha` will 404. The client needs to handle this, likely by checking the file's `status` from the PR file list (which is not currently plumbed to the card). The current plan will produce broken links for a significant class of changes.
*   **Missing Edge Case: Empty State vs. Error State (T8).** The plan correctly specifies loading and error states. It misses the distinction between an *error* (generation failed) and a *legitimately empty brief* (e.g., model returns `{what: "", why: "", ...}`). While the prompt discourages this, a model *can* return empty-but-valid-schema output. The card should render this as an "empty" state (e.g., "Could not generate a brief for this PR"), distinct from a "failed to load" technical error.
*   **Unaddressed Complexity: `groupSmartDiff` Input (T5).** T5 plans to call `groupSmartDiff` with a `SmartDiffFile` object where `finding_lines` and `pseudocode_summary` are `[]` and `null`. This assumes the `groupSmartDiff` function doesn't depend on them. The plan for T3 must ensure the extracted function is pure *with respect to file path and line counts only*, and this contract must be documented.

### 3. THINGS IT GOT RIGHT

*   **Resilience by Design.** The plan is excellent at building a resilient system. Using `safeParse` for DB reads (Rec3), best-effort `.catch()` for input gathering (T5), and service-level capping for LLM outputs (Rec1) are all pragmatic choices that will prevent cascading failures.
*   **Excellent Security Posture.** The plan correctly identifies and mitigates prompt injection (`wrapUntrusted`), data leakage (tenancy-first checks), and fabricated links (path-grounding). The distinction between path-grounding and the out-of-scope line-grounding is sharp and correct.
*   **Clean Architecture & Parallelism.** The contracts-first DAG, clear ownership of files per task, and adherence to onion architecture are exemplary. This plan is genuinely executable in parallel.
*   **Identifying Spec Gaps.** The plan doesn't just implement; it questions. Raising Q1 (Attached Specs) and Q2 (Rate Limiting) demonstrates a deep engagement with the problem, turning ambiguous spec language into concrete engineering decisions.

### 4. REQUIRED CHANGES CHECKLIST

Before implementation:

1.  **[ ] Resolve "Attached Specs" (Q1):** Confirm the product owner's intent for this input. **Default required change:** Exclude attached specs entirely from the prompt in v1. It's safer to ship with slightly less context than with incorrect context. Update T5.
2.  **[ ] Strengthen Smart-Diff Test (T3/T9):** The acceptance criteria for T3 must explicitly require a snapshot test comparing the JSON output of the existing route with the output of the refactored logic, using a complex, real-world PR as the input fixture.
3.  **[ ] Fix Broken Links for Moved/Deleted Files (T8):** The `PrBriefCard` must receive the full list of `PrFile` objects (which includes the `status` field) from the `OverviewTab`. When rendering a link, if the file status is `renamed`, `deleted`, etc., either build the correct link to the diff view or degrade to a non-navigating control. Do not link to a 404ing blob URL.
4.  **[ ] Add `pr_brief` Usage Verification Task:** Add a new task to grep the codebase for usages of `pr_brief` and `t.prBrief` to prove it is currently unused, confirming the no-migration assumption.
5.  **[ ] Acknowledge Compute Race Condition:** Add a note to the "Risks & Mitigations" section acknowledging the `getOrCompute` race condition. The current "last write wins" is acceptable for this feature's risk profile, but the underlying flaw should be documented.

---

## Status of this run's findings vs. the shipped implementation

| # | Finding | In plan's folded dispositions? | Addressed in code? |
|---|---------|-------------------------------|--------------------|
| Specs noise (Q1) | Attached specs poisoning | Yes (tightened → repo-scope/cap; then omitted-in-v1 since no repo-scoping mechanism exists) | Yes — `gatherSpecTexts` returns `[]` (specs omitted in v1) |
| Smart-diff regression (T3) | Extraction risk | Yes (golden-file parity test added) | Yes — `smart-diff-classifier.test.ts` parity + empty-list |
| Compute race condition | last-and-stale-write-wins | **No** | **No** — undocumented; low impact (summary, last-write-wins accepted) |
| `githubBlobUrl` for renamed/deleted | 404 links | **No** | **No** — card links all paths at head-SHA; renamed/deleted may 404 |
| Empty-vs-error state (T8) | valid-but-empty Brief | **No** | Partial — empty `risks[]` handled; empty `what`/`why` not distinguished from error |
| Prove `pr_brief` unused | no-migration assumption | **No** (verified informally during exploration, not as a task) | Verified informally: grep found only schema/contract/migration refs, no runtime writer |

**Open follow-ups worth considering:** the compute race note (doc-only), renamed/deleted-file link handling (needs `PrFile.status` plumbed to the card), and empty-Brief state. None are blockers; the last-write-wins race and specs-omission are already-accepted trade-offs.
