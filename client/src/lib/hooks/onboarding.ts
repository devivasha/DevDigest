"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { OnboardingTour } from "@devdigest/shared";

export function useOnboardingTour(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["onboarding-tour", repoId],
    queryFn: () => api.get<OnboardingTour>(`/repos/${repoId}/onboarding`),
    enabled: !!repoId,
  });
}

export function useRegenerateTour(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<OnboardingTour>(`/repos/${repoId}/onboarding/generate`),
    onSuccess: (data) => {
      qc.setQueryData(["onboarding-tour", repoId], data);
    },
  });
}
