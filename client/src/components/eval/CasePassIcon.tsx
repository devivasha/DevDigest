"use client";

/* CasePassIcon — per-case status: pass ✓ / fail ✗ / never-run, always icon +
   text (never colour alone). Used by the Evals tab case list (T12) and the
   case editor's last-run badge. */

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";

export interface CasePassIconProps {
  /** `null` = the case has never been run. */
  pass: boolean | null;
  /** Icon-only, accessible name still announced via `aria-label`. */
  compact?: boolean;
}

export function CasePassIcon({ pass, compact }: CasePassIconProps) {
  const t = useTranslations("eval");

  if (pass === null) {
    return (
      <span
        aria-label={t("evalsTab.neverRun")}
        style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-muted)" }}
      >
        <Icon.Slash size={13} aria-hidden="true" />
        {!compact && t("evalsTab.neverRun")}
      </span>
    );
  }

  const label = pass ? t("evalsTab.passed") : t("evalsTab.failed");
  const StatusIcon = pass ? Icon.CheckCircle : Icon.XCircle;
  const color = pass ? "var(--ok)" : "var(--crit)";

  return (
    <span
      aria-label={label}
      style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color }}
    >
      <StatusIcon size={13} aria-hidden="true" />
      {!compact && label}
    </span>
  );
}
