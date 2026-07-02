/* hooks/pulls.ts — React Query hooks for pull requests. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { PrMeta, PrDetail } from "../types";
import type { BlastRadiusResult } from "@devdigest/shared";

export function usePulls(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["pulls", repoId],
    queryFn: () => api.get<PrMeta[]>(`/repos/${repoId}/pulls`),
    enabled: !!repoId,
    // Auto-refresh PR statuses: re-sync from GitHub every 60s while the page is
    // open, and whenever the window regains focus.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function usePullDetail(prId: string | number | null | undefined) {
  return useQuery({
    queryKey: ["pull", prId],
    queryFn: () => api.get<PrDetail>(`/pulls/${prId}`),
    enabled: prId != null,
  });
}

export function useBlastRadius(prId: string | null | undefined) {
  return useQuery<BlastRadiusResult>({
    queryKey: ["blast-radius", prId],
    queryFn: () => api.get<BlastRadiusResult>(`/pulls/${prId}/blast`),
    enabled: prId != null,
    staleTime: 5 * 60 * 1000,
    retry: (count, err: unknown) =>
      (err as { status?: number })?.status === 404 ? false : count < 2,
  });
}
