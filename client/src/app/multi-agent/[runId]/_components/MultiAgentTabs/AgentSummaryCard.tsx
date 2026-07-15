/* AgentSummaryCard — the selected agent's summary strip at the top of the
   Tabs panel: accent left border, CircularScore ring, agent name in the
   accent colour, summary text, and "View trace" + duration/cost on the
   right (design mock). "View trace" is presentational only here — no run
   trace drawer is wired in this view. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, CircularScore } from "@devdigest/ui";
import type { AgentColumn } from "@devdigest/shared";
import type { AgentTheme } from "@/app/multi-agent/_shared/agentTheme";
import { formatCost, formatDuration } from "./helpers";
import { s } from "./styles";

export function AgentSummaryCard({ column, theme }: { column: AgentColumn; theme: AgentTheme }) {
  const t = useTranslations("multiAgent");

  return (
    <div style={s.summaryCard(theme.accent)}>
      <CircularScore score={column.score ?? 0} size={56} />
      <div style={s.summaryMain}>
        <div style={s.summaryName(theme.accent)}>{column.agent_name}</div>
        {column.summary && <p style={s.summaryText}>{column.summary}</p>}
      </div>
      <div style={s.summaryRight}>
        <Button kind="ghost" size="sm" icon="ExternalLink">
          {t("columns.viewTrace")}
        </Button>
        <span className="mono" style={s.summaryMeta}>
          {formatDuration(column.duration_ms)} · {formatCost(column.cost_usd)}
        </span>
      </div>
    </div>
  );
}
