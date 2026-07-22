"use client";

/* CiRunsView — CI Runs page (T8, AC-15/16/17). Client component (data
   fetching, so `"use client"`; page.tsx stays a thin server component per
   next-best-practices). Fetches workspace-wide CI runs via `useCiRuns()`
   (T7) and renders one row per `CiRun` with PR number, repository, agent,
   verdict/status, findings count, cost, duration, and a link to the GitHub
   Actions job (AC-15). Status is always icon + text label, never color
   alone (WCAG non-functional requirement) — `no_findings` reads as a
   distinct PASSING outcome, not a failure (AC-17). Explicit empty state on
   `[]` (AC-16) and an explicit error state on query failure — never a
   blank/broken table. */

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { CiRun } from "@/vendor/shared/contracts/eval-ci";
import { AppShell } from "@/components/app-shell";
import { RunCostBadge } from "@/components/RunCostBadge/RunCostBadge";
import { useCiRuns } from "@/lib/hooks/ci";
import { ciStatusMeta } from "@/lib/ci-status";
import { formatDuration, safeHttpUrl } from "@/lib/utils";

type T = ReturnType<typeof useTranslations>;

const th: React.CSSProperties = { padding: "6px 10px", fontSize: 11, color: "var(--text-muted)", textAlign: "left" };
const td: React.CSSProperties = { padding: "8px 10px", fontSize: 12.5 };

function CiRunRow({ run, t }: { run: CiRun; t: T }) {
  const meta = ciStatusMeta(run.status, t);
  const repo = run.repo ?? null;
  const safeUrl = safeHttpUrl(run.github_url);

  return (
    <tr>
      <td className="tnum" style={td}>
        {run.pr_number != null ? `#${run.pr_number}` : "—"}
      </td>
      <td style={{ ...td, fontWeight: 600 }}>{repo ?? "—"}</td>
      <td style={td}>{run.agent ?? "—"}</td>
      <td style={td}>
        <Badge icon={meta.icon} color={meta.color} bg={meta.bg}>
          {meta.label}
        </Badge>
      </td>
      <td className="tnum" style={td}>
        {run.findings_count ?? "—"}
      </td>
      <td style={td}>
        <RunCostBadge cost={run.cost_usd} />
      </td>
      <td className="tnum" style={td}>
        {formatDuration(run.duration_s)}
      </td>
      <td style={td}>
        {safeUrl ? (
          <a
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}
          >
            {t("runs.view")}
          </a>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>—</span>
        )}
      </td>
    </tr>
  );
}

export function CiRunsView() {
  const t = useTranslations("ci");
  const { data: runs, isLoading, isError, refetch } = useCiRuns();

  return (
    <AppShell crumb={[{ label: t("page.crumb") }]}>
      <div style={{ padding: 28, maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ marginBottom: 22 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em", margin: 0 }}>{t("runs.title")}</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>{t("runs.subtitle")}</p>
        </div>

        <div
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: 9,
            padding: 18,
          }}
        >
          {isLoading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Skeleton height={40} />
              <Skeleton height={40} />
              <Skeleton height={40} />
            </div>
          )}

          {!isLoading && isError && <ErrorState onRetry={() => refetch()} />}

          {!isLoading && !isError && (runs?.length ?? 0) === 0 && (
            <EmptyState icon="Workflow" title={t("runs.emptyTitle")} body={t("runs.emptyBody")} />
          )}

          {!isLoading && !isError && (runs?.length ?? 0) > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>{t("runs.table.pullRequest")}</th>
                    <th style={th}>{t("runs.table.repository")}</th>
                    <th style={th}>{t("runs.table.agent")}</th>
                    <th style={th}>{t("runs.table.status")}</th>
                    <th style={th}>{t("runs.table.findings")}</th>
                    <th style={th}>{t("runs.table.cost")}</th>
                    <th style={th}>{t("runs.table.duration")}</th>
                    <th style={th}>{t("runs.view")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(runs ?? []).map((run) => (
                    <CiRunRow key={run.id} run={run} t={t} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
