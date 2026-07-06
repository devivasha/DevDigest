/**
 * tools/list-agents.ts — devdigest_list_agents (thin presentation).
 *
 * Lists the configured reviewer agents. Empty list is a valid result (NOT an
 * error); only transport failures become `isError`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DevDigestClient } from "../http/client.js";
import { ApiError } from "../http/client.js";
import { compactAgent, toolError, toolOk } from "../format.js";
import { config } from "../config.js";

const DESCRIPTION =
  "List the reviewer agents configured in DevDigest (id, name, model, enabled). Call this first to get a valid 'agent' id for devdigest_run_agent_on_pr — do not guess or invent agent ids.";

export function registerListAgents(server: McpServer, client: DevDigestClient): void {
  server.registerTool(
    "devdigest_list_agents",
    {
      title: "List reviewer agents",
      description: DESCRIPTION,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const agents = await client.listAgents();
        return toolOk({ agents: agents.map(compactAgent) });
      } catch (err) {
        if (err instanceof ApiError) {
          return toolError(
            `DevDigest API unreachable at ${config.apiUrl} — start it with ./scripts/dev.sh. (${err.message})`,
          );
        }
        throw err;
      }
    },
  );
}
