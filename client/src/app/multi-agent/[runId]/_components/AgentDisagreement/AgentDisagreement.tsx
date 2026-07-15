/* AgentDisagreement — "Where agents disagree" block (T12).
   Presentational over `MultiAgentRun.conflicts`: each conflict group renders as
   a card with a horizontal grid of per-agent take columns showing that agent's
   verdict (severity, or "did not flag") by dot+text, plus a "Show only
   conflicts" toggle that hides agreement groups. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, Icon } from "@devdigest/ui";
import type { Conflict, ConflictTake } from "@devdigest/shared";
import { conflictKey, isConflictGroup, verdictDotColor, visibleConflicts } from "./helpers";
import { s } from "./styles";

function VerdictLine({ take }: { take: ConflictTake }) {
  const t = useTranslations("multiAgent");
  const color = verdictDotColor(take.verdict);

  return (
    <span style={s.verdictLine}>
      <span style={{ ...s.dot, background: color }} aria-hidden="true" />
      {take.verdict === "ignored" ? (
        <span style={s.didNotFlag}>
          <Icon.EyeOff size={12} aria-hidden="true" />
          {t("disagreement.didNotFlag")}
        </span>
      ) : (
        <span style={{ color }}>{take.verdict}</span>
      )}
    </span>
  );
}

function TakeColumn({ take }: { take: ConflictTake }) {
  return (
    <div style={s.takeColumn}>
      <span style={s.persona}>{take.persona}</span>
      <VerdictLine take={take} />
      {take.note && <span style={s.note}>{take.note}</span>}
    </div>
  );
}

function ConflictCard({ conflict }: { conflict: Conflict }) {
  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <Icon.Code size={13} aria-hidden="true" />
        <span style={s.location} className="mono">
          {conflict.file}:{conflict.line}
        </span>
        <span style={s.cardTitle}>{conflict.title}</span>
      </div>
      <div style={s.takesGrid}>
        {conflict.takes.map((take) => (
          <TakeColumn key={take.agent_id} take={take} />
        ))}
      </div>
    </div>
  );
}

export function AgentDisagreement({ conflicts }: { conflicts: Conflict[] }) {
  const t = useTranslations("multiAgent");
  const [showOnlyConflicts, setShowOnlyConflicts] = React.useState(false);

  const shown = visibleConflicts(conflicts, showOnlyConflicts);
  const conflictCount = conflicts.filter((c) => isConflictGroup(c.takes)).length;

  return (
    <section style={s.section}>
      <div style={s.header}>
        <div style={s.titleGroup}>
          <span style={s.title}>
            <Icon.Activity size={13} aria-hidden="true" />
            {t("disagreement.title")}
          </span>
          {conflicts.length > 0 && (
            <span style={s.count}>{t("disagreement.conflictsCount", { count: conflictCount })}</span>
          )}
        </div>
        {conflicts.length > 0 && (
          <button
            type="button"
            role="switch"
            aria-checked={showOnlyConflicts}
            onClick={() => setShowOnlyConflicts((v) => !v)}
            style={{ ...s.toggle, ...(showOnlyConflicts ? s.toggleActive : null) }}
          >
            <Icon.Filter size={13} aria-hidden="true" />
            {t("disagreement.showOnlyConflicts")}
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <EmptyState icon="Check" title={t("disagreement.emptyState")} />
      ) : (
        <div style={s.list}>
          {shown.map((conflict) => (
            <ConflictCard key={conflictKey(conflict)} conflict={conflict} />
          ))}
        </div>
      )}
    </section>
  );
}
