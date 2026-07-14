"use client";

/* CompareRunsModal — AC-13: compare exactly two EvalSetRunRecords, showing
   signed metric deltas + the two runs' system-prompt diff, plus a "Promote"
   action that adopts the HEAD (newer) run's prompt + model as the agent's
   active config via PUT /agents/:id (which bumps the agent version). */

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Button } from "@devdigest/ui";
import type { EvalCompare } from "@devdigest/shared";
import { useUpdateAgent } from "@/lib/hooks/agents";
import { notify } from "@/lib/contexts/toast";
import { RunCostBadge } from "@/components/RunCostBadge/RunCostBadge";
import { MetricDeltaBadge } from "./MetricDeltaBadge";
import { DegradedBadge } from "./DegradedBadge";

export interface CompareRunsModalProps {
  compare: EvalCompare;
  /** The agent whose config gets updated when the head run is promoted. */
  agentId: string;
  onClose: () => void;
}

function formatPercent(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

/** Line-level diff (LCS) between the two system prompts, rendered as an
    old/new unified-style list — text prefix (−/+) carries the signal, not
    just strikethrough/colour (AC-23 spirit applied to the prompt diff too). */
type PromptDiffLine = { type: "same" | "add" | "remove"; text: string; key: string };

function diffPromptLines(base: string, head: string): PromptDiffLine[] {
  const a = base.split("\n");
  const b = head.split("\n");
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? (dp[i + 1]?.[j + 1] ?? 0) + 1 : Math.max(dp[i + 1]?.[j] ?? 0, dp[i]?.[j + 1] ?? 0);
    }
  }
  const result: PromptDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ type: "same", text: a[i]!, key: `s${i}-${j}` });
      i++;
      j++;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      result.push({ type: "remove", text: a[i]!, key: `r${i}` });
      i++;
    } else {
      result.push({ type: "add", text: b[j]!, key: `a${j}` });
      j++;
    }
  }
  while (i < n) result.push({ type: "remove", text: a[i]!, key: `r${i++}` });
  while (j < m) result.push({ type: "add", text: b[j]!, key: `a${j++}` });
  return result;
}

/** Legend row above the prompt diff — old/new carried by a colour swatch
    PLUS a text label (v{n} (old)/(new)), never colour alone (AC-23 spirit),
    matching the remove=crit / add=ok colours used inside the diff itself. */
function DiffLegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)" }}>
      <span
        aria-hidden="true"
        style={{ width: 10, height: 10, borderRadius: 3, background: color, display: "inline-block" }}
      />
      {label}
    </span>
  );
}

function PromptDiffView({ base, head }: { base: string; head: string }) {
  const lines = React.useMemo(() => diffPromptLines(base, head), [base, head]);
  return (
    <pre
      className="mono"
      style={{
        margin: 0,
        padding: "12px 14px",
        borderRadius: 7,
        border: "1px solid var(--border)",
        background: "var(--bg-elevated)",
        fontSize: 12.5,
        lineHeight: 1.6,
        maxHeight: 260,
        overflow: "auto",
        whiteSpace: "pre-wrap",
      }}
    >
      {lines.map((line) => {
        const prefix = line.type === "add" ? "+ " : line.type === "remove" ? "− " : "  ";
        const style: React.CSSProperties =
          line.type === "add"
            ? { color: "var(--ok)", fontWeight: 600 }
            : line.type === "remove"
              ? { color: "var(--crit)", textDecoration: "line-through", opacity: 0.75 }
              : { color: "var(--text-secondary)" };
        return (
          <div key={line.key} style={style}>
            {prefix}
            {line.text}
          </div>
        );
      })}
    </pre>
  );
}

function CompareMetricTile({
  label,
  base,
  head,
  delta,
  degraded,
}: {
  label: string;
  base: number | null;
  head: number | null;
  delta: number | null;
  degraded?: boolean;
}) {
  return (
    <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.04em" }}>
        {label}
      </div>
      {degraded ? (
        <div style={{ marginTop: 8 }}>
          <DegradedBadge compact />
        </div>
      ) : (
        <div className="tnum" style={{ marginTop: 6, fontSize: 14, color: "var(--text-secondary)" }}>
          {formatPercent(base)} <span aria-hidden="true">→</span>{" "}
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)" }}>{formatPercent(head)}</span>
        </div>
      )}
      <div style={{ marginTop: 6 }}>
        <MetricDeltaBadge delta={delta} metricLabel={label} />
      </div>
    </div>
  );
}

function CompareCostTile({ label, base, head, delta }: { label: string; base: number | null; head: number | null; delta: number | null }) {
  return (
    <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div style={{ marginTop: 6, fontSize: 14, display: "flex", alignItems: "baseline", gap: 6 }}>
        <RunCostBadge cost={base} />
        <span aria-hidden="true" style={{ color: "var(--text-muted)" }}>
          →
        </span>
        <span style={{ fontSize: 17, fontWeight: 700 }}>
          <RunCostBadge cost={head} />
        </span>
      </div>
      <div style={{ marginTop: 6 }}>
        <MetricDeltaBadge delta={delta} format="currency" metricLabel={label} />
      </div>
    </div>
  );
}

export function CompareRunsModal({ compare, agentId, onClose }: CompareRunsModalProps) {
  const t = useTranslations("eval");
  const { base, head, delta, prompt_diff } = compare;
  const promote = useUpdateAgent();

  const handlePromote = () => {
    promote.mutate(
      { id: agentId, patch: { system_prompt: head.system_prompt, model: head.model } },
      {
        onSuccess: () => {
          notify.success(t("dashboard.compare.promoted", { v: head.version }));
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      width={820}
      title={t("dashboard.compare.titleVersions", { base: base.version, head: head.version })}
      subtitle={t("dashboard.compare.subtitle")}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-start", gap: 8 }}>
          <Button kind="secondary" onClick={onClose} disabled={promote.isPending}>
            {t("dashboard.compare.close")}
          </Button>
          <Button kind="primary" icon="GitBranch" onClick={handlePromote} loading={promote.isPending}>
            {t("dashboard.compare.promote", { v: head.version })}
          </Button>
        </div>
      }
    >
      <div style={{ padding: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <CompareMetricTile
            label={t("dashboard.metrics.recall")}
            base={base.recall}
            head={head.recall}
            delta={delta.recall}
          />
          <CompareMetricTile
            label={t("dashboard.metrics.precision")}
            base={base.precision}
            head={head.precision}
            delta={delta.precision}
          />
          <CompareMetricTile
            label={t("dashboard.metrics.citationAccuracy")}
            base={base.citation_accuracy}
            head={head.citation_accuracy}
            delta={delta.citation_accuracy}
            degraded={base.citation_accuracy == null || head.citation_accuracy == null}
          />
          <CompareCostTile label={t("dashboard.table.cost")} base={base.cost_usd} head={head.cost_usd} delta={delta.cost_usd} />
        </div>

        <div style={{ marginTop: 22 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.03em", marginBottom: 8 }}>
            {t("dashboard.compare.promptDiff")}
          </div>
          <div style={{ display: "flex", gap: 14, marginBottom: 8 }}>
            <DiffLegendChip color="var(--crit)" label={t("dashboard.compare.legendOld", { v: base.version })} />
            <DiffLegendChip color="var(--ok)" label={t("dashboard.compare.legendNew", { v: head.version })} />
          </div>
          <PromptDiffView base={prompt_diff.base_prompt} head={prompt_diff.head_prompt} />
        </div>
      </div>
    </Modal>
  );
}
