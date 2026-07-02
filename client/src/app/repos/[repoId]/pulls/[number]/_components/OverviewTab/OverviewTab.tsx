"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorBoundary } from "react-error-boundary";
import { SectionLabel } from "@devdigest/ui";
import { useBlastRadius } from "@/lib/hooks/pulls";
import { s } from "./styles";
import { IntentCard } from "./IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
}

export function OverviewTab({ prBody, prId }: OverviewTabProps) {
  const t = useTranslations("prReview");
  const { data: blastRadius, isLoading: blastLoading } = useBlastRadius(prId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Two-column: Intent (left) + Blast Radius (right) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          alignItems: "stretch",
        }}
      >
        {prId && <IntentCard prId={prId} />}

        <section style={{ display: "flex", flexDirection: "column" }}>
          <SectionLabel icon="GitPullRequest">
            {t("blastRadius.title")}
          </SectionLabel>
          <ErrorBoundary
            fallback={
              <div className="text-sm text-red-400 p-4">
                {t("blastRadius.error")}
              </div>
            }
          >
            <BlastRadiusCard
              blastRadius={blastRadius}
              isLoading={blastLoading}
            />
          </ErrorBoundary>
        </section>
      </div>

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">{t("overview.descriptionLabel")}</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </div>
  );
}
