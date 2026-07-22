import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MultiAgentEstimate, MultiAgentRun, MultiAgentRunLaunchResult } from "@devdigest/shared";
import { api } from "../api";
import {
  useLaunchMultiAgentRun,
  useMultiAgentEstimate,
  useMultiAgentRun,
  useLatestMultiAgentRun,
} from "./multiAgent";

vi.mock("../api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

// Kept JSX-free so this file can stay a `.test.ts` (not `.tsx`) — the vitest
// esbuild loader for `.ts` files does not parse JSX syntax.
function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("hooks/multiAgent", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it("launches a multi-agent run via POST /pulls/:id/multi-agent-run with agent_ids", async () => {
    const result: MultiAgentRunLaunchResult = {
      id: "run-1",
      pr_id: "pr-1",
      runs: [],
    };
    vi.mocked(api.post).mockResolvedValueOnce(result);

    const { result: hookResult } = renderHook(() => useLaunchMultiAgentRun(), { wrapper });

    hookResult.current.mutate({ prId: "pr-1", agentIds: ["ag-1", "ag-2"] });

    await waitFor(() => expect(hookResult.current.isSuccess).toBe(true));

    expect(api.post).toHaveBeenCalledWith("/pulls/pr-1/multi-agent-run", {
      agent_ids: ["ag-1", "ag-2"],
    });
    expect(hookResult.current.data).toEqual(result);
  });

  it("reads a multi-agent run by id and stays disabled without one", async () => {
    const run: MultiAgentRun = {
      id: "run-1",
      pr_id: "pr-1",
      pr_number: 42,
      ran_at: "2026-07-14T00:00:00.000Z",
      agent_count: 1,
      total_duration_ms: 1000,
      total_cost_usd: 0.01,
      columns: [],
      conflicts: [],
    };
    vi.mocked(api.get).mockResolvedValueOnce(run);

    const { result: disabled } = renderHook(() => useMultiAgentRun(null), { wrapper });
    expect(disabled.current.fetchStatus).toBe("idle");
    expect(api.get).not.toHaveBeenCalled();

    const { result: enabled } = renderHook(() => useMultiAgentRun("run-1"), { wrapper });
    await waitFor(() => expect(enabled.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/multi-agent-runs/run-1");
    expect(enabled.current.data).toEqual(run);
  });

  it("reads the latest multi-agent run for a PR", async () => {
    const run: MultiAgentRun = {
      id: "run-2",
      pr_id: "pr-1",
      pr_number: null,
      ran_at: "2026-07-14T00:00:00.000Z",
      agent_count: 2,
      total_duration_ms: 2000,
      total_cost_usd: null,
      columns: [],
      conflicts: [],
    };
    vi.mocked(api.get).mockResolvedValueOnce(run);

    const { result } = renderHook(() => useLatestMultiAgentRun("pr-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.get).toHaveBeenCalledWith("/pulls/pr-1/multi-agent");
    expect(result.current.data).toEqual(run);
  });

  it("estimate query is disabled with zero agents and debounces the fetch once >=1 is selected", async () => {
    const estimate: MultiAgentEstimate = {
      agents: [{ agent_id: "ag-1", est_duration_ms: 5000, est_cost_usd: 0.02 }],
      summary: { est_duration_ms: 5000, est_cost_usd: 0.02, agent_count: 1 },
    };
    vi.mocked(api.get).mockResolvedValueOnce(estimate);

    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useMultiAgentEstimate("pr-1", ids),
      { wrapper, initialProps: { ids: [] as string[] } },
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(api.get).not.toHaveBeenCalled();

    // Selecting an agent re-renders the hook with a non-empty id list; the
    // fetch must not fire immediately on toggle — only after the debounce
    // window elapses (real timers: RTL's waitFor polls with real setTimeout,
    // which does not play well with vi.useFakeTimers here).
    rerender({ ids: ["ag-1"] });
    expect(api.get).not.toHaveBeenCalled();

    await waitFor(
      () =>
        expect(api.get).toHaveBeenCalledWith(
          "/pulls/pr-1/multi-agent/estimate?agent_ids=ag-1",
        ),
      { timeout: 2000 },
    );
    expect(result.current.data).toEqual(estimate);
  });
});
