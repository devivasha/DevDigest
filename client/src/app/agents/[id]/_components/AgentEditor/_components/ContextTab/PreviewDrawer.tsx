"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Drawer, Badge, IconBtn, Skeleton, Markdown } from "@devdigest/ui";
import type { DiscoveredDocument } from "@devdigest/shared";
import { BUCKET_COLOR } from "./constants";

/** Preview drawer for a single discovered doc. Exactly four metadata items:
    bucket badge, token count, "used by N agents", attach toggle (AC-13). */
export function PreviewDrawer({
  doc,
  text,
  isLoading,
  attached,
  onToggleAttach,
  onClose,
}: {
  doc: DiscoveredDocument;
  text: string | undefined;
  isLoading: boolean;
  attached: boolean;
  onToggleAttach: (checked: boolean) => void;
  onClose: () => void;
}) {
  const t = useTranslations("agents");
  const filename = doc.path.split("/").pop() ?? doc.path;

  return (
    <Drawer title={filename} subtitle={doc.path} onClose={onClose}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 18,
        }}
      >
        {/* 1. bucket badge */}
        <Badge color={BUCKET_COLOR[doc.bucket]}>{t(`context.bucket.${doc.bucket}`)}</Badge>
        {/* 2. token count */}
        <Badge>{t("context.previewTokens", { tokens: doc.estimated_tokens })}</Badge>
        {/* 3. used by N agents */}
        <Badge>{t("context.previewUsedBy", { count: doc.used_by_agents ?? 0 })}</Badge>
        {/* 4. attach toggle */}
        <IconBtn
          icon={attached ? "Check" : "Plus"}
          label={
            attached
              ? t("context.detach", { name: filename })
              : t("context.attach", { name: filename })
          }
          active={attached}
          onClick={() => onToggleAttach(!attached)}
        />
      </div>
      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Skeleton height={14} />
          <Skeleton height={14} />
          <Skeleton height={14} width="70%" />
        </div>
      ) : (
        <Markdown>{text ?? ""}</Markdown>
      )}
    </Drawer>
  );
}
