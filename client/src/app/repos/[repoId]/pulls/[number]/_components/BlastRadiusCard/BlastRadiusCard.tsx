"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { BlastRadiusResult } from "@devdigest/shared";
import { SummaryBar } from "./SummaryBar";
import { SymbolList } from "./SymbolList";
import { PriorPrsAccordion } from "./PriorPrsAccordion";
import { BlastGraphLightbox } from "./BlastGraphLightbox";
import { buildCronSet, buildSymbolRows } from "./helpers";

interface BlastRadiusCardProps {
  blastRadius: BlastRadiusResult | undefined;
  isLoading: boolean;
}

export function BlastRadiusCard({
  blastRadius,
  isLoading,
}: BlastRadiusCardProps) {
  const t = useTranslations("prReview.blastRadius");
  const params = useParams<{ repoId: string; number: string }>();
  const [graphOpen, setGraphOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="border border-[var(--border)] rounded-lg bg-[var(--bg-elevated)] p-4 flex items-center justify-center h-80">
        <span className="text-xs text-[var(--text-muted)]">
          {t("loadingTitle")}
        </span>
      </div>
    );
  }

  if (!blastRadius) {
    return (
      <div className="border border-[var(--border)] rounded-lg bg-[var(--bg-elevated)] p-4 flex flex-col items-center justify-center h-80 gap-2">
        <span className="text-2xl">📡</span>
        <span className="text-sm text-[var(--text-muted)] text-center">
          {t("emptyTitle")}
        </span>
        <span className="text-xs text-[var(--text-muted)] text-center max-w-[220px]">
          {t("emptyBody")}
        </span>
      </div>
    );
  }

  const cronSet = buildCronSet(blastRadius.factsByFile);
  const symbolRows = buildSymbolRows(blastRadius);

  return (
    <div className="border border-[var(--border)] rounded-lg bg-[var(--bg-elevated)] p-4 flex flex-col gap-3 h-80 box-border overflow-hidden">
      <SummaryBar
        symbolCount={blastRadius.changedSymbols.length}
        callerCount={blastRadius.callers.length}
        endpointCount={blastRadius.impactedEndpoints.length}
        cronCount={cronSet.size}
        degraded={blastRadius.degraded ?? false}
        onOpenGraph={() => setGraphOpen(true)}
      />

      {blastRadius.summary && (
        <p className="m-0 text-xs text-[var(--text-secondary)] leading-relaxed">
          {blastRadius.summary}
        </p>
      )}

      <div className="flex-1 overflow-y-auto">
        <SymbolList
          rows={symbolRows}
          repoId={params.repoId}
          prNumber={params.number}
        />
      </div>

      <PriorPrsAccordion priorPrs={blastRadius.priorPrs ?? []} />

      {graphOpen && (
        <BlastGraphLightbox
          data={blastRadius}
          onClose={() => setGraphOpen(false)}
        />
      )}
    </div>
  );
}
