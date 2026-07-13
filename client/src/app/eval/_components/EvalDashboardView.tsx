"use client";

/* EvalDashboardView — all-agents Eval Dashboard (AC-20): per-agent cards
   (name, model, last run vN, pass count, recall/precision/citation + a
   Sparkline trend), a "Run all agents" action, and a "Recent eval runs · all
   agents" table (one row per SET run — EvalSetRunRecord, not per-case,
   GAP-2). Selecting an agent card swaps in the single-agent detail view
   (AgentEvalDetail, AC-21) via local selection state — no new route. */

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  Skeleton,
  Sparkline,
} from "@devdigest/ui";
import type { Agent, EvalSetRunRecord } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { RunCostBadge } from "@/components/RunCostBadge/RunCostBadge";
import { useAgents } from "@/lib/hooks/agents";
import { useEvalDashboardAll, useRunAllAgents } from "@/lib/hooks/eval";
import { AgentEvalDetail } from "./AgentEvalDetail";

function formatPercent(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

interface AgentSummary {
  agent: Agent;
  latest: EvalSetRunRecord | null;
  trend: number[];
}

/** Derive per-agent summary cards from the workspace-wide recent_runs list —
    no dedicated per-agent-summary endpoint exists, so this groups the
    already-fetched EvalSetRunRecord[] by owner_id client-side. */
function buildAgentSummaries(agents: Agent[], recentRuns: EvalSetRunRecord[]): AgentSummary[] {
  return agents.map((agent) => {
    const rows = recentRuns
      .filter((r) => r.owner_id === agent.id)
      .slice()
      .sort((a, b) => new Date(a.ran_at).getTime() - new Date(b.ran_at).getTime());
    return {
      agent,
      latest: rows.length > 0 ? rows[rows.length - 1]! : null,
      trend: rows.map((r) => r.recall),
    };
  });
}

/** Small uppercase muted section label with a leading icon (e.g. "⊞ AGENTS")
    matching the mockup's section-header treatment above the agent cards and
    the recent-runs table. */
function SectionHeading({ icon, children }: { icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>; children: React.ReactNode }) {
  const IconComp = icon;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
      <IconComp size={12} style={{ color: "var(--text-muted)" }} />
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text-muted)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        {children}
      </span>
    </div>
  );
}

function MetricMini({ label, value, color }: { label: string; value: number | null | undefined; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 56 }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.04em" }}>
        {label}
      </span>
      <span className="tnum" style={{ fontSize: 15, fontWeight: 700, color }}>
        {formatPercent(value)}
      </span>
    </div>
  );
}

function AgentSummaryCard({ summary, onSelect }: { summary: AgentSummary; onSelect: () => void }) {
  const t = useTranslations("eval");
  const { agent, latest, trend } = summary;

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        width: "100%",
        textAlign: "left",
        padding: "14px 16px",
        borderRadius: 9,
        border: "1px solid var(--border)",
        background: "var(--bg-elevated)",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          <Icon.Cpu size={16} style={{ color: "var(--accent)" }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{agent.name}</span>
            <Badge>{agent.model}</Badge>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            {latest ? (
              <span className="tnum">
                v{latest.version} · {latest.traces_passed}/{latest.traces_total} {t("dashboard.table.pass").toLowerCase()}
              </span>
            ) : (
              t("evalsTab.neverRun")
            )}
          </div>
        </div>
      </div>

      {trend.length > 1 && <Sparkline data={trend} w={64} h={22} color="var(--accent)" />}

      <div style={{ display: "flex", gap: 18 }}>
        <MetricMini label={t("dashboard.metrics.recall")} value={latest?.recall} color="var(--accent)" />
        <MetricMini label={t("dashboard.metrics.precision")} value={latest?.precision} color="var(--ok)" />
        <MetricMini label={t("dashboard.metrics.citationAccuracy")} value={latest?.citation_accuracy} color="var(--warn)" />
      </div>

      <Icon.ChevronRight size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} aria-hidden="true" />
    </button>
  );
}

export function EvalDashboardView() {
  const t = useTranslations("eval");
  // Reuses the existing `nav.agents` ("Agents") string for the recent-runs
  // table's owner column — `eval.json` is read-only for this task (T13);
  // borrowing an already-translated label from another namespace avoids
  // inventing a new eval.json key or hardcoding English.
  const tShell = useTranslations("shell");
  const { data: agents, isLoading: agentsLoading, isError: agentsError, refetch: refetchAgents } = useAgents();
  const {
    data: dashboard,
    isLoading: dashLoading,
    isError: dashError,
    refetch: refetchDashboard,
  } = useEvalDashboardAll();
  const runAll = useRunAllAgents();

  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(null);

  if (selectedAgentId) {
    return (
      <AgentEvalDetail
        agentId={selectedAgentId}
        onBack={() => setSelectedAgentId(null)}
        onSelectAgent={setSelectedAgentId}
      />
    );
  }

  const isLoading = agentsLoading || dashLoading;
  const isError = agentsError || dashError;
  const agentList = agents ?? [];
  const recentRuns = dashboard?.recent_runs ?? [];
  // Only agents with an eval set (>0 eval cases) get a card — the other
  // agents have never been run and would otherwise show a stale seeded
  // model badge (see EvalDashboardView task notes).
  const caseCounts = dashboard?.owner_case_counts ?? {};
  const evaluableAgents = agentList.filter((a) => (caseCounts[a.id] ?? 0) > 0);
  const summaries = buildAgentSummaries(evaluableAgents, recentRuns);
  const agentNameFor = (ownerId: string) => agentList.find((a) => a.id === ownerId)?.name ?? ownerId;

  return (
    <AppShell crumb={[{ label: t("page.crumbSkillsLab") }, { label: t("dashboard.defaultTitle") }]}>
      <div style={{ padding: 28, maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 22 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em", margin: 0 }}>
              {t("dashboard.defaultTitle")}
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
              {t("dashboard.allSubheader")}
            </p>
          </div>
          <Button
            kind="primary"
            icon="Play"
            loading={runAll.isPending}
            disabled={evaluableAgents.length === 0}
            onClick={() => runAll.mutate(evaluableAgents.map((a) => a.id))}
          >
            {runAll.isPending ? t("dashboard.running") : t("dashboard.runEval", { count: evaluableAgents.length })}
          </Button>
        </div>

        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
            <Skeleton height={70} />
            <Skeleton height={70} />
            <Skeleton height={70} />
          </div>
        )}

        {isError && (
          <ErrorState
            body={t("dashboard.loading")}
            onRetry={() => {
              refetchAgents();
              refetchDashboard();
            }}
          />
        )}

        {!isLoading && !isError && evaluableAgents.length === 0 && (
          <EmptyState icon="Cpu" title={t("dashboard.noRuns")} />
        )}

        {!isLoading && !isError && evaluableAgents.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <SectionHeading icon={Icon.Cpu}>{t("dashboard.agentsHeading")}</SectionHeading>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {summaries.map((summary) => (
                <AgentSummaryCard
                  key={summary.agent.id}
                  summary={summary}
                  onSelect={() => setSelectedAgentId(summary.agent.id)}
                />
              ))}
            </div>
          </div>
        )}

        <div
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: 9,
            padding: 18,
          }}
        >
          <SectionHeading icon={Icon.History}>{t("dashboard.recentRunsAll")}</SectionHeading>

          {!isLoading && recentRuns.length === 0 ? (
            <EmptyState icon="FlaskConical" title={t("dashboard.noRuns")} />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    <th style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-muted)" }}>
                      {tShell("nav.agents")}
                    </th>
                    <th style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-muted)" }}>
                      {t("dashboard.table.ranAt")}
                    </th>
                    <th style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-muted)" }}>v</th>
                    <th style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-muted)" }}>
                      {t("dashboard.table.recall")}
                    </th>
                    <th style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-muted)" }}>
                      {t("dashboard.table.precision")}
                    </th>
                    <th style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-muted)" }}>
                      {t("dashboard.table.citation")}
                    </th>
                    <th style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-muted)" }}>
                      {t("dashboard.table.pass")}
                    </th>
                    <th style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-muted)" }}>
                      {t("dashboard.table.cost")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentRuns.map((run) => (
                    <tr key={run.id}>
                      <td style={{ padding: "8px 10px", fontSize: 12.5, fontWeight: 600 }}>
                        {agentNameFor(run.owner_id)}
                      </td>
                      <td style={{ padding: "8px 10px", fontSize: 12.5, color: "var(--text-secondary)" }}>
                        {new Date(run.ran_at).toLocaleString()}
                      </td>
                      <td className="tnum" style={{ padding: "8px 10px", fontSize: 12.5, color: "var(--accent)" }}>
                        v{run.version}
                      </td>
                      <td className="tnum" style={{ padding: "8px 10px", fontSize: 12.5 }}>
                        {formatPercent(run.recall)}
                      </td>
                      <td className="tnum" style={{ padding: "8px 10px", fontSize: 12.5 }}>
                        {formatPercent(run.precision)}
                      </td>
                      <td className="tnum" style={{ padding: "8px 10px", fontSize: 12.5 }}>
                        {run.citation_accuracy == null ? t("dashboard.degraded.badge") : formatPercent(run.citation_accuracy)}
                      </td>
                      <td className="tnum" style={{ padding: "8px 10px", fontSize: 12.5 }}>
                        {run.traces_passed}/{run.traces_total}
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        <RunCostBadge cost={run.cost_usd} />
                      </td>
                    </tr>
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
