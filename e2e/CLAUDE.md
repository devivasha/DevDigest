# CLAUDE.md — e2e

Deterministic browser flows using `agent-browser`. No Playwright, no LLM, no API keys required. Flows are JSON specs with CLI-driven steps.

## Running

```bash
# Hermetic (isolated stack — preferred for CI)
./scripts/e2e.sh

# Against a running stack (must be seeded first)
./scripts/dev.sh    # in another terminal
cd e2e && npm test
```

## Flow Step Format

```json
{ "command": "--url", "value": "http://localhost:3000" }
{ "command": "--text", "value": "Expected text on page" }
{ "command": "find",  "value": "CSS selector or label" }
```

Steps are executed sequentially. A flow fails on the first failing step.

## Coverage (7 flows)

| Flow | What it verifies |
|------|-----------------|
| `boot` | App loads, no crash |
| `repo-list` | Repos page renders seeded repo |
| `repo-detail` | PR list loads for a repo |
| `agents` | Agents page CRUD renders |
| `findings` | Findings render on PR detail |
| `diff` | Diff view loads |
| `onboarding` | Onboarding wizard flow |
| `settings` | Settings page renders |

## Do Not Touch Without Reading

- `run.ts` — orchestrates all flows. Read `e2e/docs/flows.md` before adding new ones.

## Read When

- **Writing a new flow** → `e2e/docs/flows.md`
- **Understanding what is and is not covered** → `e2e/specs/coverage.md`
- **Hit unexpected behavior (agent-browser install, hermetic teardown, CI)** → `e2e/insights/gotchas.md`

## Session Context

Before starting any work in this module, read `insights/INSIGHTS.md` and treat it as high-confidence guidance unless explicitly told otherwise. To confirm active loading: summarize the top 3 most relevant points before beginning.

## End of Session

After completing work in this module, run `/engineering-insights` to update `insights/INSIGHTS.md`. Do not skip — if capture requires a human trigger it will not happen consistently enough to compound.
