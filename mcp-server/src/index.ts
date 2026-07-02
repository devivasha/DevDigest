/**
 * DevDigest MCP Server — composition root (T10).
 *
 * This is the ONLY place where concrete dependencies are constructed and wired.
 * Responsibilities:
 *  1. Build the McpServer instance.
 *  2. Construct the HTTP client from config.
 *  3. Wire application-core functions (resolve, findings, run-review) into each
 *     tool's deps and register all 5 tools.
 *  4. Connect the StdioServerTransport — exactly once.
 *
 * IMPORTANT: stdout is the JSON-RPC channel. ALL logging uses `log` (stderr).
 * Never call console.log anywhere under src/.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { config } from './config.js';
import { log } from './log.js';
import { createClient } from './http/client.js';

import { registerListAgents } from './tools/list-agents.js';
import { registerGetConventions } from './tools/get-conventions.js';
import { registerGetFindings } from './tools/get-findings.js';
import { registerRunAgentOnPr } from './tools/run-agent-on-pr.js';
import { registerGetBlastRadius } from './tools/get-blast-radius.js';

import { resolveRepoId, resolvePullId } from './core/resolve.js';
import { pickReview, shapeFindings } from './core/findings.js';
import { runReviewAndWait } from './core/run-review.js';

async function main(): Promise<void> {
  log.info('DevDigest MCP server starting', { apiUrl: config.apiUrl });

  // Build the MCP server
  const server = new McpServer({
    name: 'devdigest',
    version: '0.1.0',
  });

  // Construct the HTTP client (single instance shared by all tools)
  const client = createClient();

  // Register all 5 tools — inject application-core deps at the composition root
  registerListAgents(server, client);

  registerGetConventions(server, client, { resolveRepoId });

  registerGetFindings(server, client, {
    resolvePullId,
    pickReview,
    shapeFindings,
  });

  registerRunAgentOnPr(server, client, {
    resolvePullId,
    runReviewAndWait,
    pickReview,
    shapeFindings,
  });

  registerGetBlastRadius(server, client, { resolvePullId });

  // Connect the stdio transport — exactly once
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.info('DevDigest MCP server ready — waiting on stdio');
}

main().catch((err: unknown) => {
  log.error('Fatal error during MCP server startup', err);
  process.exit(1);
});
