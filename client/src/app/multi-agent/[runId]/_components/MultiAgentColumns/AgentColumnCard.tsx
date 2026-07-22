/* AgentColumnCard — one agent's column: an accent-tinted header (icon tile,
   name, "{duration} · {cost}", score ring), a live status row (icon+text,
   never colour alone — AC-29), a list of finding mini-cards (severity icon +
   title + file:line, left-bordered by severity), and a footer with "View
   trace" + the findings count. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, CircularScore, Icon } from "@devdigest/ui";
import type { AgentColumn, RunEvent } from "@devdigest/shared";
import { themeForIndex } from "@/app/multi-agent/_shared/agentTheme";
import { STATUS_ICON, SEVERITY_BORDER_COLOR, SEVERITY_ICON } from "./constants";
import { formatCost, formatDuration, resolveColumnStatus } from "./helpers";
import { s } from "./styles";

export interface AgentColumnCardProps {
  column: AgentColumn;
  /** Ordinal position among the run's columns — selects this agent's accent
   * colour + icon (`themeForIndex`), consistent with Configure-run/Tabs. */
  index: number;
  /** All streamed events for the run(s) currently subscribed — filtered to
   * this column's run_id internally. */
  events: RunEvent[];
  onViewTrace: (runId: string) => void;
}

export function AgentColumnCard({ column, index, events, onViewTrace }: AgentColumnCardProps) {
  const t = useTranslations("multiAgent");
  const { status, failedReason } = resolveColumnStatus(column, events);
  const StatusIcon = STATUS_ICON[status];
  const statusText = t(`columns.status.${status}`);
  const theme = themeForIndex(index);
  const accent = theme.accent;
  const IconComp = Icon[theme.icon as keyof typeof Icon];
  const duration = formatDuration(column.duration_ms);
  const cost = formatCost(column.cost_usd);
  const metaText = [duration, cost ?? t("columns.costUnknown")].filter(Boolean).join(" · ");

  return (
    <section style={s.card(accent)} aria-label={column.agent_name}>
      <header style={s.header}>
        <div style={s.iconTile(accent)}>
          <IconComp size={16} aria-hidden="true" />
        </div>

        <div style={s.headerMain}>
          <h3 style={s.agentName}>{column.agent_name}</h3>
          <span style={s.metaLine}>{metaText}</span>

          <div
            role="status"
            aria-live="polite"
            aria-label={t("columns.statusAriaLabel", {
              agentName: column.agent_name,
              status: statusText,
            })}
            style={s.statusRow}
          >
            <StatusIcon size={14} aria-hidden="true" style={s.statusIcon(status)} />
            <span>{statusText}</span>
          </div>

          {status === "failed" && failedReason && (
            <p style={s.failedReason}>{t("columns.failedReason", { reason: failedReason })}</p>
          )}
        </div>

        {column.score != null && (
          <div style={s.scoreWrap}>
            <CircularScore score={column.score} size={36} />
          </div>
        )}
      </header>

      <div style={s.body}>
        <ul style={s.findingsList}>
          {column.findings.map((finding) => {
            const FindingIcon = SEVERITY_ICON[finding.severity];
            const severityColor = SEVERITY_BORDER_COLOR[finding.severity];
            return (
              <li key={finding.id} style={s.findingItem(severityColor)}>
                <div style={s.findingHeader}>
                  <FindingIcon
                    size={13}
                    aria-hidden="true"
                    style={{ color: severityColor, flexShrink: 0, marginTop: 1 }}
                  />
                  <span style={s.findingTitle}>{finding.title}</span>
                </div>
                <span style={s.findingFile}>
                  {finding.file}:{finding.start_line}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div style={s.footer}>
        <Button
          kind="ghost"
          size="sm"
          icon="ExternalLink"
          onClick={() => onViewTrace(column.run_id)}
          aria-label={t("columns.viewTraceAriaLabel", { agentName: column.agent_name })}
        >
          {t("columns.viewTrace")}
        </Button>
        <span>{t("columns.findingsCount", { count: column.findings.length })}</span>
      </div>
    </section>
  );
}
