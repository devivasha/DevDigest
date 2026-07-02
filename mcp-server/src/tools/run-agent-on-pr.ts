/**
 * devdigest_run_agent_on_pr — thin presentation layer.
 *
 * Resolves (repo, pr) → pullId, validates the agent arg, delegates the full
 * trigger-poll-shape loop to runReviewAndWait (application layer), then maps
 * the discriminated-union result to an MCP tool response.
 *
 * No polling logic lives in this file — all orchestration is in core/run-review.ts.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DevDigestClient } from '../http/client.js';
import { ApiError } from '../http/client.js';
import { toolOk, toolError } from '../format.js';
import { config } from '../config.js';
import type { resolvePullId as ResolvePullIdFn } from '../core/resolve.js';
import type {
  runReviewAndWait as RunReviewAndWaitFn,
  RunReviewResult,
} from '../core/run-review.js';
import type {
  pickReview as PickReviewFn,
  shapeFindings as ShapeFindingsFn,
} from '../core/findings.js';

// ---------------------------------------------------------------------------
// Deps type
// ---------------------------------------------------------------------------

export type RunAgentOnPrDeps = {
  resolvePullId: typeof ResolvePullIdFn;
  runReviewAndWait: typeof RunReviewAndWaitFn;
  pickReview: typeof PickReviewFn;
  shapeFindings: typeof ShapeFindingsFn;
};

// ---------------------------------------------------------------------------
// Input schema — flat args, all .describe()'d verbatim from plan
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
    .describe('Pull request number (e.g. 42), not an internal id.'),
  agent: z
    .string()
    .describe('Agent id from devdigest_list_agents. Do not guess — list agents first.'),
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerRunAgentOnPr(
  server: McpServer,
  client: DevDigestClient,
  deps: RunAgentOnPrDeps,
): void {
  server.registerTool(
    'devdigest_run_agent_on_pr',
    {
      description:
        "Run one reviewer agent on a pull request and return the result. This is a single call that triggers the review, waits for it to finish, and returns the verdict and findings — you do not need to poll. Requires a valid 'agent' id from devdigest_list_agents — do not guess it. If the review takes longer than ~2 min it returns {status:'running', run_id, repo, pr}; call devdigest_get_findings with the same repo and pr later.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const { repo, pr, agent } = args;

      try {
        // (a) Resolve (repo, pr) → pullId
        const resolved = await deps.resolvePullId(client, repo, pr);
        if ('error' in resolved) {
          return toolError(resolved.error);
        }
        const { pullId } = resolved;

        // (b) Validate agent against the live agent list
        let agents;
        try {
          agents = await client.listAgents();
        } catch (err) {
          const url = err instanceof ApiError ? err.url : config.apiUrl;
          return toolError(
            `DevDigest API unreachable at ${url} — start it with ./scripts/dev.sh.`,
          );
        }

        // Match by id first, then case-insensitive name
        let agentId: string | undefined;
        const exactById = agents.find((a) => a.id === agent);
        if (exactById) {
          agentId = exactById.id;
        } else {
          const needle = agent.toLowerCase();
          const byName = agents.find((a) => a.name.toLowerCase() === needle);
          if (byName) {
            agentId = byName.id;
          }
        }

        if (agentId === undefined) {
          const available = agents
            .map((a) => `${a.id} (${a.name})`)
            .join(', ');
          return toolError(
            `Agent '${agent}' not found. Call devdigest_list_agents to get valid agent ids. Available: ${available}.`,
          );
        }

        // (c) Trigger + poll + shape — all orchestration inside runReviewAndWait
        const result: RunReviewResult = await deps.runReviewAndWait(
          client,
          { pullId, agentId },
          {
            pollIntervalMs: config.pollIntervalMs,
            runTimeoutMs: config.runTimeoutMs,
          },
          {
            pickReview: deps.pickReview,
            shapeFindings: deps.shapeFindings,
          },
        );

        // (d) Map discriminated union → MCP tool result
        if (result.kind === 'done') {
          return toolOk({
            verdict: result.verdict,
            score: result.score,
            counts: result.counts,
            findings: result.findings,
          });
        }

        if (result.kind === 'running') {
          return toolOk({
            status: 'running',
            run_id: result.run_id,
            repo,
            pr,
            message:
              'Review still running — call devdigest_get_findings with the same repo and pr later.',
          });
        }

        // kind === 'failed'
        return toolError(`Review run failed: ${result.error}`);
      } catch (err) {
        const url = err instanceof ApiError ? err.url : config.apiUrl;
        return toolError(
          `DevDigest API unreachable at ${url} — start it with ./scripts/dev.sh.`,
        );
      }
    },
  );
}
