/**
 * tools/get-findings.ts — devdigest_get_findings (thin presentation).
 *
 * Locates the PR via repo+pr (there is NO run→pull endpoint), reads its reviews,
 * picks the relevant one (run_id or newest), and shapes the findings. Selection
 * + shaping live in core/findings.ts — this handler only wires the steps.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DevDigestClient } from "../http/client.js";
import { ApiError } from "../http/client.js";
import type { resolvePullId as ResolvePullId } from "../core/resolve.js";
import type { pickReview as PickReview, shapeFindings as ShapeFindings } from "../core/findings.js";
import { toolError, toolOk } from "../format.js";
import { config } from "../config.js";

const DESCRIPTION =
  "Get the verdict and findings of a completed review for a pull request. Identify the PR with repo + pr; optionally pass run_id to select a specific run (otherwise the latest review is returned). Defaults to a concise summary (top findings + counts by severity); pass response_format:'detailed' for full fields, and use offset/limit to page through large result sets.";

interface Deps {
  resolvePullId: typeof ResolvePullId;
  pickReview: typeof PickReview;
  shapeFindings: typeof ShapeFindings;
}

export function registerGetFindings(
  server: McpServer,
  client: DevDigestClient,
  deps: Deps,
): void {
  server.registerTool(
    "devdigest_get_findings",
    {
      title: "Get review findings",
      description: DESCRIPTION,
      inputSchema: {
        repo: z
          .string()
          .describe("Repository as 'owner/name' (e.g. 'octocat/hello'), or just the name if unambiguous."),
        pr: z.number().int().describe("Pull request number (e.g. 42)."),
        run_id: z
          .string()
          .optional()
          .describe(
            "Optional: select a specific run (e.g. the run_id returned by devdigest_run_agent_on_pr); omit to get the latest review.",
          ),
        response_format: z
          .enum(["concise", "detailed"])
          .default("concise")
          .describe(
            "'concise' (default): severity, title, file:line, rationale. 'detailed': also suggestion, confidence, ids, line range.",
          ),
        offset: z.number().int().min(0).default(0).describe("Pagination offset over findings (default 0)."),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "Max findings to return (default 10 concise / 20 detailed); keeps the response small.",
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ repo, pr, run_id, response_format, offset, limit }) => {
      try {
        const resolved = await deps.resolvePullId(client, repo, pr);
        if (resolved.error !== undefined) return toolError(resolved.error);

        const reviews = await client.listReviews(resolved.pullId!);
        const review = deps.pickReview(reviews, run_id ? { runId: run_id } : {});
        if (!review) {
          return toolError(
            "No completed review yet — run devdigest_run_agent_on_pr first, or wait and call devdigest_get_findings with the same repo and pr.",
          );
        }

        const effectiveLimit = limit ?? (response_format === "detailed" ? 20 : 10);
        const shaped = deps.shapeFindings(review, {
          format: response_format,
          offset,
          limit: effectiveLimit,
        });
        return toolOk(shaped);
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
