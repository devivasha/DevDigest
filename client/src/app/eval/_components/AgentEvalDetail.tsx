"use client";

/* AgentEvalDetail — single-agent Eval Dashboard detail (AC-21): 3 metric
   cards with MetricDeltaBadge deltas, a metric-trend line chart, a
   selectable Recent-runs table with a Compare control, a RegressionBanner
   (AC-14), and a "Run eval" action. Compare/regression are unavailable
   until a second run exists — this renders an omitted/empty state, never a
   crash (per T13 known gotcha). */

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Dropdown,
  EmptyState,
  ErrorState,
  Icon,
  Skeleton,
  type DropdownItemDef,
} from "@devdigest/ui";
import type { Agent, EvalSetRunRecord, EvalTrendPoint } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { RunCostBadge } from "@/components/RunCostBadge/RunCostBadge";
import { useAgent, useAgents } from "@/lib/hooks/agents";
import {
  useCompareRuns,
  useEvalDashboard,
  useRunEvalSet,
  useRunHistory,
} from "@/lib/hooks/eval";
import {
  CompareRunsModal,
  MetricDeltaBadge,
  MetricTrendChart,
  RegressionBanner,
} from "@/components/eval";

const MAX_COMPARE_SELECTION = 2;

/* Client-side date-range filter for the runs table + trend window — no
   server endpoint change; the range only narrows what's already fetched. */
type RangeKey = "d7" | "d30" | "d90" | "all";
const RANGE_KEYS: RangeKey[] = ["d7", "d30", "d90", "all"];
const RANGE_DAYS: Record<RangeKey, number | null> = { d7: 7, d30: 30, d90: 90, all: null };
const DEFAULT_RANGE: RangeKey = "d30";

function isWithinRange(isoDate: string, days: number | null, nowMs: number): boolean {
  if (days == null) return true;
  const ts = new Date(isoDate).getTime();
  return nowMs - ts <= days * 24 * 60 * 60 * 1000;
}

function formatPercent(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v * 100)}`;
}

function AgentPickerDropdown({
  currentName,
  agents,
  onSelect,
}: {
  currentName: string;
  agents: Agent[];
  onSelect: (agentId: string) => void;
}) {
  const t = useTranslations("eval");
  const items: DropdownItemDef[] = agents.map((a) => ({
    label: a.name,
    icon: "Cpu",
    onClick: () => onSelect(a.id),
  }));
  return (
    <Dropdown
      align="right"
      width={220}
      items={items}
      trigger={
        <Button kind="secondary" size="sm" icon="Cpu" iconRight="ChevronDown" aria-label={t("dashboard.selectAgent")}>
          {currentName}
        </Button>
      }
    />
  );
}

function DateRangeDropdown({ value, onChange }: { value: RangeKey; onChange: (key: RangeKey) => void }) {
  const t = useTranslations("eval");
  const items: DropdownItemDef[] = RANGE_KEYS.map((key) => ({
    label: t(`dashboard.range.${key}`),
    onClick: () => onChange(key),
  }));
  return (
    <Dropdown
      align="right"
      width={160}
      items={items}
      trigger={
        <Button kind="secondary" size="sm" icon="Calendar" iconRight="ChevronDown">
          {t(`dashboard.range.${value}`)}
        </Button>
      }
    />
  );
}

function MetricTile({
  label,
  value,
  delta,
  trend,
  color,
}: {
  label: string;
  value: number;
  delta: number;
  trend: number[];
  color: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 9,
        padding: 18,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.03em" }}>
          {label}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 12 }}>
        <span className="tnum" style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em", color }}>
          {formatPercent(value)}
          <span style={{ fontSize: 18, color: "var(--text-muted)" }}>%</span>
        </span>
        <MetricDeltaBadge delta={delta} metricLabel={label} />
      </div>
    </div>
  );
}

function RunRow({
  run,
  selected,
  selectable,
  onToggle,
}: {
  run: EvalSetRunRecord;
  selected: boolean;
  selectable: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("eval");
  return (
    <tr>
      <td style={{ padding: "8px 10px" }}>
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={t("dashboard.table.ranAt") + " " + new Date(run.ran_at).toLocaleString()}
          disabled={!selected && !selectable}
          onClick={onToggle}
          style={{
            width: 16,
            height: 16,
            borderRadius: 4,
            border: "1.5px solid " + (selected ? "var(--accent)" : "var(--border-strong)"),
            background: selected ? "var(--accent)" : "transparent",
            cursor: selectable || selected ? "pointer" : "not-allowed",
            opacity: !selected && !selectable ? 0.4 : 1,
          }}
        >
          {selected && <Icon.Check size={11} style={{ color: "var(--bg-primary)" }} />}
        </button>
      </td>
      <td style={{ padding: "8px 10px", fontSize: 12.5, color: "var(--text-secondary)" }}>
        {new Date(run.ran_at).toLocaleString()}
      </td>
      <td className="tnum" style={{ padding: "8px 10px", fontSize: 12.5, color: "var(--accent)" }}>
        v{run.version}
      </td>
      <td className="tnum" style={{ padding: "8px 10px", fontSize: 12.5 }}>
        {formatPercent(run.recall)}%
      </td>
      <td className="tnum" style={{ padding: "8px 10px", fontSize: 12.5 }}>
        {formatPercent(run.precision)}%
      </td>
      <td className="tnum" style={{ padding: "8px 10px", fontSize: 12.5 }}>
        {run.citation_accuracy == null ? t("dashboard.degraded.badge") : `${formatPercent(run.citation_accuracy)}%`}
      </td>
      <td className="tnum" style={{ padding: "8px 10px", fontSize: 12.5 }}>
        {run.traces_passed}/{run.traces_total}
      </td>
      <td style={{ padding: "8px 10px" }}>
        <RunCostBadge cost={run.cost_usd} />
      </td>
    </tr>
  );
}

export function AgentEvalDetail({
  agentId,
  onBack,
  onSelectAgent,
}: {
  agentId: string;
  onBack: () => void;
  onSelectAgent: (agentId: string) => void;
}) {
  const t = useTranslations("eval");
  const { data: agent, isLoading: agentLoading } = useAgent(agentId);
  const { data: agents } = useAgents();
  const { data: dashboard, isLoading: dashLoading, isError: dashError, refetch } = useEvalDashboard(
    "agent",
    agentId,
  );
  const { data: history, isLoading: historyLoading } = useRunHistory("agent", agentId);
  const runEval = useRunEvalSet(agentId);

  const [selectedRunIds, setSelectedRunIds] = React.useState<string[]>([]);
  const [compareOpen, setCompareOpen] = React.useState(false);
  const [rangeKey, setRangeKey] = React.useState<RangeKey>(DEFAULT_RANGE);

  const enabledAgents = React.useMemo(() => (agents ?? []).filter((a) => a.enabled), [agents]);

  const runs = history ?? [];
  const rangeDays = RANGE_DAYS[rangeKey];
  const nowMs = Date.now();
  // Range only narrows what's shown in the runs table + trend window — the
  // sub-header's run count always reflects the full history (spec).
  const visibleRuns = runs.filter((r) => isWithinRange(r.ran_at, rangeDays, nowMs));
  const visibleTrend: EvalTrendPoint[] = (dashboard?.trend ?? []).filter((p) =>
    isWithinRange(p.ran_at, rangeDays, nowMs),
  );

  // Changing the range can drop a selected run out of view — clear the
  // selection rather than leave a dangling/invisible compare candidate.
  function handleRangeChange(key: RangeKey) {
    setRangeKey(key);
    setSelectedRunIds([]);
  }

  // `useRunHistory` returns newest-first (server INSIGHTS); compare wants
  // base = older run, head = newer run.
  const [firstId, secondId] = selectedRunIds;
  const sortedSelected = React.useMemo(() => {
    const rows = visibleRuns.filter((r) => selectedRunIds.includes(r.id));
    return [...rows].sort((a, b) => new Date(a.ran_at).getTime() - new Date(b.ran_at).getTime());
  }, [visibleRuns, selectedRunIds]);
  const baseId = sortedSelected[0]?.id ?? firstId;
  const headId = sortedSelected[1]?.id ?? secondId;

  const compareQuery = useCompareRuns(
    agentId,
    compareOpen ? baseId : undefined,
    compareOpen ? headId : undefined,
  );

  function toggleRun(id: string) {
    setSelectedRunIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_COMPARE_SELECTION) return prev;
      return [...prev, id];
    });
  }

  const canCompare = selectedRunIds.length === MAX_COMPARE_SELECTION;
  const hasSecondRun = visibleRuns.length >= 2;

  const loading = agentLoading || dashLoading || historyLoading;

  return (
    <AppShell
      crumb={[
        { label: t("page.crumbSkillsLab") },
        { label: t("dashboard.defaultTitle"), href: "/eval" },
        { label: agent?.name ?? "…" },
      ]}
    >
      {compareOpen && compareQuery.data && (
        <CompareRunsModal compare={compareQuery.data} agentId={agentId} onClose={() => setCompareOpen(false)} />
      )}

      <div style={{ padding: 28, maxWidth: 1100, margin: "0 auto" }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: "none",
            border: "none",
            padding: 0,
            marginBottom: 14,
            fontSize: 13,
            color: "var(--text-muted)",
            cursor: "pointer",
          }}
        >
          <Icon.ChevronLeft size={14} aria-hidden="true" />
          {t("page.crumbEvalDashboard")}
        </button>

        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 6,
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em", margin: 0 }}>
                {agent?.name ?? "…"}
              </h1>
              {agent?.model && <Badge>{agent.model}</Badge>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <AgentPickerDropdown currentName={agent?.name ?? "…"} agents={enabledAgents} onSelect={onSelectAgent} />
            <DateRangeDropdown value={rangeKey} onChange={handleRangeChange} />
            <Button kind="primary" icon="Play" loading={runEval.isPending} onClick={() => runEval.mutate()}>
              {runEval.isPending
                ? t("dashboard.running")
                : t("dashboard.runEval", { count: dashboard?.cases_total ?? 0 })}
            </Button>
          </div>
        </div>

        {dashboard && (
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 18 }}>
            {t("dashboard.subheader", { runs: runs.length, cases: dashboard.cases_total })}
          </div>
        )}

        {dashboard?.alert && (
          <div style={{ marginBottom: 18 }}>
            <RegressionBanner alert={dashboard.alert} />
          </div>
        )}

        {dashLoading && (
          <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
            <Skeleton height={100} />
            <Skeleton height={100} />
            <Skeleton height={100} />
          </div>
        )}

        {dashError && <ErrorState body={t("dashboard.loading")} onRetry={() => refetch()} />}

        {dashboard && (
          <>
            <div style={{ display: "flex", gap: 12, marginBottom: 22 }}>
              <MetricTile
                label={t("dashboard.metrics.recall")}
                value={dashboard.current.recall}
                delta={dashboard.delta.recall}
                trend={dashboard.trend.map((p) => p.recall)}
                color="var(--accent)"
              />
              <MetricTile
                label={t("dashboard.metrics.precision")}
                value={dashboard.current.precision}
                delta={dashboard.delta.precision}
                trend={dashboard.trend.map((p) => p.precision)}
                color="var(--ok)"
              />
              <MetricTile
                label={t("dashboard.metrics.citationAccuracy")}
                value={dashboard.current.citation_accuracy}
                delta={dashboard.delta.citation_accuracy}
                trend={dashboard.trend.map((p) => p.citation_accuracy)}
                color="var(--warn)"
              />
            </div>

            <div
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: 9,
                padding: 18,
                marginBottom: 22,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.03em", marginBottom: 10 }}>
                {t("dashboard.metricTrend")}
              </div>
              <MetricTrendChart trend={visibleTrend} w={720} h={180} />
            </div>
          </>
        )}

        <div
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: 9,
            padding: 18,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.03em" }}>
              {t("dashboard.recentRuns")}
            </div>
            <Button
              kind="secondary"
              size="sm"
              icon="GitMerge"
              disabled={!canCompare}
              onClick={() => setCompareOpen(true)}
            >
              {t("dashboard.compare.title")}
            </Button>
          </div>

          {!hasSecondRun && visibleRuns.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
              {t("dashboard.compare.noSecondRun")}
            </div>
          )}

          {loading && runs.length === 0 ? (
            <Skeleton height={80} />
          ) : runs.length === 0 ? (
            <EmptyState icon="FlaskConical" title={t("dashboard.noRuns")} />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    <th style={{ padding: "6px 10px" }} />
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
                  {visibleRuns.map((run) => (
                    <RunRow
                      key={run.id}
                      run={run}
                      selected={selectedRunIds.includes(run.id)}
                      selectable={selectedRunIds.length < MAX_COMPARE_SELECTION}
                      onToggle={() => toggleRun(run.id)}
                    />
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
