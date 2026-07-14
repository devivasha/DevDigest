"use client";

/* DegradedBadge — honest "citation accuracy unavailable" marker (AC-17), used
   whenever a case's diff could not be parsed so the citation metric is `null`
   instead of a number. Icon + text, with the reason available on hover/focus
   via a native tooltip (`title`) — never conveyed by colour/omission alone. */

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";

export function DegradedBadge({ compact }: { compact?: boolean }) {
  const t = useTranslations("eval");
  const tooltip = t("dashboard.degraded.tooltip");
  const label = t("dashboard.degraded.badge");

  return (
    <span title={tooltip} role="status">
      <Badge icon="AlertOctagon" color="var(--warn)" bg="var(--warn-bg)">
        {compact ? null : label}
      </Badge>
      {compact && <span style={visuallyHidden}>{label}</span>}
    </span>
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
