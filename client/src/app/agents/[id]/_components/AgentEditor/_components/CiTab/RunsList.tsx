"use client";

/* RunsList — CI tab run-history table (AC-19). Scoped to one agent (via
   `useAgentCiRuns`), so unlike the workspace-wide CI Runs page this omits
   the "agent" column. Reuses the same icon+label status badge convention
   as the CI Runs page (`ciStatusMeta`) — never color alone. Each row calls
   `useTranslations` directly (it's already a `'use client'` leaf) rather
   than receiving `t`/`tCi` as props. */

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { CiRun } from "@/vendor/shared/contracts/eval-ci";
import { RunCostBadge } from "@/components/RunCostBadge/RunCostBadge";
import { ciStatusMeta } from "@/lib/ci-status";
import { formatDuration, safeHttpUrl } from "@/lib/utils";
import { s } from "./styles";

function RunRow({ run }: { run: CiRun }) {
  const t = useTranslations("agents");
  const tCi = useTranslations("ci");
  const meta = ciStatusMeta(run.status, tCi);
  const safeUrl = safeHttpUrl(run.github_url);
  return (
    <tr>
      <td className="tnum" style={s.td}>
        {run.pr_number != null ? `#${run.pr_number}` : "—"}
      </td>
      <td style={s.td}>
        <Badge icon={meta.icon} color={meta.color} bg={meta.bg}>
          {meta.label}
        </Badge>
      </td>
      <td className="tnum" style={s.td}>
        {run.findings_count ?? "—"}
      </td>
      <td style={s.td}>
        <RunCostBadge cost={run.cost_usd} />
      </td>
      <td className="tnum" style={s.td}>
        {formatDuration(run.duration_s)}
      </td>
      <td style={s.td}>
        {safeUrl ? (
          <a href={safeUrl} target="_blank" rel="noopener noreferrer" style={s.link}>
            {t("ciTab.runs.view")}
          </a>
        ) : (
          <span style={s.muted}>—</span>
        )}
      </td>
    </tr>
  );
}

export function RunsList({ runs }: { runs: CiRun[] }) {
  const t = useTranslations("agents");
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>{t("ciTab.runs.pullRequest")}</th>
            <th style={s.th}>{t("ciTab.runs.status")}</th>
            <th style={s.th}>{t("ciTab.runs.findings")}</th>
            <th style={s.th}>{t("ciTab.runs.cost")}</th>
            <th style={s.th}>{t("ciTab.runs.duration")}</th>
            <th style={s.th}>{t("ciTab.runs.view")}</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
