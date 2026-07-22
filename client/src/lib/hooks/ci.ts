/* hooks/ci.ts — React Query hooks for Export-to-CI (L06). Mirrors hooks/eval.ts:
   thin wrappers over `api.get/post`, inline literal query keys. No raw `fetch`. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { CiExport, CiExportInputBody, CiFile, CiInstallation, CiRun } from "@/vendor/shared/contracts/eval-ci";

// ---- All CI runs across every agent/installation (workspace-wide) ----
export function useCiRuns() {
  return useQuery({
    queryKey: ["ci-runs"],
    queryFn: () => api.get<CiRun[]>("/ci/runs"),
  });
}

// ---- CI installations for one agent (which repos this agent is wired into) ----
export function useAgentInstallations(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["ci-installations", agentId],
    queryFn: () => api.get<CiInstallation[]>(`/agents/${agentId}/ci/installations`),
    enabled: !!agentId,
  });
}

// ---- CI runs scoped to one agent ----
export function useAgentCiRuns(agentId: string | null | undefined) {
  return useQuery({
    // Shares the "ci-runs" prefix with `useCiRuns` so a single
    // `invalidateQueries({ queryKey: ["ci-runs"] })` refreshes both the
    // workspace-wide list and every per-agent list.
    queryKey: ["ci-runs", agentId],
    queryFn: () => api.get<CiRun[]>(`/agents/${agentId}/ci/runs`),
    enabled: !!agentId,
  });
}

/** Side-effect-free preview of the REAL export bundle (AC-4/AC-7) — POSTs the
 *  wizard's current form state to `/agents/:id/ci/preview` and returns the exact
 *  `CiFile[]` bytes `export()` would commit/zip (no persistence, no secret, no
 *  GitHub call server-side, so this is safe to call any time the Preview step is
 *  shown). `queryKey` is keyed on the fields that actually affect the generated
 *  bundle (target/triggers/post_as/repo/base, via `input`) so the query only
 *  refetches when one of those changes — callers gate `enabled` themselves
 *  (e.g. only once the wizard is on/past the Preview step) to avoid firing on
 *  every keystroke while the user is still typing the repo on the Target step. */
export function usePreviewCi(agentId: string | null | undefined, input: CiExportInputBody, enabled: boolean) {
  return useQuery({
    queryKey: ["ci-preview", agentId, input],
    queryFn: () => api.post<CiFile[]>(`/agents/${agentId}/ci/preview`, input),
    enabled: enabled && !!agentId,
  });
}

/** Generate + install a CI bundle for one agent (AC-1). On success, the new
   installation and its (initially empty) run history should be visible, so
   invalidate both the installations list and every ci-runs query. */
export function useExportCi(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CiExportInputBody) =>
      api.post<CiExport>(`/agents/${agentId}/export-ci`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ci-runs"] });
      qc.invalidateQueries({ queryKey: ["ci-installations", agentId] });
    },
  });
}
