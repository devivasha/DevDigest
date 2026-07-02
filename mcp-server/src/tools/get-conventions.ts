/**
 * devdigest_get_conventions — read-only tool.
 *
 * Resolves the repo arg to an internal repoId, fetches conventions from the
 * DevDigest API, and returns a concise list of { rule, file, confidence,
 * accepted } rows.  Empty conventions list is NOT an error.
 *
 * Layer: presentation/transport.  All I/O via `client` (infrastructure); all
 * name resolution via the injected `resolveRepoId` helper (application layer).
 * No business logic here — thin handler only.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DevDigestClient } from '../http/client.js';
import type { resolveRepoId as ResolveRepoIdFn } from '../core/resolve.js';
import { toolOk, toolError, compactConvention } from '../format.js';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const inputSchema = {
  repo: z
    .string()
    .describe("Repository as 'owner/name', or just the name if unambiguous."),
};

// ---------------------------------------------------------------------------
// Deps injection shape
// ---------------------------------------------------------------------------

export type GetConventionsDeps = {
  resolveRepoId: typeof ResolveRepoIdFn;
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerGetConventions(
  server: McpServer,
  client: DevDigestClient,
  deps: GetConventionsDeps,
): void {
  server.registerTool(
    'devdigest_get_conventions',
    {
      description:
        'Get the coding conventions extracted for a repository (rule, file, confidence, accepted). Use this to justify or check a finding against the repository\'s house rules.',
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ repo }) => {
      // 1. Resolve repo name → repoId
      const resolved = await deps.resolveRepoId(client, repo);
      if ('error' in resolved) {
        return toolError(resolved.error);
      }

      const { repoId } = resolved;

      // 2. Fetch conventions — wrap I/O; forward API-down guidance on failure
      let conventions;
      try {
        conventions = await client.listConventions(repoId);
      } catch (cause) {
        return toolError(
          `DevDigest API unreachable while fetching conventions for '${repo}' — start it with ./scripts/dev.sh. (${String(cause)})`,
        );
      }

      // 3. Return concise shape — empty list is NOT an error
      return toolOk({
        repo,
        conventions: conventions.map(compactConvention),
      });
    },
  );
}
