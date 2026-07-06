/**
 * tools/get-conventions.ts — devdigest_get_conventions (thin presentation).
 *
 * Resolves repo name → repoId (route requires a uuid) then returns the concise
 * convention rows. Empty conventions is a valid result.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DevDigestClient } from "../http/client.js";
import { ApiError } from "../http/client.js";
import type { resolveRepoId as ResolveRepoId } from "../core/resolve.js";
import { compactConvention, toolError, toolOk } from "../format.js";
import { config } from "../config.js";

const DESCRIPTION =
  "Get the coding conventions extracted for a repository (rule, file, confidence, accepted). Use this to justify or check a finding against the repository's house rules.";

interface Deps {
  resolveRepoId: typeof ResolveRepoId;
}

export function registerGetConventions(
  server: McpServer,
  client: DevDigestClient,
  deps: Deps,
): void {
  server.registerTool(
    "devdigest_get_conventions",
    {
      title: "Get repository conventions",
      description: DESCRIPTION,
      inputSchema: {
        repo: z
          .string()
          .optional()
          .describe(
            "Required. Repository as 'owner/name', or just the name if unambiguous. If you don't know it, call devdigest_list_agents/inspect the repo first — this tool cannot guess it.",
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ repo }) => {
      try {
        // `repo` is optional at the protocol layer so a missing arg surfaces as a
        // forward-leading tool result (which the caller can recover from) rather
        // than an opaque -32602 validation error. Business-validate it here.
        if (repo === undefined || repo.trim() === "") {
          const repos = await client.listRepos();
          const available = repos.map((r) => r.full_name).join(", ") || "(none)";
          return toolError(
            `Missing required 'repo'. Call again with one of: ${available}. Pass owner/name if the bare name is ambiguous.`,
          );
        }

        const resolved = await deps.resolveRepoId(client, repo);
        if (resolved.error !== undefined) return toolError(resolved.error);

        const conventions = await client.listConventions(resolved.repoId!);
        return toolOk({ repo, conventions: conventions.map(compactConvention) });
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
