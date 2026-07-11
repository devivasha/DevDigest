/* hooks/brief.ts — React Query hooks for the Why+Risk Brief (narrative, single LLM call). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { BriefRecord } from "@devdigest/shared";

/** Fetch the Brief for a PR (lazily computed server-side on first access). */
export function useBrief(prId: string | null) {
  return useQuery({
    queryKey: ["brief", prId],
    queryFn: () => api.get<BriefRecord>(`/pulls/${prId}/brief`),
    enabled: prId != null,
  });
}

/** Trigger a fresh Brief generation for a PR and update the cache on success. */
export function useRegenerateBrief(prId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<BriefRecord>(`/pulls/${prId}/brief/regenerate`),
    onSuccess: (data) => qc.setQueryData(["brief", prId], data),
  });
}
