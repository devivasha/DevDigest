/* EvalsTab — Agent editor "Evals" tab (T12, AC-19). EVAL METRICS row (recall
   / precision / citation with MetricDeltaBadge deltas + traces X/Y) and an
   "Eval cases (M/N passing)" list with run / edit / delete controls, "Run all
   evals" / "New eval case" / "View full dashboard" (→ /eval). Warns when the
   set is under the 8-case floor (AC-15).

   Per-case status: `useCaseStatuses` (`GET /agents/:id/eval-cases/status`)
   loads every case's LATEST persisted run on mount, so pass/fail icons
   render correctly even before any run happens *this session*. An
   in-session run (`lastTraces`, keyed by case name) takes precedence over
   the loaded status for a row once it has actually been (re)run in this
   visit — see `statusByCaseId`/`lastTraces` precedence in `EvalsTab`. The
   per-row play button runs THAT case alone via `useRunEvalCase`
   (`POST /agents/:id/eval-cases/:caseId/run`), not the whole set. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Icon, Skeleton, ErrorState, EmptyState, Badge } from "@devdigest/ui";
import { EvalExpectation } from "@devdigest/shared";
import type { EvalCase, EvalCaseInput, EvalPerTrace } from "@devdigest/shared";
import {
  EvalCaseEditorModal,
  MetricDeltaBadge,
  CasePassIcon,
  DegradedBadge,
} from "@/components/eval";
import {
  useEvalCases,
  useEvalDashboard,
  useRunEvalSet,
  useCreateEvalCase,
  useUpdateEvalCase,
  useDeleteEvalCase,
  useCaseStatuses,
  useRunEvalCase,
  type EvalCaseUpdateInput,
} from "@/lib/hooks/eval";

const MIN_CASES = 8;

function parseExpectation(raw: unknown): EvalExpectation | null {
  const result = EvalExpectation.safeParse(raw);
  return result.success ? result.data : null;
}

/** Best-effort read of the produced-finding count off a per-trace `actual`
   payload — shape isn't pinned on the wire (`EvalPerTrace.actual` is
   `unknown`), so this defensively checks the couple of shapes the server
   service is documented to persist. */
function readProducedCount(actual: unknown): number | null {
  if (!actual || typeof actual !== "object") return null;
  const obj = actual as Record<string, unknown>;
  if (Array.isArray(obj.produced)) return obj.produced.length;
  if (Array.isArray(obj.findings)) return obj.findings.length;
  return null;
}

function readDegraded(actual: unknown): boolean {
  if (!actual || typeof actual !== "object") return false;
  return (actual as Record<string, unknown>).degraded === true;
}

export function EvalsTab({ agentId, agentName }: { agentId: string; agentName?: string }) {
  const t = useTranslations("eval");
  const router = useRouter();

  const casesQuery = useEvalCases("agent", agentId);
  const dashboardQuery = useEvalDashboard("agent", agentId);
  const statusesQuery = useCaseStatuses(agentId);
  const runSet = useRunEvalSet(agentId);
  const runCase = useRunEvalCase(agentId);
  const createCase = useCreateEvalCase();
  const updateCase = useUpdateEvalCase();
  const deleteCase = useDeleteEvalCase();

  const [modalCase, setModalCase] = React.useState<EvalCase | "new" | null>(null);
  const [lastTraces, setLastTraces] = React.useState<Record<string, EvalPerTrace>>({});
  const [runningCaseId, setRunningCaseId] = React.useState<string | null>(null);

  const cases = casesQuery.data ?? [];
  const underMin = cases.length > 0 && cases.length < MIN_CASES;
  const statusByCaseId = new Map(statusesQuery.data?.map((s) => [s.case_id, s]) ?? []);

  const handleRunAll = () => {
    runSet.mutate(undefined, {
      onSuccess: (data) => {
        const map: Record<string, EvalPerTrace> = {};
        for (const trace of data.per_trace) map[trace.name] = trace;
        setLastTraces(map);
      },
    });
  };

  const handleSaveCase = async (
    input: EvalCaseInput,
    opts: { runOnSave: boolean },
  ) => {
    if (modalCase && modalCase !== "new") {
      const patch: EvalCaseUpdateInput = {
        name: input.name,
        input_diff: input.input_diff,
        input_files: input.input_files,
        input_meta: input.input_meta,
        expected_output: input.expected_output,
        notes: input.notes,
      };
      await updateCase.mutateAsync({ caseId: modalCase.id, ownerId: agentId, patch });
    } else {
      await createCase.mutateAsync(input);
    }
    setModalCase(null);
    if (opts.runOnSave) handleRunAll();
  };

  const handleDelete = (c: EvalCase) => {
    if (window.confirm(`Delete eval case "${c.name}"? This cannot be undone.`)) {
      deleteCase.mutate({ caseId: c.id, ownerId: agentId });
    }
  };

  if (casesQuery.isLoading || dashboardQuery.isLoading) {
    return (
      <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 12 }}>
        <Skeleton height={90} />
        <Skeleton height={48} />
        <Skeleton height={48} />
        <Skeleton height={48} />
      </div>
    );
  }

  if (casesQuery.isError || dashboardQuery.isError) {
    return (
      <ErrorState
        body={t("evalsTab.loadError")}
        onRetry={() => {
          casesQuery.refetch();
          dashboardQuery.refetch();
        }}
      />
    );
  }

  const dashboard = dashboardQuery.data;
  const tracesPassed = dashboard?.current.traces_passed ?? 0;
  const tracesTotal = dashboard?.current.traces_total ?? 0;

  return (
    <div style={{ padding: 28, maxWidth: 960 }}>
      {/* EVAL METRICS row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <Icon.FlaskConical size={14} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
            flex: 1,
          }}
        >
          {t("evalsTab.metricsTitle")}
        </span>
        <Button kind="ghost" size="sm" iconRight="ArrowRight" onClick={() => router.push("/eval")}>
          {t("evalsTab.viewDashboard")}
        </Button>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <MetricTile
          label={t("dashboard.metrics.recall")}
          value={dashboard ? Math.round(dashboard.current.recall * 100) : null}
          delta={dashboard?.delta.recall}
          color="var(--accent)"
        />
        <MetricTile
          label={t("dashboard.metrics.precision")}
          value={dashboard ? Math.round(dashboard.current.precision * 100) : null}
          delta={dashboard?.delta.precision}
          color="var(--ok)"
        />
        <MetricTile
          label={t("dashboard.metrics.citationAccuracy")}
          value={dashboard ? Math.round(dashboard.current.citation_accuracy * 100) : null}
          delta={dashboard?.delta.citation_accuracy}
          color="var(--warn)"
        />
        <div
          style={{
            flex: 1,
            minWidth: 140,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: 9,
            padding: 18,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.03em" }}>
            {t("evalsTab.tracesPassed")}
          </div>
          <div className="tnum" style={{ fontSize: 32, fontWeight: 700, marginTop: 12 }}>
            {tracesPassed}/{tracesTotal}
          </div>
        </div>
      </div>

      {underMin && (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 12px",
            borderRadius: 7,
            border: "1px solid var(--warn)",
            background: "var(--warn-bg)",
            fontSize: 12.5,
            color: "var(--warn)",
            marginBottom: 16,
          }}
        >
          <Icon.AlertOctagon size={14} aria-hidden="true" />
          {t("dashboard.underMin")}
        </div>
      )}

      {/* Eval cases list */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700 }}>{t("evalsTab.casesHeading")}</h2>
        <Badge color="var(--ok)" bg="var(--ok-bg)">
          {t("evalsTab.passingCount", { passing: tracesPassed, total: cases.length })}
        </Badge>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Button
            kind="secondary"
            size="sm"
            icon="Play"
            onClick={handleRunAll}
            disabled={runSet.isPending || cases.length === 0}
            loading={runSet.isPending}
          >
            {runSet.isPending ? t("evalsTab.running") : t("evalsTab.runAll")}
          </Button>
          <Button kind="primary" size="sm" icon="Plus" onClick={() => setModalCase("new")}>
            {t("evalsTab.newCase")}
          </Button>
        </div>
      </div>

      {cases.length === 0 ? (
        <EmptyState
          icon="FlaskConical"
          title={t("evalsTab.casesHeading")}
          body={t("evalsTab.emptyCases")}
          cta={t("evalsTab.newCase")}
          onCta={() => setModalCase("new")}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {cases.map((c) => {
            const sessionTrace = lastTraces[c.name];
            const status = statusByCaseId.get(c.id);
            const pass = sessionTrace ? sessionTrace.pass : (status?.pass ?? null);
            const producedCount = sessionTrace
              ? readProducedCount(sessionTrace.actual)
              : (status?.produced_count ?? null);
            const degraded = sessionTrace ? readDegraded(sessionTrace.actual) : (status?.degraded ?? false);
            const isRunning = runningCaseId === c.id || runSet.isPending;
            return (
              <EvalCaseRow
                key={c.id}
                evalCase={c}
                pass={pass}
                producedCount={producedCount}
                degraded={degraded}
                onRun={() => {
                  setRunningCaseId(c.id);
                  runCase.mutate({ caseId: c.id }, { onSettled: () => setRunningCaseId(null) });
                }}
                onEdit={() => setModalCase(c)}
                onDelete={() => handleDelete(c)}
                isRunning={isRunning}
              />
            );
          })}
        </div>
      )}

      {modalCase && (
        <EvalCaseEditorModal
          ownerKind="agent"
          ownerId={agentId}
          ownerName={agentName}
          evalCase={modalCase === "new" ? null : modalCase}
          lastRun={modalCase !== "new" ? statusByCaseId.get(modalCase.id) ?? null : null}
          onClose={() => setModalCase(null)}
          onSave={handleSaveCase}
          onRunCase={modalCase !== "new" ? () => runCase.mutate({ caseId: modalCase.id }) : undefined}
          isSaving={createCase.isPending || updateCase.isPending}
          isRunning={runCase.isPending}
        />
      )}
    </div>
  );
}

function MetricTile({
  label,
  value,
  delta,
  color,
}: {
  label: string;
  value: number | null;
  delta: number | null | undefined;
  color: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 140,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 9,
        padding: 18,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.03em" }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 12 }}>
        <span className="tnum" style={{ fontSize: 28, fontWeight: 700, color }}>
          {value == null ? "—" : `${value}%`}
        </span>
      </div>
      <div style={{ marginTop: 4 }}>
        <MetricDeltaBadge delta={delta} metricLabel={label} />
      </div>
    </div>
  );
}

function EvalCaseRow({
  evalCase,
  pass,
  producedCount,
  degraded,
  onRun,
  onEdit,
  onDelete,
  isRunning,
}: {
  evalCase: EvalCase;
  pass: boolean | null;
  producedCount: number | null;
  degraded: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isRunning: boolean;
}) {
  const t = useTranslations("eval");
  const expectation = parseExpectation(evalCase.expected_output);
  const expectedCount = expectation?.findings.length ?? 0;
  const firstFinding = expectation?.findings[0];
  const gotCount = producedCount;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--bg-elevated)",
      }}
    >
      <CasePassIcon pass={pass} compact />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }} className="mono">
          {evalCase.name}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {t("evalsTab.expectedGot", {
            expected: expectedCount,
            got: gotCount == null ? "—" : gotCount,
          })}
        </div>
      </div>
      {degraded && <DegradedBadge compact />}
      {firstFinding ? (
        <Badge color="var(--text-muted)">
          {firstFinding.severity} · {firstFinding.category}
        </Badge>
      ) : (
        <Badge color="var(--text-muted)">{t("evalsTab.emptyBrackets")}</Badge>
      )}
      <div style={{ display: "flex", gap: 4 }}>
        <Button
          kind="ghost"
          size="sm"
          icon="Play"
          aria-label={t("evalsTab.run")}
          onClick={onRun}
          disabled={isRunning}
          loading={isRunning}
        />
        <Button kind="ghost" size="sm" icon="Edit" aria-label={t("evalsTab.edit")} onClick={onEdit} />
        <Button kind="ghost" size="sm" icon="Trash" aria-label={t("evalsTab.delete")} onClick={onDelete} />
      </div>
    </div>
  );
}
