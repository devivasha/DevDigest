/* hooks/eval.ts — React Query hooks for the L06 eval pipeline (cases, runs,
   history, compare, dashboards). Mirrors hooks/reviews.ts: thin wrappers over
   `api.get/post/patch/del`, inline literal query keys, `notify` for the
   create-from-finding success toast (AC-1). No raw `fetch`. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "../api";
import { notify } from "../contexts/toast";
import type {
  EvalCase,
  EvalCaseInput,
  EvalCaseStatus,
  EvalCompare,
  EvalDashboard,
  EvalOwnerKind,
  EvalRun,
  EvalSetRunRecord,
} from "@devdigest/shared";

// Only `/agents/:id/...` eval routes exist server-side today (T8) — every
// hook below addresses an agent owner. `ownerKind` is still threaded through
// (matching `EvalCaseInput`/`EvalDashboard`'s owner_kind field and keeping
// call sites future-proof for a `skill` owner) but does not affect the URL.

// ---- Eval cases for one owner (agent) ----
export function useEvalCases(ownerKind: EvalOwnerKind, ownerId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-cases", ownerId],
    queryFn: () => api.get<EvalCase[]>(`/agents/${ownerId}/eval-cases`),
    enabled: !!ownerId,
  });
}

/** Turn a triaged finding into an eval case in one action (AC-1). The server
   derives the owning agent + expectation kind from the finding — the body
   carries only `finding_id` (finding #4, never a client-trusted agent id). */
export function useCreateCaseFromFinding() {
  const qc = useQueryClient();
  const t = useTranslations("eval");
  return useMutation({
    mutationFn: ({ agentId, findingId }: { agentId: string; findingId: string }) =>
      api.post<EvalCase>(`/agents/${agentId}/eval-cases/from-finding`, {
        finding_id: findingId,
      }),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
      notify.success(t("finding.createdToast"));
    },
  });
}

/** Manual eval case creation from the case editor modal. */
export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalCaseInput) =>
      api.post<EvalCase>(`/agents/${input.owner_id}/eval-cases`, input),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", input.owner_id] });
    },
  });
}

export type EvalCaseUpdateInput = Partial<Omit<EvalCaseInput, "owner_kind" | "owner_id">>;

export function useUpdateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      caseId,
      patch,
    }: {
      caseId: string;
      ownerId: string;
      patch: EvalCaseUpdateInput;
    }) => api.patch<EvalCase>(`/eval-cases/${caseId}`, patch),
    onSuccess: (_data, { ownerId }) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", ownerId] });
    },
  });
}

export function useDeleteEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId }: { caseId: string; ownerId: string }) =>
      api.del<{ ok: boolean }>(`/eval-cases/${caseId}`),
    onSuccess: (_data, { ownerId }) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", ownerId] });
    },
  });
}

// ---- Run the whole eval set for one agent (AC-11) ----
export function useRunEvalSet(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalRun>(`/agents/${agentId}/eval-runs`),
    onSuccess: () => {
      // Prefix-invalidate — matches both the per-owner key
      // (['eval-dashboard', ownerKind, ownerId]) and the all-agents key
      // (['eval-dashboard', 'all']) since a run can move either surface.
      qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
      qc.invalidateQueries({ queryKey: ["eval-runs", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
      // A full-set run also refreshes every row's persisted status, so the
      // Evals tab's per-case icons stay in sync with the server after a run.
      qc.invalidateQueries({ queryKey: ["eval-case-status", agentId] });
    },
  });
}

// ---- Latest per-case run status + single-case run (AC-19) ----

/** Every case's LATEST persisted run status for one agent — powers the
   Evals tab's per-case pass/fail icon on page load, before any in-session
   run has happened. A case absent from the response has never been run. */
export function useCaseStatuses(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-case-status", agentId],
    queryFn: () => api.get<EvalCaseStatus[]>(`/agents/${agentId}/eval-cases/status`),
    enabled: !!agentId,
  });
}

/** Run exactly ONE eval case (the per-row "play" button) — distinct from
   `useRunEvalSet`, which runs the whole set. */
export function useRunEvalCase(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId }: { caseId: string }) =>
      api.post<EvalCaseStatus>(`/agents/${agentId}/eval-cases/${caseId}/run`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eval-case-status", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
      qc.invalidateQueries({ queryKey: ["eval-runs", agentId] });
    },
  });
}

/** Run every agent's eval set (dashboard "Run all agents" action, AC-20). No
   dedicated batch endpoint exists — fan out `POST /agents/:id/eval-runs` per
   agent id and let each settle independently (one slow/failing agent must
   not block the rest). */
export function useRunAllAgents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentIds: string[]) =>
      Promise.allSettled(
        agentIds.map((agentId) => api.post<EvalRun>(`/agents/${agentId}/eval-runs`)),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
      qc.invalidateQueries({ queryKey: ["eval-runs"] });
      qc.invalidateQueries({ queryKey: ["eval-cases"] });
    },
  });
}

// ---- Run history + compare (AC-13) ----
export function useRunHistory(ownerKind: EvalOwnerKind, ownerId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-runs", ownerId],
    queryFn: () => api.get<EvalSetRunRecord[]>(`/agents/${ownerId}/eval-runs`),
    enabled: !!ownerId,
  });
}

/** Compare exactly two set runs of the same agent — deltas + prompt diff. */
export function useCompareRuns(
  agentId: string | null | undefined,
  baseId: string | null | undefined,
  headId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["eval-compare", agentId, baseId, headId],
    queryFn: () =>
      api.get<EvalCompare>(
        `/agents/${agentId}/eval-compare?base=${encodeURIComponent(baseId!)}&head=${encodeURIComponent(headId!)}`,
      ),
    enabled: !!agentId && !!baseId && !!headId,
  });
}

// ---- Dashboards ----
export function useEvalDashboard(ownerKind: EvalOwnerKind, ownerId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-dashboard", ownerKind, ownerId],
    queryFn: () => api.get<EvalDashboard>(`/agents/${ownerId}/eval-dashboard`),
    enabled: !!ownerId,
  });
}

/** Workspace-wide aggregate across all agents (AC-20's `/eval` dashboard). */
export function useEvalDashboardAll() {
  return useQuery({
    queryKey: ["eval-dashboard", "all"],
    queryFn: () => api.get<EvalDashboard>("/eval/dashboard"),
  });
}
