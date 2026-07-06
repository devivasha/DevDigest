/**
 * tools/get-blast-radius.ts — devdigest_get_blast_radius (STUB).
 *
 * Intentionally NOT implemented yet. It makes no HTTP call and NEVER throws —
 * it returns a well-formed, non-error `{ status: "not_implemented" }` so the
 * calling agent treats it as a known limitation and continues, rather than a
 * failure. Kept in the toolset so future workflows don't break when it lands.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toolOk } from "../format.js";

const DESCRIPTION =
  "STUB — not yet implemented. Intended to map which files and symbols a PR's changes affect. Returns a placeholder, not real data. Do not rely on its output and do not block your report on it — note the limitation and continue.";

export function registerGetBlastRadius(server: McpServer): void {
  server.registerTool(
    "devdigest_get_blast_radius",
    {
      title: "Get PR blast radius (stub)",
      description: DESCRIPTION,
      inputSchema: {
        repo: z.string().optional().describe("(Accepted but ignored — stub.) Repository as 'owner/name'."),
        pr: z.number().int().optional().describe("(Accepted but ignored — stub.) Pull request number."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () =>
      toolOk({
        status: "not_implemented",
        message: "Blast radius not yet available — proceed without it, note the limitation.",
      }),
  );
}
