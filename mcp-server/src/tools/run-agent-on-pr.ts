/**
 * tools/run-agent-on-pr.ts — devdigest_run_agent_on_pr (thin presentation).
 *
 * "Result, not operation": one call triggers the review, waits, and returns the
 * verdict + findings. The trigger/poll/assemble loop lives in core/run-review.ts;
 * this handler only resolves args + agent and maps the result to an MCP reply.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DevDigestClient } from "../http/client.js";
import { ApiError } from "../http/client.js";
import type { resolvePullId as ResolvePullId } from "../core/resolve.js";
import type { pickReview as PickReview, shapeFindings as ShapeFindings } from "../core/findings.js";
import type { runReviewAndWait as RunReviewAndWait } from "../core/run-review.js";
import { toolError, toolOk } from "../format.js";
import { config } from "../config.js";

const DESCRIPTION =
  "Run one reviewer agent on a pull request and return the result. This is a single call that triggers the review, waits for it to finish, and returns the verdict and findings — you do not need to poll. Requires a valid 'agent' id from devdigest_list_agents — do not guess it. If the review takes longer than ~2 min it returns {status:'running', run_id, repo, pr}; the review continues server-side — call devdigest_get_findings with the same repo and pr later to fetch the result.";

interface Deps {
  resolvePullId: typeof ResolvePullId;
  runReviewAndWait: typeof RunReviewAndWait;
  pickReview: typeof PickReview;
  shapeFindings: typeof ShapeFindings;
}

export function registerRunAgentOnPr(
  server: McpServer,
  client: DevDigestClient,
  deps: Deps,
): void {
  server.registerTool(
    "devdigest_run_agent_on_pr",
    {
      title: "Run a reviewer agent on a PR",
      description: DESCRIPTION,
      inputSchema: {
        repo: z
          .string()
          .describe("Repository as 'owner/name' (e.g. 'octocat/hello'), or just the name if unambiguous."),
        pr: z.number().int().describe("Pull request number (e.g. 42), not an internal id."),
        agent: z.string().describe("Agent id from devdigest_list_agents. Do not guess — list agents first."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ repo, pr, agent }, extra) => {
      try {
        // (a) resolve (repo, pr) → pullId
        const resolved = await deps.resolvePullId(client, repo, pr);
        if (resolved.error !== undefined) return toolError(resolved.error);

        // ...and resolve the agent: by id first, then case-insensitive name.
        const agents = await client.listAgents();
        const needle = agent.trim().toLowerCase();
        const match =
          agents.find((a) => a.id === agent) ??
          agents.find((a) => a.name.toLowerCase() === needle);
        if (!match) {
          const valid = agents.map((a) => `${a.name} (${a.id})`).join(", ") || "(none)";
          return toolError(
            `Agent '${agent}' not found. Call devdigest_list_agents to get valid agent ids. Available: ${valid}.`,
          );
        }

        // (b) block on the run, polling until it finishes or the inline wait
        // budget (~120s) elapses. The client is kept from cutting the blocking
        // request early by MCP_TOOL_TIMEOUT in .mcp.json (set > runTimeoutMs).
        const result = await deps.runReviewAndWait(
          client,
          { pullId: resolved.pullId!, agentId: match.id },
          {
            pollIntervalMs: config.pollIntervalMs,
            runTimeoutMs: config.runTimeoutMs,
            signal: extra.signal,
          },
          { pickReview: deps.pickReview, shapeFindings: deps.shapeFindings },
        );

        // (c) map result → MCP reply
        if (result.kind === "done") {
          return toolOk({
            verdict: result.verdict,
            score: result.score,
            counts: result.counts,
            findings: result.findings,
          });
        }
        if (result.kind === "running") {
          return toolOk({
            status: "running",
            run_id: result.run_id,
            repo,
            pr,
            message:
              "Review still running — call devdigest_get_findings with the same repo and pr later.",
          });
        }
        return toolError(
          `Review failed: ${result.error} Check the agent config and try again, or run a different agent.`,
        );
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
