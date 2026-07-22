"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { notify } from "@/lib/contexts/toast";
import { useExportCi } from "@/lib/hooks/ci";
import type { CiFile } from "@/vendor/shared/contracts/eval-ci";
import { SecretReveal } from "./SecretReveal";
import { toExportInputBody, type WizardFormState } from "./types";
import { buildZipBlob, downloadZipBlob } from "./zip";

export interface InstallStepProps {
  agentId: string;
  agentSlug: string;
  form: WizardFormState;
  fileCount: number;
}

/** Uppercase section heading — matches the Preview/Configure steps. */
const sectionLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "var(--text-muted)",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  marginBottom: 8,
};

/** Step 4/4 — "Open a PR" (gha only, AC-10) and "Copy files as a zip" (always
 *  available, AC-12 — works even when `pr_url` degrades to null, AC-26). Both
 *  paths go through the SAME `useExportCi` mutation so the zip is always built
 *  from the real `CiExport.files` the server generated, not the Preview step's
 *  client-side stub (byte parity is a server concern, AC-7 — this step just
 *  reuses whatever `CiExport` it already has, or fetches one on demand). */
export function InstallStep({ agentId, agentSlug, form, fileCount }: InstallStepProps) {
  const t = useTranslations("ci");
  const exportMutation = useExportCi(agentId);
  const [zipping, setZipping] = useState(false);
  const [copied, setCopied] = useState(false);

  const canOpenPr = form.target === "gha";
  const result = exportMutation.data ?? null;

  const handleOpenPr = () => {
    exportMutation.mutate(toExportInputBody(form, "open_pr"));
  };

  const handleZip = async () => {
    setZipping(true);
    try {
      const files: CiFile[] = result?.files ?? (await exportMutation.mutateAsync(toExportInputBody(form, "files"))).files;
      const blob = buildZipBlob(files);
      downloadZipBlob(blob, `${agentSlug}-devdigest-ci.zip`);
    } catch {
      notify.error(t("exportWizard.exportFailed"));
    } finally {
      setZipping(false);
    }
  };

  const handleCopySecret = () => {
    if (!result?.ingest_secret) return;
    navigator.clipboard
      .writeText(result.ingest_secret)
      .then(() => {
        setCopied(true);
        notify.success(t("exportWizard.copied"));
      })
      .catch(() => notify.error(t("exportWizard.copyFailed")));
  };

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      {canOpenPr ? (
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
          <div style={sectionLabelStyle}>{t("exportWizard.installCardTitle")}</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
            {t("exportWizard.installCardBody", {
              repo: form.repo || t("exportWizard.ownerRepo"),
              count: fileCount,
            })}
          </div>
          {result?.pr_url ? (
            <>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
                {t("exportWizard.prOpened")}
              </div>
              <a href={result.pr_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 600 }}>
                {t("exportWizard.viewPr")}
              </a>
            </>
          ) : (
            <Button kind="primary" icon="GitPullRequest" onClick={handleOpenPr} loading={exportMutation.isPending}>
              {exportMutation.isPending ? t("exportWizard.installing") : t("exportWizard.install")}
            </Button>
          )}
          {exportMutation.isError && (
            <div role="alert" style={{ fontSize: 12.5, color: "var(--crit)", marginTop: 8 }}>
              {t("exportWizard.exportFailed")}
            </div>
          )}
          {result && !result.pr_url && (
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 8 }}>
              {t("exportWizard.prDegraded")}
            </div>
          )}
        </div>
      ) : (
        <div role="note" style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {t("exportWizard.zipOnlyNote")}
        </div>
      )}

      <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
        <div style={sectionLabelStyle}>{t("exportWizard.zipTitle")}</div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
          {t("exportWizard.zipBody")}
        </div>
        <Button kind="secondary" icon="Copy" onClick={handleZip} loading={zipping}>
          {t("exportWizard.copyZip")}
        </Button>
      </div>

      {result?.ingest_secret && (
        <SecretReveal
          title={t("exportWizard.ingestSecretTitle")}
          value={result.ingest_secret}
          hint={t("exportWizard.secretNote", { key: "DEVDIGEST_INGEST_TOKEN" })}
          onCopy={handleCopySecret}
          copyLabel={copied ? t("exportWizard.copied") : t("exportWizard.copy")}
        />
      )}
    </div>
  );
}
