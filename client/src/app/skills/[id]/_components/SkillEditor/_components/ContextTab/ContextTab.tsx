/* ContextTab — attach Project Context docs (specs/docs/insights) to a skill.
   Skills are workspace-scoped but discovery is per-repo, so this tab follows
   the repo selected in the main sidebar (useActiveRepo). Persists the ordered
   set of attached paths to the skill's `attached_doc_paths` — a field distinct
   from `evidence_files`, never touched here. Preview opens in a Drawer with
   rendered markdown (mirrors the agent editor's Context tab). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Drawer, ErrorState, IconBtn, Markdown, Skeleton, Toggle } from "@devdigest/ui";
import type { DiscoveredDocument, DocumentBucket, Skill } from "@devdigest/shared";
import { useDocument, useProjectContext, useSetSkillDocs } from "@/lib/hooks";
import { useActiveRepo } from "@/lib/contexts/repoContext";

const BUCKET_COLOR: Record<DocumentBucket, string> = {
  specs: "var(--accent)",
  docs: "var(--ok)",
  insights: "var(--warn)",
};

function splitPath(path: string): { filename: string; folder: string } {
  const idx = path.lastIndexOf("/");
  return idx === -1
    ? { filename: path, folder: "" }
    : { filename: path.slice(idx + 1), folder: path.slice(0, idx) };
}

export function ContextTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");

  // Discovery is per-repo. Instead of a per-tab selector (not in the design),
  // follow the repo currently selected in the main sidebar (useActiveRepo).
  const { activeRepo } = useActiveRepo();
  const effectiveRepoId = activeRepo?.id ?? null;

  const {
    data: context,
    isLoading: contextLoading,
    isError: contextError,
    refetch,
  } = useProjectContext(effectiveRepoId);
  const setDocs = useSetSkillDocs(skill.id);

  const [search, setSearch] = React.useState("");
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);

  // Source of truth for attach state — derived from the skill prop, never
  // duplicated into local state (attach state is keyed by path so filtering
  // the visible rows below never drops a toggle).
  const attachedPaths = skill.attached_doc_paths ?? [];
  const isAttached = (path: string) => attachedPaths.includes(path);

  const handleToggle = (path: string, checked: boolean) => {
    const next = checked
      ? [...attachedPaths, path]
      : attachedPaths.filter((p) => p !== path);
    setDocs.mutate(next);
  };

  const documents: DiscoveredDocument[] = context?.documents ?? [];
  const previewDoc = documents.find((d) => d.path === previewPath) ?? null;

  const query = search.trim().toLowerCase();
  const filtered = documents.filter(
    (doc) => !query || doc.path.toLowerCase().includes(query),
  );

  // Attached docs first (in attach order), then the rest alphabetically —
  // mirrors the agent editor's SkillsTab sort.
  const sorted = [
    ...attachedPaths
      .map((p) => filtered.find((d) => d.path === p))
      .filter((d): d is DiscoveredDocument => Boolean(d)),
    ...filtered
      .filter((d) => !isAttached(d.path))
      .sort((a, b) => a.path.localeCompare(b.path)),
  ];

  const isLoading = !!effectiveRepoId && contextLoading;
  const isError = contextError;

  if (isLoading) {
    return (
      <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 12 }}>
        <Skeleton height={40} />
        <Skeleton height={48} />
        <Skeleton height={48} />
        <Skeleton height={48} />
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState body={t("context.loadError")} onRetry={() => refetch()} />
    );
  }

  if (!effectiveRepoId) {
    return (
      <div style={{ padding: 28 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {t("context.noRepos")}
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: 28, maxWidth: 720 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>
          {t("context.title")}
        </h2>
        <span
          style={{ fontSize: 13, color: "var(--text-muted)" }}
          aria-live="polite"
        >
          {t("context.attachedCount", { count: attachedPaths.length })}
        </span>
      </div>

      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
        {t("context.inheritanceNote")}
      </p>

      {/* Active repo indicator — follows the main sidebar's repo selection */}
      {activeRepo && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
          {t("context.repoLabel")}: <span className="mono">{activeRepo.full_name}</span>
        </p>
      )}

      {/* Search */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("context.searchPlaceholder")}
        aria-label={t("context.searchPlaceholder")}
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

      {/* Document rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 24 }}>
        {sorted.map((doc) => {
          const { filename, folder } = splitPath(doc.path);
          const attached = isAttached(doc.path);
          return (
            <div key={doc.path}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--bg-elevated)",
                  opacity: attached ? 1 : 0.85,
                }}
              >
                <div title={t("context.toggleLabel", { filename })}>
                  <Toggle
                    on={attached}
                    size={13}
                    onChange={(checked) => handleToggle(doc.path, checked)}
                  />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 13,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {filename}
                  </div>
                  {folder && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {folder}
                    </div>
                  )}
                </div>

                <Badge color={BUCKET_COLOR[doc.bucket]}>
                  {t(`context.bucket.${doc.bucket}`)}
                </Badge>

                <IconBtn
                  icon="Eye"
                  label={t("context.previewLabel", { filename })}
                  active={previewPath === doc.path}
                  onClick={() => setPreviewPath(doc.path)}
                />
              </div>
            </div>
          );
        })}
        {sorted.length === 0 && (
          <p
            style={{
              fontSize: 13,
              color: "var(--text-muted)",
              textAlign: "center",
              padding: 24,
            }}
          >
            {t("context.noMatch")}
          </p>
        )}
      </div>

      {/* Serializes-as preview — the contribution heading + attached path list */}
      <div>
        <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
          {t("context.serializesAsTitle")}
        </h3>
        <pre
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 16,
            fontFamily: "monospace",
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: "var(--text-primary)",
            margin: 0,
          }}
        >
          {attachedPaths.length === 0
            ? t("context.serializesAsEmpty")
            : `## Project context\n${attachedPaths.map((p) => `- ${p}`).join("\n")}`}
        </pre>
      </div>

      {previewDoc && effectiveRepoId && (
        <PreviewDrawer
          doc={previewDoc}
          repoId={effectiveRepoId}
          attached={isAttached(previewDoc.path)}
          onToggleAttach={(checked) => handleToggle(previewDoc.path, checked)}
          onClose={() => setPreviewPath(null)}
        />
      )}
    </div>
  );
}

/** Preview drawer for a single discovered doc — rendered markdown plus bucket
    badge, token count, "used by N agents", and an attach toggle. Mirrors the
    agent editor's Context-tab drawer (no inline, scrolling `<pre>`). */
function PreviewDrawer({
  doc,
  repoId,
  attached,
  onToggleAttach,
  onClose,
}: {
  doc: DiscoveredDocument;
  repoId: string;
  attached: boolean;
  onToggleAttach: (checked: boolean) => void;
  onClose: () => void;
}) {
  const t = useTranslations("skills");
  const filename = splitPath(doc.path).filename;
  const { data, isLoading, isError } = useDocument(repoId, doc.path);

  return (
    <Drawer title={filename} subtitle={doc.path} onClose={onClose}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 18,
        }}
      >
        <Badge color={BUCKET_COLOR[doc.bucket]}>{t(`context.bucket.${doc.bucket}`)}</Badge>
        <Badge>{t("context.previewTokens", { tokens: doc.estimated_tokens })}</Badge>
        <Badge>{t("context.previewUsedBy", { count: doc.used_by_agents ?? 0 })}</Badge>
        <IconBtn
          icon={attached ? "Check" : "Plus"}
          label={
            attached
              ? t("context.detachLabel", { filename })
              : t("context.toggleLabel", { filename })
          }
          active={attached}
          onClick={() => onToggleAttach(!attached)}
        />
      </div>
      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Skeleton height={14} />
          <Skeleton height={14} />
          <Skeleton height={14} width="70%" />
        </div>
      ) : isError ? (
        <span style={{ fontSize: 12, color: "var(--crit)" }}>
          {t("context.previewLoadError")}
        </span>
      ) : (
        <Markdown>{data?.text ?? ""}</Markdown>
      )}
    </Drawer>
  );
}
