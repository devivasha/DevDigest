"use client";

/* RegressionBanner — AC-14: warns when a metric dipped vs. the previous run,
   naming the metric + magnitude. Direction is conveyed by an arrow glyph +
   text, never colour alone (AC-23). */

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";

export type RegressionMetric = "recall" | "precision" | "citation_accuracy";

export interface RegressionDip {
  metric: RegressionMetric;
  /** Positive magnitude of the drop, e.g. `0.02` for a 2pt dip. */
  magnitude: number;
}

export interface RegressionBannerProps {
  /** Structured dips — preferred; each is rendered via the i18n `dipped` template. */
  dips?: RegressionDip[];
  /** Fallback: a pre-composed server alert string, used only when `dips` is empty. */
  alert?: string | null;
}

const METRIC_LABEL_KEY: Record<RegressionMetric, string> = {
  recall: "dashboard.metrics.recall",
  precision: "dashboard.metrics.precision",
  citation_accuracy: "dashboard.metrics.citationAccuracy",
};

function formatMagnitude(magnitude: number): string {
  const pts = Math.round(Math.abs(magnitude) * 100);
  return `${pts}pt${pts === 1 ? "" : "s"}`;
}

export function RegressionBanner({ dips, alert }: RegressionBannerProps) {
  const t = useTranslations("eval");
  const hasDips = !!dips && dips.length > 0;

  if (!hasDips && !alert) return null;

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "12px 16px",
        borderRadius: 8,
        border: "1px solid var(--warn)",
        background: "var(--warn-bg)",
        color: "var(--text-primary)",
      }}
    >
      <Icon.AlertTriangle size={16} style={{ color: "var(--warn)", flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>
        <div style={{ fontWeight: 600 }}>{t("dashboard.regression.banner")}</div>
        {hasDips ? (
          <ul style={{ margin: "4px 0 0", padding: 0, listStyle: "none" }}>
            {dips!.map((dip) => (
              <li key={dip.metric} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Icon.ArrowDown size={12} style={{ color: "var(--crit)" }} aria-hidden="true" />
                <span>
                  {t("dashboard.regression.dipped", {
                    metric: t(METRIC_LABEL_KEY[dip.metric]),
                    magnitude: formatMagnitude(dip.magnitude),
                  })}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ marginTop: 2, color: "var(--text-secondary)" }}>{alert}</div>
        )}
      </div>
    </div>
  );
}
