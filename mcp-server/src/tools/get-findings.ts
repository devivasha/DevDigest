/**
 * devdigest_get_findings — fetch the verdict and findings of a completed review.
 *
 * Locates the PR via repo + pr (required); run_id is an optional disambiguator
 * used to select a specific run from the list (no run→pull endpoint exists).
 * Pagination and response_format control output size.
 *
 * Layer: presentation/transport. Thin — Zod-validate → resolve → list → pick
 * → shape → format. All multi-step logic lives in core/{resolve,findings}.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DevDigestClient } from '../http/client.js';
import type { resolvePullId } from '../core/resolve.js';
import type { pickReview, shapeFindings } from '../core/findings.js';
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
  run_id: z
    .string()
    .optional()
    .describe(
      'Optional: select a specific run (e.g. the run_id returned by devdigest_run_agent_on_pr); omit to get the latest review.',
    ),
  response_format: z
    .enum(['concise', 'detailed'])
    .default('concise')
    .describe(
      "'concise' (default): severity, title, file:line, rationale. 'detailed': also suggestion, confidence, ids, line range.",
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Pagination offset over findings (default 0).'),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      'Max findings to return (default 10 concise / 20 detailed); keeps the response small.',
    ),
};

// ---------------------------------------------------------------------------
// Deps type — injected from index.ts (enables testing without HTTP)
// ---------------------------------------------------------------------------

export type GetFindingsDeps = {
  resolvePullId: typeof resolvePullId;
  pickReview: typeof pickReview;
  shapeFindings: typeof shapeFindings;
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerGetFindings(
  server: McpServer,
  client: DevDigestClient,
  deps: GetFindingsDeps,
): void {
  server.registerTool(
    'devdigest_get_findings',
    {
      description:
        "Get the verdict and findings of a completed review for a pull request. Identify the PR with repo + pr; optionally pass run_id to select a specific run (otherwise the latest review is returned). Defaults to a concise summary (top findings + counts by severity); pass response_format:'detailed' for full fields, and use offset/limit to page through large result sets.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      const { repo, pr, run_id, response_format, offset, limit } = args;

      // Compute format-dependent default limit
      const effectiveLimit = limit ?? (response_format === 'detailed' ? 20 : 10);

      try {
        // Step 1: resolve (repo, pr#) → { repoId, pullId }
        const resolved = await deps.resolvePullId(client, repo, pr);
        if ('error' in resolved) {
          return toolError(resolved.error);
        }
        const { pullId } = resolved;

        // Step 2: list completed reviews for this pull
        const reviews = await client.listReviews(pullId);

        // Step 3: select the right review (by run_id or latest)
        const review = deps.pickReview(reviews, { runId: run_id });
        if (review === undefined) {
          return toolError(
            'No completed review yet — run devdigest_run_agent_on_pr first or wait for it to finish.',
          );
        }

        // Step 4: shape and paginate findings
        const result = deps.shapeFindings(review, {
          format: response_format,
          offset,
          limit: effectiveLimit,
        });

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
