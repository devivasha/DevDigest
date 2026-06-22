/* hooks/conventions.ts — React Query hooks for the Conventions extractor. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ConventionCandidate } from "@devdigest/shared";

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

export function useScanConventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      api.post<ConventionCandidate[]>(`/repos/${repoId}/conventions/scan`),
    onSuccess: (_data, repoId) =>
      qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

export function useAcceptConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, accepted }: { id: string; repoId: string; accepted: boolean }) =>
      api.post<ConventionCandidate>(`/conventions/${id}/${accepted ? "accept" : "reject"}`),
    onSuccess: (_data, { repoId }) =>
      qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

export function useUpdateConventionRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rule }: { id: string; repoId: string; rule: string }) =>
      api.patch<ConventionCandidate>(`/conventions/${id}/rule`, { rule }),
    onSuccess: (_data, { repoId }) =>
      qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

export function useBuildConventionSkill(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions-skill-body", repoId],
    queryFn: () => api.get<{ body: string }>(`/repos/${repoId}/conventions/skill`),
    enabled: false, // only fetched on demand via refetch()
  });
}
