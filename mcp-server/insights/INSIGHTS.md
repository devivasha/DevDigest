# mcp-server Insights

Non-obvious discoveries from real sessions. Specific and actionable — pass the cold-read test.
See also: `insights/gotchas.md` for known quirks at project start.

---

## What Works

2026-06-26 — tsx honors tsconfig `paths` at runtime (no separate tsconfig-paths/register needed); same pattern as `server/`. ref: mcp-server/tsconfig.json

2026-06-26 — `@modelcontextprotocol/sdk` v1.29.0 installs cleanly with pnpm under `"type":"module"` package. ref: mcp-server/package.json

## What Doesn't Work

2026-06-26 — `console.log` anywhere under `src/` corrupts the MCP stdio transport (stdout is the JSON-RPC channel). ALL output must go through `log.*` which routes to `console.error` (stderr). ref: mcp-server/src/log.ts:1

## Codebase Patterns

2026-06-29 — Un-stubbing a tool follows the same DI shape as the real tools: add the endpoint method to `http/client.ts` (+ `DevDigestClient` type + `createClient()`), change the tool's signature to `register*(server, client, deps)`, resolve human inputs (repo + pr#) to a `pullId` via `core/resolve.resolvePullId`, then `client.<method>(pullId)`. The `get-blast-radius` tool now mirrors `get-findings` exactly. A tool registered as `register*(server)` with no client can only ever be a stub. ref: mcp-server/src/tools/get-blast-radius.ts:1

2026-06-26 — The `@devdigest/shared` path alias points to `../server/src/vendor/shared/index.ts` (relative to mcp-server/). Works at both compile time (tsc paths) and runtime (tsx). ref: mcp-server/tsconfig.json:18

2026-06-26 — DevDigest API endpoints return BARE shapes, not `{ data: ... }` envelopes. `GET /agents` returns `Agent[]` directly; `POST /pulls/:id/review` returns `{ pr_id, runs, reviews }`. ref: mcp-server/src/http/client.ts

2026-06-26 — `PrMeta.id` is `.nullish()` in the shared contract — must guard before using as a pullId. The field is a UUID present for persisted PRs, absent for GitHub-only ones. ref: server/src/vendor/shared/contracts/platform.ts:158

2026-06-26 — `ReviewRecord.verdict` is `.nullable()` — summary-kind rows have null verdict. Always guard before using in output. ref: server/src/vendor/shared/contracts/review-api.ts:31

2026-06-26 — `Finding` uses `start_line`/`end_line` (NOT `line`). `compactFinding` surfaces `start_line` as `line` for human-readable file:line output. ref: mcp-server/src/format.ts:55

2026-06-26 — Conventions route requires UUID `repoId` — `GET /repos/:repoId/conventions` validates with `z.string().uuid()`. Passing a repo name will 400; must resolve name→id first via `GET /repos`. ref: server/src/modules/conventions/routes.ts:8

## Tool & Library Notes

2026-06-26 — pnpm install warns about `esbuild` build scripts being ignored — benign, esbuild is a transitive dep of tsx; approve with `pnpm approve-builds` if needed. ref: mcp-server/package.json

## Recurring Errors & Fixes

2026-06-26 — `noUncheckedIndexedAccess` in tsconfig requires guarding array[0] even after a `.length === 1` check — TypeScript still types it as `T | undefined`. Pattern: `const match = matches[0]; if (!match) return { error: ... }; return { repoId: match.id }`. ref: mcp-server/src/core/resolve.ts:54

## Session Notes

2026-06-26 — Implemented Phase 0 (T0–T3): scaffold, config/log, HTTP client, format helpers. All 4 tasks typecheck clean; no console.log in src/. Files: mcp-server/package.json, mcp-server/tsconfig.json, mcp-server/.env.example, mcp-server/.gitignore, mcp-server/src/index.ts, mcp-server/src/config.ts, mcp-server/src/log.ts, mcp-server/src/http/client.ts, mcp-server/src/format.ts.

2026-06-26 — Implemented T9 (get-blast-radius STUB): `server.registerTool(name, { description, inputSchema, annotations }, handler)` is the `registerTool` overload to use (not the deprecated `tool()` method). inputSchema is a raw Zod shape object (not `z.object()`). Handler receives parsed args typed from the shape. Files: mcp-server/src/tools/get-blast-radius.ts.

2026-06-26 — Implemented Phase 1 application core (T6, T6b, T8a): resolve.ts, findings.ts, run-review.ts. Key reconciliations: ReviewRecord.kind === 'review' filter to exclude summary rows; sorted[0] guard required by noUncheckedIndexedAccess; shapeFindings returns a union type so run-review.ts casts findings as CompactFinding[]; RunSummary.status is nullable — null/unknown treated as still-running. pnpm typecheck exits 0; no console.log. Files: mcp-server/src/core/resolve.ts, mcp-server/src/core/findings.ts, mcp-server/src/core/run-review.ts.

## Open Questions

## Session Notes (continued)

2026-06-26 — Implemented T4 (list-agents): empty inputSchema must be typed as `Record<string, z.ZodTypeAny>` (not just `{}`) to satisfy TypeScript strict mode when passed to `server.registerTool`. On ApiError, `err.url` gives the exact endpoint URL for the forward-leading error message; fall back to `config.apiUrl` for non-ApiError network failures. ref: mcp-server/src/tools/list-agents.ts

2026-06-26 — Implemented T5 (get-conventions): injecting `resolveRepoId` as a deps function uses `typeof ResolveRepoIdFn` (imported as a type alias from resolve.ts) to avoid re-declaring the signature and prevent drift. `compactConvention` from format.ts handles `evidence_path → file` mapping, keeping the tool handler thin. Resolution failures propagate via `toolError(resolved.error)` — the resolver already formats forward-leading messages with available repo names. ref: mcp-server/src/tools/get-conventions.ts

2026-06-26 — Implemented T7 (get-findings): the `limit` field is left as `z.number().int().min(1).optional()` (no `.default()`) because the default depends on `response_format` (10 for concise, 20 for detailed). The format-dependent default is computed inside the handler after Zod parsing. This is the only case in the tool suite where a field default cannot be expressed at the schema level. ref: mcp-server/src/tools/get-findings.ts:94

2026-06-26 — Implemented T8 (run-agent-on-pr): agent validation does id-first exact match, then case-insensitive name match. Both outer I/O operations (resolvePullId, listAgents) catch ApiError separately so the error message always includes the exact url. The try/catch around the whole handler body is the last-resort guard for unexpected throws — runReviewAndWait itself propagates client errors as `kind:"failed"` result, not exceptions. ref: mcp-server/src/tools/run-agent-on-pr.ts

2026-06-26 — Implemented T10 (composition root index.ts): `McpServer` comes from `@modelcontextprotocol/sdk/server/mcp.js`; `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`. Both are resolved by the package's `./*` wildcard export (`"import": "./dist/esm/*"`). Log via `log.info` before `server.connect(transport)` is safe — the transport channel is not active until connect is called. ref: mcp-server/src/index.ts:1

2026-06-26 — `pnpm start </dev/null` with StdioServerTransport exits 0 (not an error) when stdin is /dev/null — the transport closes cleanly on EOF. This is the correct behavior to test for stdout-cleanliness: redirect stdin from /dev/null, redirect stderr to /dev/null, check that stdout byte count is 0. ref: mcp-server/src/index.ts
