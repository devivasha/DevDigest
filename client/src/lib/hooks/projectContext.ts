/* hooks/projectContext.ts — React Query hooks for the Project Context feature
   (repo-scoped doc discovery + preview/edit, agent/skill doc attachment). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  Agent,
  DiscoveredDocument,
  DiscoverySummary,
  DocumentContent,
  Skill,
} from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export interface ProjectContextResult {
  documents: DiscoveredDocument[];
  summary: DiscoverySummary;
}

export function useProjectContext(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["project-context", repoId],
    queryFn: () =>
      api.get<ProjectContextResult>(`/repos/${repoId}/project-context`),
    enabled: !!repoId,
  });
}

// ---------------------------------------------------------------------------
// Document read/write (Preview / Edit-in-place)
// ---------------------------------------------------------------------------

export function useDocument(
  repoId: string | null | undefined,
  path: string | null | undefined
) {
  return useQuery({
    queryKey: ["project-document", repoId, path],
    queryFn: () =>
      api.get<DocumentContent>(
        `/repos/${repoId}/project-context/document?path=${encodeURIComponent(path!)}`
      ),
    enabled: !!repoId && !!path,
  });
}

export interface SaveDocumentInput {
  path: string;
  text: string;
}

export function useSaveDocument(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveDocumentInput) =>
      api.put<DocumentContent>(
        `/repos/${repoId}/project-context/document`,
        input
      ),
    onSuccess: (data) => {
      qc.setQueryData(["project-document", repoId, data.path], data);
    },
  });
}

// ---------------------------------------------------------------------------
// Agent / Skill doc attachment
// ---------------------------------------------------------------------------

export function useSetAgentDocs(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paths: string[]) =>
      api.put<Agent>(`/agents/${agentId}/attached-docs`, { paths }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent", agentId] });
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useSetSkillDocs(skillId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paths: string[]) =>
      api.put<Skill>(`/skills/${skillId}/attached-docs`, { paths }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skill", skillId] });
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
