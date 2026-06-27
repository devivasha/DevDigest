# CLAUDE.md — reviewer-core

Pure TypeScript review engine. Zero I/O except the injected `LLMProvider`. No DB, no GitHub, no filesystem. The server wraps it with persistence and streaming.

## Pipeline (in order)

1. `assemblePrompt()` — build system + user message from diff, agent system prompt, repo map
2. `wrapUntrusted()` — fence diff and PR body so they cannot override instructions
3. Append `INJECTION_GUARD` to system prompt (always, unconditionally)
4. `LLMProvider.complete()` — injected, swappable, stubbed in tests
5. Parse structured output: Zod schema → JSON Schema → parse-with-repair
6. `groundFindings()` — **mandatory gate**: drop any finding that does not cite a real diff line; recompute score

## Critical Rules

- `groundFindings()` is not a filter — it is a contract. Every finding must survive grounding or it is dropped. Never bypass or make it optional.
- `LLMProvider` is always injected. Never call an LLM API directly inside this package.
- `wrapUntrusted()` must wrap diff and PR body before they reach the prompt. Never concatenate untrusted content directly into the system prompt.
- This package never emits JS. `npm run build` = `tsc --noEmit`. It is consumed as raw TypeScript by the server, vitest, and CI bundler.

## Testing

All tests are hermetic — LLM provider is a stub that returns fixture JSON. No Docker, no network. Run with `npm test`.

## Read When

- **Understanding each pipeline step in detail** → `reviewer-core/docs/pipeline.md`
- **What makes a finding valid/invalid** → `reviewer-core/specs/grounding-spec.md`
- **Hit unexpected behavior (no-emit, injection guard, grounding edge cases)** → `reviewer-core/insights/gotchas.md`

## Session Context

Before starting any work in this module, read `insights/INSIGHTS.md` and treat it as high-confidence guidance unless explicitly told otherwise. To confirm active loading: summarize the top 3 most relevant points before beginning.

## End of Session

After completing work in this module, run `/engineering-insights` to update `insights/INSIGHTS.md`. Do not skip — if capture requires a human trigger it will not happen consistently enough to compound.
