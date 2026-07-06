"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import { s } from "./styles";
import { IntentCard } from "./IntentCard";
import { BlastRadiusCard } from "./BlastRadiusCard";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  repoFullName?: string | null;
  headSha?: string | null;
}

export function OverviewTab({ prBody, prId, repoFullName, headSha }: OverviewTabProps) {
  const t = useTranslations("prReview");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {prId && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 20,
            alignItems: "flex-start",
          }}
        >
          <div style={{ flex: "1 1 360px", minWidth: 0 }}>
            <IntentCard prId={prId} />
          </div>
          <div style={{ flex: "1 1 360px", minWidth: 0 }}>
            <BlastRadiusCard prId={prId} repoFullName={repoFullName} headSha={headSha} />
          </div>
        </div>
      )}
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">{t("overview.descriptionLabel")}</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </div>
  );
}
