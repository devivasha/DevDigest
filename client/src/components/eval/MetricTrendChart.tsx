"use client";

/* MetricTrendChart — wraps @devdigest/ui's LineChart, mapping EvalTrendPoint[]
   into recall/precision/citation series (AC-21), plus an accessible text
   alternative for the chart data (a11y — trend data needs a non-visual path). */

import React from "react";
import { useTranslations } from "next-intl";
import { LineChart, type ChartSeries } from "@devdigest/ui";
import type { EvalTrendPoint } from "@devdigest/shared";

export interface MetricTrendChartProps {
  trend: EvalTrendPoint[];
  w?: number;
  h?: number;
}

function formatPercent(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function summarize(trend: EvalTrendPoint[]): string {
  return trend
    .map((p) => {
      const when = new Date(p.ran_at).toLocaleDateString();
      return `${when}: recall ${formatPercent(p.recall)}, precision ${formatPercent(p.precision)}, citation ${formatPercent(p.citation_accuracy)}`;
    })
    .join("; ");
}

export function MetricTrendChart({ trend, w, h }: MetricTrendChartProps) {
  const t = useTranslations("eval");

  const series: ChartSeries[] = [
    { name: t("dashboard.legend.recall"), color: "var(--accent)", data: trend.map((p) => p.recall) },
    { name: t("dashboard.legend.precision"), color: "var(--ok)", data: trend.map((p) => p.precision) },
    { name: t("dashboard.legend.citation"), color: "var(--warn)", data: trend.map((p) => p.citation_accuracy) },
  ];

  const description = trend.length > 0 ? summarize(trend) : t("dashboard.noRuns");

  return (
    <div>
      <div aria-hidden="true">
        <LineChart series={series} w={w} h={h} />
      </div>
      {/* Accessible text alternative — the chart's visual series is decorative
          (aria-hidden) since this paragraph carries the same data as text. */}
      <p style={visuallyHidden}>
        {t("dashboard.metricTrend")}: {description}
      </p>
    </div>
  );
}

const visuallyHidden: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  whiteSpace: "nowrap",
  border: 0,
};
