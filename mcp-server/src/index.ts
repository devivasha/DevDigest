/**
 * index.ts — composition root + stdio entrypoint.
 *
 * The ONLY place that constructs concrete dependencies (the HTTP client) and
 * wires the application-core functions into each tool's `deps`. Registers all 5
 * tools, then connects the stdio transport. All logging goes to stderr — stdout
 * is the JSON-RPC channel and must stay clean.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { config } from "./config.js";
import { log } from "./log.js";
import { createClient, type DevDigestClient } from "./http/client.js";
import { resolveRepoId, resolvePullId } from "./core/resolve.js";
import { pickReview, shapeFindings } from "./core/findings.js";
import { runReviewAndWait } from "./core/run-review.js";

import { registerListAgents } from "./tools/list-agents.js";
import { registerGetConventions } from "./tools/get-conventions.js";
import { registerGetFindings } from "./tools/get-findings.js";
import { registerRunAgentOnPr } from "./tools/run-agent-on-pr.js";
import { registerGetBlastRadius } from "./tools/get-blast-radius.js";

/**
 * Build the server `instructions` — descriptive text returned in the MCP
 * `initialize` response. MCP clients (the Inspector, Claude, …) show this in
 * their server-info panel right after you press **Connect**, so it's the correct
 * channel to surface the connected repository — unlike stderr, which clients
 * render as an error regardless of level.
 *
 * We fetch repos over HTTP *before* the server is built (the API call is
 * independent of the MCP transport). If the API is down we degrade gracefully:
 * the server still starts with generic instructions, and a single warn goes to
 * stderr for the operator.
 */
async function buildInstructions(client: DevDigestClient): Promise<string> {
  const base =
    "DevDigest MCP server — inspect review agents, findings, and repo conventions via the local DevDigest API.";
  try {
    const repos = await client.listRepos();
    if (repos.length === 0) {
      return `${base}\n\nConnected repository: none found — seed the API (\`pnpm db:seed\`) and reconnect.`;
    }
    const names = repos.map((r) => r.full_name).join(", ");
    const label =
      repos.length === 1 ? "Connected repository" : `Connected repositories (${repos.length})`;
    return `${base}\n\n${label}: ${names}.`;
  } catch (err) {
    log.warn(
      `API unreachable at ${config.apiUrl} — connected repositories unknown; tools will error until it's running`,
      err instanceof Error ? err.message : err,
    );
    return `${base}\n\n(API at ${config.apiUrl} is currently unreachable — connected repository unknown.)`;
  }
}

async function main(): Promise<void> {
  const client = createClient(config);

  // Resolve the connected repositories first so we can advertise them in the
  // server instructions shown on Connect.
  const instructions = await buildInstructions(client);

  const server = new McpServer({ name: "devdigest", version: "0.1.0" }, { instructions });

  // Wire concrete deps into each tool (dependency injection at the root).
  registerListAgents(server, client);
  registerGetConventions(server, client, { resolveRepoId });
  registerGetFindings(server, client, { resolvePullId, pickReview, shapeFindings });
  registerRunAgentOnPr(server, client, {
    resolvePullId,
    runReviewAndWait,
    pickReview,
    shapeFindings,
  });
  registerGetBlastRadius(server);

  // Stay silent on stdout/stderr for a healthy start — the connected repo is
  // carried by `instructions`, not a log line.
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  log.error("fatal: failed to start MCP server", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
