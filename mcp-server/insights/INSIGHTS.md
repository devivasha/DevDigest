# mcp-server Insights

Non-obvious discoveries from real sessions. Specific and actionable — pass the cold-read test.
See also: `insights/gotchas.md` for known quirks at project start.

---

## What Works

- **2026-07-06** — Agent resolution in `run_agent_on_pr` accepts EITHER an agent id OR a case-insensitive name (id first, then name fallback), so `{agent:"General Reviewer"}` works as well as the UUID. Verified end-to-end against a live run. ref: `mcp-server/src/tools/run-agent-on-pr.ts:62`

## What Doesn't Work

- **2026-07-06** — Capping the inline wait at 45s (the earlier `DEVDIGEST_INLINE_WAIT_MS=45000` "fix") is WRONG: real reviews routinely take 45–120s (e.g. PR #5 finished at ~63s with verdict `request_changes` + 4 findings), so a 45s budget returns `{status:'running'}` even though the run completed fine server-side — the caller never sees the verdict inline. ROLLED BACK to the plan design: block up to ~120s (`DEVDIGEST_RUN_TIMEOUT_MS`, default 120000) and set `MCP_TOOL_TIMEOUT=150000` (> runTimeoutMs) in `.mcp.json` so the client doesn't cut the blocking call early. The "-32001 Request timed out" symptom is a CLIENT request-timeout config issue (`MCP_TOOL_TIMEOUT`), not a reason to shorten the server-side wait. ref: `mcp-server/src/config.ts:28`, `.mcp.json`

- **2026-07-06** — `pnpm start` / `pnpm inspect` from the repo ROOT fail with `ERR_PNPM_NO_SCRIPT_OR_SERVER: Missing script start` / `Command "inspect" not found` — those scripts exist ONLY in `mcp-server/package.json`, not root. Run them from `mcp-server/`, or use the root wrappers `pnpm mcp` / `pnpm mcp:inspect` / `pnpm mcp:smoke`. ref: `package.json` (root scripts), `mcp-server/package.json`

## Codebase Patterns

- **2026-07-06** — The MCP server is DELIBERATELY decoupled from the app boot scripts: `./scripts/dev.sh` never references `mcp-server/` (it starts Postgres + API + web only). The MCP server is launched separately — manually (`pnpm mcp*`) or by Claude Code via project-scoped `/.mcp.json` (only inside a CC session, after approval). Don't add it to `dev.sh`. ref: `scripts/dev.sh:102`, `.mcp.json`

- **2026-07-06** — `@devdigest/shared` is consumed here via a tsconfig `paths` alias pointing straight at `../server/src/vendor/shared/index.ts` (raw TS, no build), resolved at runtime by `tsx` — same trick the server uses. `mcp-server` has its OWN `zod` dep, so two Zod instances coexist (shared schemas parse with server's zod, tool `inputSchema`s use mcp-server's). Safe ONLY because shared contracts are consumed as read-only TYPES, never cross-parsed. ref: `mcp-server/tsconfig.json:19`

## Tool & Library Notes

- **2026-07-06** — `@modelcontextprotocol/sdk` v1.x `server.registerTool(name, cfg, handler)` expects `cfg.inputSchema` as a **ZodRawShape** — a plain object mapping field → Zod type (`{ repo: z.string().describe(...) }`), NOT a wrapped `z.object(...)`. A no-argument tool uses `inputSchema: {}`. The SDK wraps/validates it and hands the handler the parsed args object. ref: `mcp-server/src/tools/list-agents.ts:23`

- **2026-07-06** — Over stdio, stdout IS the JSON-RPC channel, so a single stray `console.log` corrupts the protocol. Enforced two ways: (1) all logging routes through `log.ts` → `console.error` (stderr); (2) `scripts/smoke.mjs` asserts every stdout line `JSON.parse`s, failing loudly on any banner. `pnpm start` therefore prints NOTHING to stdout and looks "idle" by design. ref: `mcp-server/src/log.ts:13`, `mcp-server/scripts/smoke.mjs:136`

- **2026-07-06** — The `node >=22` engines warning (`Unsupported engine … current v20.19.0`) is NON-fatal: `tsx` + SDK 1.29 run fine on Node 20.19 (all smoke tests passed on it). Added `mcp-server/.nvmrc=22` so `nvm use` aligns to the repo standard. ref: `mcp-server/.nvmrc`

## Recurring Errors & Fixes

## Session Notes

- **2026-07-06** — Built the `mcp-server/` package from `docs/plans/mcp-server.md`: a local stdio MCP server exposing 5 `devdigest_*` tools (list_agents, run_agent_on_pr, get_findings, get_conventions, get_blast_radius stub) as a thin HTTP client over the API on :3001. Onion split: `index.ts` (root) → `tools/*` (thin) → `core/*` (resolve/findings/run-review) → `http/client.ts` (only fetch). Verified via `pnpm typecheck`, `pnpm smoke` (real JSON-RPC handshake), and one live review run (18.6s → verdict). Files: `mcp-server/src/**`, `.mcp.json`, `mcp-server/README.md`.

## Open Questions
