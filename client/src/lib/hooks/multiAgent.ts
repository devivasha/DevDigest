/* hooks/multiAgent.ts — React Query hooks for the Multi-Agent Review feature
   (launch, read, estimate). Mirrors hooks/reviews.ts: thin wrappers over
   `api.get/post`, inline literal query keys (no centralised key registry),
   all data fetching lives here — never in a component body. */
"use client";

import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  MultiAgentEstimate,
  MultiAgentRun,
  MultiAgentRunLaunchBody,
  MultiAgentRunLaunchResult,
} from "@devdigest/shared";

/** Debounce window for the live per-selection cost/time estimate — avoids a
   request per checkbox toggle while the maintainer is still picking agents. */
const ESTIMATE_DEBOUNCE_MS = 300;

// ---- Launch a multi-agent run (fan out to N agents, get back one run id) ----
export interface LaunchMultiAgentRunInput {
  prId: string;
  agentIds: string[];
}

export function useLaunchMultiAgentRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agentIds }: LaunchMultiAgentRunInput) =>
      api.post<MultiAgentRunLaunchResult>(`/pulls/${prId}/multi-agent-run`, {
        agent_ids: agentIds,
      } satisfies MultiAgentRunLaunchBody),
    onSuccess: (_data, { prId }) => {
      qc.invalidateQueries({ queryKey: ["multi-agent-latest", prId] });
    },
  });
}

// ---- Read one multi-agent run by id (results page, reload-safe) ----
export function useMultiAgentRun(id: string | null | undefined) {
  return useQuery({
    queryKey: ["multi-agent-run", id],
    queryFn: () => api.get<MultiAgentRun>(`/multi-agent-runs/${id}`),
    enabled: !!id,
  });
}

// ---- Read the latest multi-agent run for a PR ----
export function useLatestMultiAgentRun(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["multi-agent-latest", prId],
    queryFn: () => api.get<MultiAgentRun>(`/pulls/${prId}/multi-agent`),
    enabled: !!prId,
  });
}

/** Pre-run time/cost estimate for a PR + candidate agent selection. Debounced
   against rapid selection changes and disabled until at least one agent is
   picked (AC-6/AC-7). Always approximate, never blocks the run (AC-9). */
export function useMultiAgentEstimate(
  prId: string | null | undefined,
  agentIds: string[],
) {
  const key = agentIds.join(",");
  const [debouncedKey, setDebouncedKey] = React.useState(key);

  React.useEffect(() => {
    const handle = setTimeout(() => setDebouncedKey(key), ESTIMATE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const debouncedIds = debouncedKey ? debouncedKey.split(",") : [];

  return useQuery({
    queryKey: ["multi-agent-estimate", prId, debouncedKey],
    queryFn: () =>
      api.get<MultiAgentEstimate>(
        `/pulls/${prId}/multi-agent/estimate?agent_ids=${encodeURIComponent(debouncedKey)}`,
      ),
    enabled: !!prId && debouncedIds.length > 0,
  });
}
