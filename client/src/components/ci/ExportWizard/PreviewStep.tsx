"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState } from "@devdigest/ui";
import { FilePreviewCard } from "./FilePreviewCard";
import { SummaryCard } from "./SummaryCard";
import { AGENTS_DIR, MEMORY_PATH, RUNNER_DIR, SKILLS_DIR, WORKFLOW_PATH } from "./constants";
import type { CiFile } from "@/vendor/shared/contracts/eval-ci";

export interface PreviewStepProps {
  /** The REAL bundle from `usePreviewCi` — undefined while loading/never fetched. */
  files: CiFile[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** User-edited workflow text (gha only) overlaid on top of the fetched
   *  workflow file's contents. `null` = show the server's bytes as-is. */
  workflowOverride: string | null;
  onWorkflowChange: (contents: string) => void;
}

/** Step 2/4 — the full, REAL export bundle (AC-4/AC-7) presented as semantic
 *  sections (agent manifest, linked skills, memory log, workflow, bundled
 *  runner) rather than one raw card per path. Bytes still come from the
 *  server's side-effect-free preview endpoint via `usePreviewCi` (see
 *  `ExportWizard.tsx`), not a hand-rolled client approximation. Only the
 *  workflow file shows its contents and stays editable for `gha` (per its own
 *  `editable` flag from the server, AC-3/AC-6); a local edit overlays the
 *  fetched bytes without triggering a refetch. */
export function PreviewStep({ files, isLoading, isError, onRetry, workflowOverride, onWorkflowChange }: PreviewStepProps) {
  const t = useTranslations("ci");

  const displayFiles = !files
    ? []
    : workflowOverride == null
      ? files
      : files.map((file) => (file.path === WORKFLOW_PATH ? { ...file, contents: workflowOverride } : file));

  if (isLoading) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: "var(--text-muted)" }}>{t("exportWizard.generating")}</div>
    );
  }

  if (isError || displayFiles.length === 0) {
    return <ErrorState body={t("exportWizard.exportFailed")} onRetry={onRetry} />;
  }

  // Classify the bundle into the sections the mockup calls for. Everything that
  // isn't a recognised `.devdigest/…` file or the workflow is surfaced as an
  // "other" summary card — never silently dropped (e.g. the bundled runner).
  const manifest = displayFiles.find((f) => f.path.startsWith(AGENTS_DIR));
  const skills = displayFiles.filter((f) => f.path.startsWith(SKILLS_DIR));
  const memory = displayFiles.find((f) => f.path === MEMORY_PATH);
  const workflow = displayFiles.find((f) => f.path === WORKFLOW_PATH);
  const others = displayFiles.filter(
    (f) =>
      !f.path.startsWith(AGENTS_DIR) &&
      !f.path.startsWith(SKILLS_DIR) &&
      f.path !== MEMORY_PATH &&
      f.path !== WORKFLOW_PATH,
  );

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.04em" }}>
        {t("exportWizard.filesToCreate")}
      </div>

      {manifest && <SummaryCard title={t("exportWizard.manifestTitle")} subtitle={manifest.path} />}

      <SummaryCard
        title={t("exportWizard.skillsTitle", { count: skills.length })}
        subtitle={skills.length === 0 ? t("exportWizard.skillsEmpty") : undefined}
        mono={false}
      >
        {skills.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
            {skills.map((skill) => (
              <div key={skill.path} className="mono" style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                {skill.path}
              </div>
            ))}
          </div>
        )}
      </SummaryCard>

      {memory && <SummaryCard title={t("exportWizard.memoryTitle")} subtitle={memory.path} />}

      {workflow && (
        <FilePreviewCard
          file={workflow}
          title={t("exportWizard.workflowTitle")}
          editableLabel={t("exportWizard.editable")}
          readOnlyLabel={t("exportWizard.readOnly")}
          emptyLabel={t("exportWizard.emptyFile")}
          onChange={workflow.editable ? onWorkflowChange : undefined}
        />
      )}

      {others.map((file) => (
        <SummaryCard
          key={file.path}
          title={file.path.startsWith(RUNNER_DIR) ? t("exportWizard.runnerTitle") : file.path}
          subtitle={file.path}
        />
      ))}
    </div>
  );
}
