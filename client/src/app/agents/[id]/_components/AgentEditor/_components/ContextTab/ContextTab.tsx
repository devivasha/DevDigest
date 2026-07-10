/* ContextTab — attach/detach + reorder a repo's discovered project-context
   docs (specs/docs/insights) for this agent. Mirrors SkillsTab's attach/reorder
   UX (whole-set replace on save, order = index) — see SkillsTab.tsx. Agents
   are workspace-scoped but discovery is per-repo (R-7): a repo selector drives
   `useProjectContext`, defaulting to the workspace's first repo. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Skeleton, ErrorState } from "@devdigest/ui";
import type { Agent, DiscoveredDocument } from "@devdigest/shared";
import { useProjectContext, useDocument, useSetAgentDocs } from "@/lib/hooks";
import { useActiveRepo } from "@/lib/contexts/repoContext";
import { DocRow } from "./DocRow";
import { PreviewDrawer } from "./PreviewDrawer";

/** Sorts docs: attached first (in the agent's attach order), then unattached
    alphabetically by path — mirrors SkillsTab's "linked first, then
    alphabetical" ordering. */
function sortDocs(docs: DiscoveredDocument[], attachedOrder: string[]) {
  const byPath = new Map(docs.map((d) => [d.path, d]));
  const attached = attachedOrder
    .map((p) => byPath.get(p))
    .filter((d): d is DiscoveredDocument => !!d);
  const unattached = docs
    .filter((d) => !attachedOrder.includes(d.path))
    .sort((a, b) => a.path.localeCompare(b.path));
  return [...attached, ...unattached];
}

export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");

  // Discovery is per-repo. Instead of a per-tab selector (not in the design),
  // follow the repo currently selected in the main sidebar (useActiveRepo).
  const { activeRepo } = useActiveRepo();
  const repoId = activeRepo?.id ?? null;

  const {
    data: contextData,
    isLoading: contextLoading,
    isError: contextIsError,
    refetch,
  } = useProjectContext(repoId);

  const setAgentDocs = useSetAgentDocs(agent.id);

  const [search, setSearch] = React.useState("");
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = React.useState<string | null>(null);

  const attachedOrder = agent.attached_doc_paths;
  const attachedSet = React.useMemo(() => new Set(attachedOrder), [attachedOrder]);

  const documents = contextData?.documents ?? [];
  const sorted = sortDocs(documents, attachedOrder);
  const filtered = search
    ? sorted.filter((d) => d.path.toLowerCase().includes(search.toLowerCase()))
    : sorted;

  const attachedInRepoCount = documents.filter((d) => attachedSet.has(d.path)).length;
  const attachedTokens = documents
    .filter((d) => attachedSet.has(d.path))
    .reduce((sum, d) => sum + d.estimated_tokens, 0);

  const handleToggle = (path: string, checked: boolean) => {
    const next = checked
      ? [...attachedOrder, path]
      : attachedOrder.filter((p) => p !== path);
    setAgentDocs.mutate(next);
  };

  const moveAttached = (path: string, direction: -1 | 1) => {
    const idx = attachedOrder.indexOf(path);
    if (idx < 0) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= attachedOrder.length) return;
    const next = [...attachedOrder];
    const temp = next[idx]!;
    next[idx] = next[targetIdx]!;
    next[targetIdx] = temp;
    setAgentDocs.mutate(next);
  };

  const handleDrop = (targetPath: string, draggedPath: string) => {
    if (!draggedPath || draggedPath === targetPath) return;
    const from = attachedOrder.indexOf(draggedPath);
    const to = attachedOrder.indexOf(targetPath);
    if (from < 0 || to < 0) return;
    const next = [...attachedOrder];
    next.splice(from, 1);
    next.splice(to, 0, draggedPath);
    setAgentDocs.mutate(next);
    setDragOverPath(null);
  };

  const previewDoc = documents.find((d) => d.path === previewPath) ?? null;
  const { data: previewContent, isLoading: previewLoading } = useDocument(repoId, previewPath);

  return (
    <div style={{ padding: 28, maxWidth: 760 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>{t("context.title")}</h2>
        <span aria-live="polite" style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {t("context.attachedCount", { attached: attachedInRepoCount, total: documents.length })}
        </span>
      </div>

      {activeRepo && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
          {t("context.repoLabel")}: <span className="mono">{activeRepo.full_name}</span>
        </p>
      )}

      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
        {t("context.tokenEstimate", { tokens: attachedTokens })}
      </p>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
        {t("context.injectionNote")}
      </p>

      {!repoId ? (
        <ErrorState title={t("context.noRepos")} />
      ) : contextLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Skeleton height={48} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </div>
      ) : contextIsError ? (
        <ErrorState body={t("context.loadError")} onRetry={() => refetch()} />
      ) : (
        <>
          <input
            aria-label={t("context.searchLabel")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("context.filterPlaceholder")}
            style={{
              width: "100%",
              padding: "6px 10px",
              marginBottom: 14,
              border: "1px solid var(--border)",
              borderRadius: 7,
              background: "var(--bg-elevated)",
              fontSize: 13,
              color: "var(--text-primary)",
              boxSizing: "border-box",
            }}
          />

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {filtered.map((doc) => {
              const attached = attachedSet.has(doc.path);
              const idx = attachedOrder.indexOf(doc.path);
              return (
                <DocRow
                  key={doc.path}
                  doc={doc}
                  attached={attached}
                  canMoveUp={idx > 0}
                  canMoveDown={idx >= 0 && idx < attachedOrder.length - 1}
                  dragOver={dragOverPath === doc.path}
                  onToggle={(checked) => handleToggle(doc.path, checked)}
                  onMoveUp={() => moveAttached(doc.path, -1)}
                  onMoveDown={() => moveAttached(doc.path, 1)}
                  onPreview={() => setPreviewPath(doc.path)}
                  onDragStart={(e) => e.dataTransfer.setData("docPath", doc.path)}
                  onDragOver={() => setDragOverPath(doc.path)}
                  onDragLeave={() => setDragOverPath(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDrop(doc.path, e.dataTransfer.getData("docPath"));
                  }}
                />
              );
            })}
            {filtered.length === 0 && (
              <p style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: 24 }}>
                {documents.length === 0 ? t("context.emptyDocs") : t("context.emptyFiltered")}
              </p>
            )}
          </div>
        </>
      )}

      {previewDoc && (
        <PreviewDrawer
          doc={previewDoc}
          text={previewContent?.text}
          isLoading={previewLoading}
          attached={attachedSet.has(previewDoc.path)}
          onToggleAttach={(checked) => handleToggle(previewDoc.path, checked)}
          onClose={() => setPreviewPath(null)}
        />
      )}
    </div>
  );
}
