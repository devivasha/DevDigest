# dependency-checker — skill evaluation

With-skill vs. without-skill evaluation of `.claude/skills/dependency-checker/SKILL.md`, run via the
skill-creator harness on 2026-07-12 (model: Opus 4.8). Baseline = **no skill** (same prompt, the
subagent explicitly forbidden from reading/using the skill).

Purpose: measure whether the skill actually improves a dependency audit vs. what the base model does
unaided. Method: planted-defect fixtures (real dependency problems, **zero comments hinting at them**),
3 test prompts × {with-skill, without-skill} per iteration, keyword-graded against the planted defects.

## Layout

```
fixtures/mini-repo/     iteration-1 fixtures (textbook defects)
fixtures/mini-repo-2/   iteration-2 fixtures (subtle, assembly-required defects)
evals.json              iteration-1 prompts + planted-finding map
grade.py                iteration-1 grader   -> writes grading.json per run
grade2.py               iteration-2 grader
iteration-1/            eval-*/{with_skill,without_skill}/outputs/report.md + grading.json + run-1/timing.json
iteration-2/            same shape; benchmark.json / benchmark.md at the root of each
```

Re-run a grader: `python3 grade.py` / `python3 grade2.py`.
Re-view: `python3 <skill-creator>/eval-viewer/generate_review.py iteration-2 --skill-name dependency-checker --benchmark iteration-2/benchmark.json --previous-workspace iteration-1`

## Planted defects

**iteration-1 (`mini-repo`)** — 8 defects: P0 circular `server↔reviewer-core`; P0 client reaching into
`server/src` internals via relative path; P1 `zod` v3/v4 drift; P1 unused `lodash` (server); P1 unused
`axios` (client); P2 duplicate date libs (`date-fns`+`moment`); P2 `eslint` in `dependencies`; Info
reviewer-core zero-runtime-deps.

**iteration-2 (`mini-repo-2`)** — subtler, with **generic (non-leading) prompts**: 3-hop cross-package
cycle `server → shared → reviewer-core → server`; `vitest` `^1.6` in client vs `^2` elsewhere (buried
drift); `tailwindcss` used only via `tailwind.config.ts`/`postcss` (false-"unused" trap); cross-package
duplicate date libs (`date-fns` server + `dayjs` client); genuinely unused `uuid` (server).

## Results

| Iteration | Fixtures / prompts | With skill | Without skill | Δ pass | Time | Tokens |
|---|---|---|---|---|---|---|
| 1 | textbook defects, leading prompts | 100% | 100% | 0 | +98s | +7,959 |
| 2 | subtle defects, generic prompts | 100% | 95.2% | +4.8% | +82s | +4,696 |

## Conclusions

1. **No detection uplift.** Baseline Opus caught every planted defect in both iterations — including the
   3-hop cycle, the buried version drift, and the tailwind false-"unused" trap. The skill did not find
   anything the baseline missed.
2. **The only measured delta (+4.8% in iter-2) is structural, not a finding:** under the terse
   "quick ship sanity check" prompt the baseline drew an ASCII diagram instead of Mermaid. The skill
   reliably enforces the Mermaid graph + fixed P0/P1/P2/Info taxonomy + 5-section report.
3. **Best real value = an anti-hallucination guardrail.** With `node_modules` absent, the baseline
   *invented* package sizes from memory ("next ~110–130 MB", "≈20 MB removable"); the skill refused and
   reported "not installed". That is a genuine correctness win the skill enforces.
4. **Trade-off — the skill narrows attention.** The baseline, unconstrained by the skill's taxonomy,
   surfaced extra *real* issues that were never planted (missing `autoprefixer`, no lockfiles, missing
   `react-dom`, floating `0.x` drizzle). The skill mostly omitted these.
5. **Cost:** consistently **+80–100s** and **+5–8k output tokens** per run.

**Caveat:** n=1 per (eval × config) — 3 samples per config per iteration. A robust direction signal,
not rigorous statistics. Graders are keyword-based; one tailwind false-positive and one file/message
divergence were found and corrected by hand during grading.

**Decision (2026-07-12):** conclusion recorded; skill left unchanged. Its value is report consistency +
guardrails, not detection uplift against a strong model.
