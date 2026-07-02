"use client";

import React from "react";
import { useTranslations } from "next-intl";

interface SummaryBarProps {
  symbolCount: number;
  callerCount: number;
  endpointCount: number;
  cronCount: number;
  degraded: boolean;
  onOpenGraph: () => void;
}

export function SummaryBar({
  symbolCount,
  callerCount,
  endpointCount,
  cronCount,
  degraded,
  onOpenGraph,
}: SummaryBarProps) {
  const t = useTranslations("prReview.blastRadius");

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-[var(--text-muted)]">
        {t("symbols", { count: symbolCount })}
      </span>
      <span className="text-xs text-[var(--text-muted)]">
        {t("callers", { count: callerCount })}
      </span>
      <span className="text-xs text-indigo-400">
        {t("endpoints", { count: endpointCount })}
      </span>
      {cronCount > 0 && (
        <span className="text-xs text-amber-400">
          {t("crons", { count: cronCount })}
        </span>
      )}
      {degraded && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-400/15 text-red-400 font-semibold uppercase tracking-wide">
          {t("degraded")}
        </span>
      )}
      <button
        onClick={onOpenGraph}
        className="ml-auto text-[11px] px-2 py-0.5 rounded border border-[var(--border)] cursor-pointer text-[var(--text-muted)] bg-transparent hover:text-[var(--text-primary)] transition-colors"
      >
        {t("openGraph")}
      </button>
    </div>
  );
}
