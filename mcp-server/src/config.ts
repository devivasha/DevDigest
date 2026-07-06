/**
 * config.ts — process configuration for the MCP server.
 *
 * Reads ONLY non-secret connection/timeout settings from the environment. There
 * are no API keys here: the MCP client sends no auth (LocalNoAuthProvider
 * resolves the default workspace server-side).
 */

/** Base URL of the DevDigest API. Overridable via DEVDIGEST_API_URL. */
const apiUrl = (process.env.DEVDIGEST_API_URL ?? "http://localhost:3001").replace(
  /\/+$/,
  "",
);

/**
 * How long run_agent_on_pr blocks inline (polling for the run to finish) before
 * giving up and returning `{status:'running', run_id}` for later retrieval.
 *
 * A background review can take a while (~1–2 min). We block for up to ~120s so
 * the common case returns the verdict + findings in a single call. The client
 * is kept from cutting the blocking request early by `MCP_TOOL_TIMEOUT` in
 * `.mcp.json` (set > runTimeoutMs). On timeout we hand back
 * `{status:'running', run_id}` and the review keeps running server-side.
 *
 * Overridable via DEVDIGEST_RUN_TIMEOUT_MS.
 */
const parsedRunTimeout = Number(process.env.DEVDIGEST_RUN_TIMEOUT_MS);
const runTimeoutMs =
  Number.isFinite(parsedRunTimeout) && parsedRunTimeout > 0 ? parsedRunTimeout : 120_000;

export const config = {
  /** DevDigest API base URL (no trailing slash). */
  apiUrl,
  /** Poll interval while waiting for a background review run (~2s). */
  pollIntervalMs: 2000,
  /** Inline wait budget for run_agent_on_pr (~120s). */
  runTimeoutMs,
} as const;

export type Config = typeof config;
