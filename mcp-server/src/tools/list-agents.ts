/**
 * devdigest_list_agents — lists all reviewer agents configured in DevDigest.
 *
 * No input schema (empty object). Returns { agents: [{ id, name, enabled, model }] }.
 * An empty list is a valid result, not an error.
 * HTTP/network failure returns toolError with guidance to start the API.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DevDigestClient } from '../http/client.js';
import { ApiError } from '../http/client.js';
import { toolOk, toolError } from '../format.js';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Input schema — no fields (empty object)
// ---------------------------------------------------------------------------

const inputSchema: Record<string, z.ZodTypeAny> = {};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerListAgents(server: McpServer, client: DevDigestClient): void {
  server.registerTool(
    'devdigest_list_agents',
    {
      description:
        "List the reviewer agents configured in DevDigest (id, name, model, enabled). Call this first to get a valid 'agent' id for devdigest_run_agent_on_pr — do not guess or invent agent ids.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (_args) => {
      try {
        const agents = await client.listAgents();
        return toolOk({
          agents: agents.map((a) => ({
            id: a.id,
            name: a.name,
            enabled: a.enabled,
            model: a.model,
          })),
        });
      } catch (err) {
        const url = err instanceof ApiError ? err.url : config.apiUrl;
        return toolError(
          `DevDigest API unreachable at ${url} — start it with ./scripts/dev.sh.`,
        );
      }
    },
  );
}
