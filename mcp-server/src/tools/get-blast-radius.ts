/**
 * devdigest_get_blast_radius — map which symbols a PR changes and who calls them.
 *
 * Identify the PR via repo + pr (required). Resolves to the internal pullId,
 * then calls GET /pulls/:id/blast. Returns the changed symbols, their callers,
 * impacted HTTP endpoints, prior PRs touching the same files, and an optional
 * one-line LLM summary.
 *
 * Layer: presentation/transport. Thin — Zod-validate → resolve → fetch →
 * format. Resolution logic lives in core/resolve.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DevDigestClient } from '../http/client.js';
import type { resolvePullId } from '../core/resolve.js';
import { toolOk, toolError } from '../format.js';

// ---------------------------------------------------------------------------
// Input schema — raw Zod shape (not z.object())
// ---------------------------------------------------------------------------

const inputSchema = {
  repo: z
    .string()
    .describe(
      "Repository as 'owner/name' (e.g. 'octocat/hello'), or just the name if unambiguous.",
    ),
  pr: z
    .number()
    .int()
    .describe('Pull request number (e.g. 42).'),
};

// ---------------------------------------------------------------------------
// Deps type — injected from index.ts (enables testing without HTTP)
// ---------------------------------------------------------------------------

export type GetBlastRadiusDeps = {
  resolvePullId: typeof resolvePullId;
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerGetBlastRadius(
  server: McpServer,
  client: DevDigestClient,
  deps: GetBlastRadiusDeps,
): void {
  server.registerTool(
    'devdigest_get_blast_radius',
    {
      description:
        "Map a PR's blast radius: which symbols it changes, who calls them, which HTTP endpoints are impacted, and prior PRs touching the same files. Identify the PR with repo + pr. Returns degraded:true with a reason when the repo index is unavailable — treat that as a known limitation, not a failure.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      const { repo, pr } = args;

      try {
        // Step 1: resolve (repo, pr#) → { pullId }
        const resolved = await deps.resolvePullId(client, repo, pr);
        if ('error' in resolved) {
          return toolError(resolved.error);
        }

        // Step 2: fetch the blast radius for this pull
        const result = await client.getBlastRadius(resolved.pullId);

        return toolOk(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return toolError(
          `DevDigest API error: ${message}. Ensure the API is running at http://localhost:3001 (run ./scripts/dev.sh).`,
        );
      }
    },
  );
}
