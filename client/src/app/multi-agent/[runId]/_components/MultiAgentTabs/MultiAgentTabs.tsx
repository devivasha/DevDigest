/* MultiAgentTabs — Tabs + detail presentation mode for one multi-agent run
   (R-Tabs, AC-23…AC-27). One themed tab per agent (icon + name + coloured
   score); selecting a tab shows that agent's summary card and its findings
   as collapsible cards. Opening a finding shows confidence + suggested fix
   (joined from `usePrReviews`' persisted `FindingRecord`) with Accept/Dismiss
   wired to the existing `useFindingAction` hook. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, Icon } from "@devdigest/ui";
import type { MultiAgentRun } from "@devdigest/shared";
import { usePrReviews } from "../../../../../lib/hooks/reviews";
import { themeForIndex } from "@/app/multi-agent/_shared/agentTheme";
import { AgentSummaryCard } from "./AgentSummaryCard";
import { FindingDetail } from "./FindingDetail";
import { findingsById as buildFindingsById, scoreColor } from "./helpers";
import { s } from "./styles";

export function MultiAgentTabs({ run, prId }: { run: MultiAgentRun; prId: string }) {
  const t = useTranslations("multiAgent");
  const columns = run.columns;

  const [activeRunId, setActiveRunId] = React.useState<string | undefined>(
    columns[0]?.run_id,
  );

  // Findings-list data fetching lives in the hook (usePrReviews) — this
  // component only joins the two shapes together, it never fetches directly.
  const reviewsQuery = usePrReviews(prId);
  const findingRecords = React.useMemo(
    () => buildFindingsById(reviewsQuery.data ?? []),
    [reviewsQuery.data],
  );

  if (columns.length === 0) return null;

  const activeIndex = Math.max(
    0,
    columns.findIndex((c) => c.run_id === activeRunId),
  );
  const activeColumn = columns[activeIndex] ?? columns[0]!;
  const activeTheme = themeForIndex(activeIndex);

  return (
    <div style={s.wrap}>
      <div style={s.tabRow}>
        {columns.map((c, i) => {
          const theme = themeForIndex(i);
          const TabIcon = Icon[theme.icon as keyof typeof Icon];
          const active = c.run_id === activeColumn.run_id;
          return (
            <button
              key={c.run_id}
              type="button"
              aria-pressed={active}
              onClick={() => setActiveRunId(c.run_id)}
              style={s.tab(active)}
            >
              <TabIcon size={14} aria-hidden="true" style={{ color: theme.accent }} />
              {c.agent_name} · <span style={s.tabScore(scoreColor(c.score))}>{c.score ?? "—"}</span>
            </button>
          );
        })}
      </div>

      <div style={s.body}>
        <AgentSummaryCard column={activeColumn} theme={activeTheme} />

        <div style={s.findingsList}>
          {activeColumn.findings.length === 0 ? (
            <EmptyState icon="Filter" title={t("tabs.noFindings")} />
          ) : (
            activeColumn.findings.map((f) => (
              <FindingDetail
                key={f.id}
                agentFinding={f}
                finding={findingRecords.get(f.id)}
                prId={prId}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
