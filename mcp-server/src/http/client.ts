/**
 * http/client.ts — the ONLY place in this package that performs `fetch`.
 *
 * A thin, typed HTTP client over the DevDigest API (default http://localhost:3001).
 * It sends NO auth and NO workspace headers — `LocalNoAuthProvider` resolves the
 * default workspace server-side. Return signatures reuse the `@devdigest/shared`
 * Zod-inferred types read-only; we never redefine those shapes here.
 *
 * Endpoints return the documented shapes WITHOUT an envelope: `GET /agents`
 * returns the bare `Agent[]`, not `{ data: Agent[] }`. `POST /pulls/:id/review`
 * returns `{ pr_id, runs, reviews }`.
 */

import type {
  Agent,
  Repo,
  PrMeta,
  RunSummary,
  ReviewRecord,
  ReviewRunResponse,
  RunTrace,
  ConventionCandidate,
} from "@devdigest/shared";
import type { Config } from "../config.js";

/**
 * A transport/HTTP-level failure (network error or non-2xx response). Distinct
 * from a *successful empty result* (e.g. `[]`), which is NOT an error. Tools
 * catch this and convert it into a forward-leading `isError` tool result.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface DevDigestClient {
  listAgents(): Promise<Agent[]>;
  listRepos(): Promise<Repo[]>;
  listPulls(repoId: string): Promise<PrMeta[]>;
  triggerReview(pullId: string, agentId: string): Promise<ReviewRunResponse>;
  listRuns(pullId: string): Promise<RunSummary[]>;
  listReviews(pullId: string): Promise<ReviewRecord[]>;
  getTrace(runId: string): Promise<RunTrace>;
  listConventions(repoId: string): Promise<ConventionCandidate[]>;
}

export function createClient(config: Config): DevDigestClient {
  const base = config.apiUrl;

  async function request<T>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<T> {
    const url = `${base}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: init?.method ?? "GET",
        headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
    } catch (cause) {
      // Network-level failure — the API is very likely not running.
      throw new ApiError(
        `DevDigest API unreachable at ${base} (${String((cause as Error)?.message ?? cause)})`,
        url,
      );
    }

    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 300);
      } catch {
        /* body already consumed / not readable — ignore */
      }
      throw new ApiError(
        `${init?.method ?? "GET"} ${path} → ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`,
        url,
        res.status,
      );
    }

    // 204/empty body → no JSON to parse.
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    listAgents: () => request<Agent[]>("/agents"),
    listRepos: () => request<Repo[]>("/repos"),
    listPulls: (repoId) => request<PrMeta[]>(`/repos/${repoId}/pulls`),
    triggerReview: (pullId, agentId) =>
      request<ReviewRunResponse>(`/pulls/${pullId}/review`, {
        method: "POST",
        body: { agentId },
      }),
    listRuns: (pullId) => request<RunSummary[]>(`/pulls/${pullId}/runs`),
    listReviews: (pullId) => request<ReviewRecord[]>(`/pulls/${pullId}/reviews`),
    getTrace: (runId) => request<RunTrace>(`/runs/${runId}/trace`),
    listConventions: (repoId) => request<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
  };
}
