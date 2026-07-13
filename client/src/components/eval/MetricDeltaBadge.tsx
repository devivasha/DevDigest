"use client";

/* MetricDeltaBadge — a signed metric delta rendered as an arrow glyph + text,
   never colour alone (AC-23). Reused by the dashboard metric cards, the Evals
   tab, and CompareRunsModal. */

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";

export type MetricDeltaFormat = "points" | "currency" | "raw";

export interface MetricDeltaBadgeProps {
  /** Signed delta (head − base). `null`/`undefined` = no previous run to compare against. */
  delta: number | null | undefined;
  /** "points" = percentage points (delta × 100, e.g. 0.82 → 0.86 = "+4pts");
      "currency" = dollars (delta already in USD); "raw" = delta shown as-is. */
  format?: MetricDeltaFormat;
  /** Extra label rendered for screen readers only (e.g. the metric name). */
  metricLabel?: string;
}

function magnitudeText(delta: number, format: MetricDeltaFormat): string {
  const abs = Math.abs(delta);
  if (format === "currency") return `$${abs.toFixed(2)}`;
  if (format === "points") {
    const pts = Math.round(abs * 100);
    return `${pts}pt${pts === 1 ? "" : "s"}`;
  }
  return abs.toFixed(2);
}

/** Signed delta badge — arrow + text conveys direction, colour is supplementary only. */
export function MetricDeltaBadge({ delta, format = "points", metricLabel }: MetricDeltaBadgeProps) {
  const t = useTranslations("eval");
  if (delta == null) return null;

  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const Arrow = direction === "up" ? Icon.ArrowUp : direction === "down" ? Icon.ArrowDown : Icon.Slash;
  const color = direction === "up" ? "var(--ok)" : direction === "down" ? "var(--crit)" : "var(--text-muted)";
  const directionLabel =
    direction === "up" ? t("common.up") : direction === "down" ? t("common.down") : t("common.flat");
  const magnitude = magnitudeText(delta, format);
  const sign = direction === "up" ? "+" : direction === "down" ? "−" : "";
  const accessibleName = metricLabel ? `${metricLabel}: ${directionLabel}, ${magnitude}` : `${directionLabel}, ${magnitude}`;

  return (
    <span
      role="status"
      aria-label={accessibleName}
      className="tnum"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 12,
        fontWeight: 600,
        color,
      }}
    >
      <Arrow size={12} aria-hidden="true" />
      <span aria-hidden="true">
        {sign}
        {magnitude}
      </span>
    </span>
  );
}
