/* ResultsView — the interactive body of /multi-agent/[runId] (T14).
   Loads the persisted multi-agent run (`useMultiAgentRun`, reload-safe —
   AC-11) and renders a keyboard-operable Columns↔Tabs view-mode toggle
   carried in the `?view=` query param over that SAME loaded run: switching
   modes only ever rewrites the query string, it never re-triggers a run
   (AC-23). `AgentDisagreement` (+ its own "Show only conflicts" toggle) is
   mounted ONCE, outside the mode switch, so it is identical in both modes
   (AC-27) by construction. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton, ErrorState, Button, Icon } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useMultiAgentRun } from "@/lib/hooks/multiAgent";
import { useRunEvents } from "@/lib/hooks/reviews";
import { ApiError } from "@/lib/api";
import { MultiAgentColumns } from "./MultiAgentColumns";
import { MultiAgentTabs } from "./MultiAgentTabs";
import { AgentDisagreement } from "./AgentDisagreement";
import { formatRunCost, formatRunDuration } from "./ResultsView.helpers";

const VIEW_PARAM = "view";
type ViewMode = "columns" | "tabs";

function parseViewMode(raw: string | null): ViewMode {
  return raw === "tabs" ? "tabs" : "columns";
}

const MONO_FONT = "var(--font-mono, ui-monospace, monospace)";

/* Compact segmented control for the Columns↔Tabs toggle. Plain buttons (no
   icons) so their accessible name is exactly the label text — keeps AC-23's
   `getByRole("button", { name: "Tabs" })`-style queries stable. */
function ViewModeToggle({
  mode,
  onChange,
  columnsLabel,
  tabsLabel,
  ariaLabel,
}: {
  mode: ViewMode;
  onChange: (next: ViewMode) => void;
  columnsLabel: string;
  tabsLabel: string;
  ariaLabel: string;
}) {
  const options: { key: ViewMode; label: string }[] = [
    { key: "columns", label: columnsLabel },
    { key: "tabs", label: tabsLabel },
  ];
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        padding: 3,
        gap: 2,
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--bg-elevated)",
        flexShrink: 0,
      }}
    >
      {options.map((opt) => {
        const active = mode === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            style={{
              padding: "5px 12px",
              fontSize: 12.5,
              fontWeight: active ? 600 : 500,
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              background: active ? "var(--bg-hover)" : "transparent",
              color: active ? "var(--text-primary)" : "var(--text-secondary)",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function ResultsView({ runId }: { runId: string }) {
  const t = useTranslations("multiAgent");
  const router = useRouter();
  const search = useSearchParams();
  const qc = useQueryClient();

  const mode = parseViewMode(search.get(VIEW_PARAM));

  const { data: run, isLoading, isError, error, refetch } = useMultiAgentRun(runId);

  // Only running columns need a live subscription — done/failed columns
  // already carry their terminal state from the persisted read (same
  // filtering MultiAgentColumns applies internally for its own status icon).
  const runningRunIds = React.useMemo(
    () => (run?.columns ?? []).filter((c) => c.status === "running").map((c) => c.run_id),
    [run?.columns],
  );
  const { events } = useRunEvents(runningRunIds);

  // The read endpoint (useMultiAgentRun) is the single source of truth for
  // rendered column/conflict data. The live stream here is only used to know
  // WHEN a running column has settled, so the persisted run is refetched once
  // per run id that reports a terminal event — never rendered off the stream
  // itself, so a reload always shows the same reload-safe data (AC-11).
  const refetchedRunIds = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    for (const event of events) {
      const terminal = event.kind === "result" || event.kind === "error";
      if (terminal && !refetchedRunIds.current.has(event.runId)) {
        refetchedRunIds.current.add(event.runId);
        qc.invalidateQueries({ queryKey: ["multi-agent-run", runId] });
      }
    }
  }, [events, qc, runId]);

  const setMode = React.useCallback(
    (next: ViewMode) => {
      const params = new URLSearchParams(search.toString());
      if (next === "columns") params.delete(VIEW_PARAM);
      else params.set(VIEW_PARAM, next);
      const qs = params.toString();
      // Rewrites the query string over the SAME already-loaded run only — it
      // must never call the launch mutation (AC-23).
      router.replace(`/multi-agent/${runId}${qs ? `?${qs}` : ""}`);
    },
    [router, runId, search],
  );

  const crumb = [{ label: t("results.title") }];

  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div
          style={{
            padding: "28px 32px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            maxWidth: 1080,
            margin: "0 auto",
          }}
        >
          <p role="status">{t("results.loading")}</p>
          <Skeleton height={28} width={320} />
          <Skeleton height={220} />
        </div>
      </AppShell>
    );
  }

  if (isError || !run) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("results.errorTitle")}
          body={error instanceof ApiError ? error.message : undefined}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  // "Restored from the last known status" (AC-11 spirit): a column still
  // shows `running` from the persisted read but no live SSE frame has arrived
  // yet for it this page-load — e.g. a reload dropped the in-memory stream
  // (spec-accepted: live SSE is not resumable across a restart).
  const hasRunningColumn = run.columns.some((c) => c.status === "running");
  const showRestoredNotice = hasRunningColumn && events.length === 0;

  return (
    <AppShell crumb={crumb}>
      <div
        style={{
          padding: "24px 32px 44px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
          maxWidth: 1080,
          margin: "0 auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Button
              kind="ghost"
              size="sm"
              icon="Settings"
              onClick={() => router.push("/multi-agent")}
            >
              {t("results.configureRun")}
            </Button>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, color: "var(--text-primary)" }}>
                {t("results.title")}
              </h1>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "2px 0 0" }}>
                {t("results.subtitleAgents", { count: run.agent_count })}
              </p>
            </div>
          </div>

          <ViewModeToggle
            mode={mode}
            onChange={setMode}
            columnsLabel={t("viewMode.columns")}
            tabsLabel={t("viewMode.tabs")}
            ariaLabel={t("viewMode.toggleAriaLabel")}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div>
            {run.pr_number != null && (
              <span style={{ fontSize: 12.5, color: "var(--text-muted)", fontFamily: MONO_FONT }}>
                #{run.pr_number}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Icon.Cpu size={13} style={{ color: "var(--text-muted)" }} />
            <span style={{ fontSize: 12.5, color: "var(--text-muted)", fontFamily: MONO_FONT }}>
              {t("results.metaLine", {
                count: run.agent_count,
                duration: formatRunDuration(run.total_duration_ms),
                cost: formatRunCost(run.total_cost_usd),
              })}
            </span>
          </div>
        </div>

        {showRestoredNotice && (
          <p role="status" style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
            {t("results.restoredNotice")}
          </p>
        )}

        {mode === "columns" ? (
          <MultiAgentColumns columns={run.columns} prNumber={run.pr_number ?? null} />
        ) : (
          <MultiAgentTabs run={run} prId={run.pr_id} />
        )}

        <AgentDisagreement conflicts={run.conflicts} />
      </div>
    </AppShell>
  );
}

export default ResultsView;
