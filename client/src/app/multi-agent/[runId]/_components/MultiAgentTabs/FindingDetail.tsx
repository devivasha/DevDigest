/* FindingDetail — one collapsible finding card in the Tabs view (AC-24/25).
   Collapsed: severity + bold title + category badge + chevron, then a second
   line with file:line and confidence. Expanded: description + suggested fix
   (untrusted model text, rendered only through the sanitizing `Markdown`
   primitive — never dangerouslySetInnerHTML) and the action row: Accept /
   Dismiss wired to the existing `useFindingAction` hook, plus Learn / Turn
   into eval case / Reply to author, which stay INERT stubs — no handler, no
   new endpoint (AC-26). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SeverityBadge, CategoryTag, Button, Markdown, type Category } from "@devdigest/ui";
import type { AgentColumnFinding, FindingRecord } from "@devdigest/shared";
import { useFindingAction } from "../../../../../lib/hooks/reviews";
import { confidencePct, lineLabel, severityBorderColor } from "./helpers";
import { s } from "./styles";

export function FindingDetail({
  agentFinding,
  finding,
  prId,
}: {
  /** Subset shape carried by the run payload's `AgentColumn.findings` — always available. */
  agentFinding: AgentColumnFinding;
  /** Full persisted record (confidence, suggestion, rationale, accept/dismiss
     timestamps), joined in from `usePrReviews` by id. `undefined` while it
     hasn't synced client-side yet. */
  finding: FindingRecord | undefined;
  prId: string;
}) {
  const t = useTranslations("multiAgent");
  const action = useFindingAction();
  const [expanded, setExpanded] = React.useState(false);

  const accepted = !!finding?.accepted_at;
  const dismissed = !!finding?.dismissed_at;
  const pending = action.isPending;

  return (
    <div
      style={s.card(severityBorderColor(agentFinding.severity))}
      data-finding-id={agentFinding.id}
    >
      <div style={s.cardHeader} onClick={() => setExpanded((e) => !e)}>
        <SeverityBadge severity={agentFinding.severity} compact />
        <div style={s.cardHeaderMain}>
          <div style={s.cardTitleRow}>
            <span style={s.cardTitle}>{agentFinding.title}</span>
            <CategoryTag category={agentFinding.category as Category} />
          </div>
          <div className="mono" style={s.cardMetaRow}>
            <span>
              {agentFinding.file}:
              {lineLabel({ start_line: agentFinding.start_line, end_line: finding?.end_line })}
            </span>
            {finding && (
              <span>{t("finding.confShort", { pct: confidencePct(finding.confidence) })}</span>
            )}
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.cardBody}>
          {!finding ? (
            <p style={s.loadingText}>{t("results.loading")}</p>
          ) : (
            <>
              <div style={s.prose}>
                <Markdown>{finding.rationale}</Markdown>
              </div>
              {finding.suggestion && (
                <div style={s.suggestionWrap}>
                  <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
                  <div style={s.prose}>
                    <Markdown>{finding.suggestion}</Markdown>
                  </div>
                </div>
              )}

              <div style={s.actions}>
                <Button
                  kind="secondary"
                  size="sm"
                  icon="Check"
                  active={accepted}
                  disabled={pending}
                  onClick={() => action.mutate({ findingId: finding.id, action: "accept", prId })}
                >
                  {t("finding.accept")}
                </Button>
                <Button
                  kind="ghost"
                  size="sm"
                  icon="X"
                  active={dismissed}
                  disabled={pending}
                  onClick={() => action.mutate({ findingId: finding.id, action: "dismiss", prId })}
                >
                  {t("finding.dismiss")}
                </Button>
                {/* Inert stubs — no backend exists yet for any of these three
                   (AC-26). Rendered disabled so the affordance is visible
                   without implying it works. */}
                <Button kind="ghost" size="sm" icon="Brain" disabled aria-label={t("finding.learn")}>
                  {t("finding.learn")}
                </Button>
                <Button
                  kind="ghost"
                  size="sm"
                  icon="FlaskConical"
                  disabled
                  aria-label={t("finding.turnIntoEvalCase")}
                >
                  {t("finding.turnIntoEvalCase")}
                </Button>
                <Button
                  kind="ghost"
                  size="sm"
                  icon="MessageSquare"
                  disabled
                  aria-label={t("finding.replyToAuthor")}
                >
                  {t("finding.replyToAuthor")}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
