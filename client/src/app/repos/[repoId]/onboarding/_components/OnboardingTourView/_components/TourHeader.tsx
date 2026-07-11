"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { COPY_FEEDBACK_MS } from "../constants";
import { getRelativeTimeParts } from "../helpers";
import { s } from "../styles";

/** Page header: title + "Generated from index of N files · last refreshed
 *  <ago>" subtitle (AC-2), a Regenerate button (AC-15), and a Share button
 *  that copies an in-app deep link only — no server call, no public URL
 *  (AC-17). Both actions announce their result via an `aria-live` region. */
export function TourHeader({
  repoId,
  repoName,
  indexFileCount,
  lastRefreshedAt,
  regenerating,
  onRegenerate,
}: {
  repoId: string;
  repoName: string;
  indexFileCount: number;
  lastRefreshedAt: string;
  regenerating: boolean;
  onRegenerate: () => void;
}) {
  const t = useTranslations("onboarding");
  const [shareStatus, setShareStatus] = React.useState<"idle" | "copied" | "failed">("idle");
  const shareTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(shareTimeoutRef.current), []);

  const rel = getRelativeTimeParts(lastRefreshedAt);
  const relative =
    rel.unit === "now" ? t("relative.now") : t(`relative.${rel.unit}`, { count: rel.count });

  const handleShare = async () => {
    const link = `${window.location.origin}/repos/${repoId}/onboarding`;
    try {
      await navigator.clipboard.writeText(link);
      setShareStatus("copied");
    } catch {
      setShareStatus("failed");
    }
    clearTimeout(shareTimeoutRef.current);
    shareTimeoutRef.current = setTimeout(() => setShareStatus("idle"), COPY_FEEDBACK_MS);
  };

  return (
    <div style={s.headerRow}>
      <div>
        <h1 style={s.title}>
          {t("titlePrefix")} <span style={s.repoName}>{repoName}</span>
        </h1>
        <p style={s.subtitle}>
          {t("subtitle", { count: indexFileCount, relative })}
        </p>
      </div>
      <div style={s.headerActions}>
        <Button
          kind="secondary"
          icon="RefreshCw"
          loading={regenerating}
          onClick={onRegenerate}
          title={t("generate.body")}
        >
          {regenerating ? t("regenerating") : t("regenerate")}
        </Button>
        <Button kind="secondary" icon="Link" onClick={handleShare}>
          {t("shareLink")}
        </Button>
        <span role="status" aria-live="polite" style={s.visuallyHidden}>
          {regenerating
            ? t("regenerating")
            : shareStatus === "copied"
              ? t("linkCopied")
              : shareStatus === "failed"
                ? t("copyFailed")
                : ""}
        </span>
      </div>
    </div>
  );
}
