"use client";

/* EvalCaseEditorModal — AC-22: Name field, an Input with Diff/Files/PR-meta
   tabs showing the stored diff, an Expected-output editor validated as valid
   JSON against `EvalExpectation` (blocks Save on invalid — GAP-4), a
   "Run on save" toggle, Cancel/Run case/Save, and a last-run badge.

   Presentational + local form state only — case creation/update/run are
   delegated to the caller via `onSave`/`onRunCase` props (mirrors
   `CreateAgentModal`'s pattern of calling a mutation directly, but this modal
   is shared by both the Evals tab (T12) and the dashboard (T13), and no
   single-case run endpoint exists yet — only `POST /agents/:id/eval-runs`
   for the whole set — so the actual mutation wiring stays with the caller). */

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Tabs, Button, FormField, TextInput, Textarea, Toggle, Badge, Icon } from "@devdigest/ui";
import { EvalExpectation } from "@devdigest/shared";
import type { EvalCase, EvalCaseInput, EvalCaseStatus, EvalOwnerKind } from "@devdigest/shared";
import { RunCostBadge } from "@/components/RunCostBadge/RunCostBadge";

type InputTabKey = "diff" | "files" | "prMeta";

const SKELETON_FINDING = {
  file: "",
  start_line: 1,
  end_line: 1,
  severity: "WARNING" as const,
  category: "bug" as const,
  title: "",
};

function defaultExpectedOutputText(): string {
  return JSON.stringify({ kind: "must_find", findings: [] }, null, 2);
}

type ExpectedOutputValidation = { valid: true; value: EvalExpectation } | { valid: false };

/** Parse + validate the Expected-output textarea against `EvalExpectation` (AC-22). */
function validateExpectedOutput(text: string): ExpectedOutputValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { valid: false };
  }
  const result = EvalExpectation.safeParse(parsed);
  return result.success ? { valid: true, value: result.data } : { valid: false };
}

function readMetaField(meta: unknown, key: "title" | "body"): string {
  if (meta && typeof meta === "object" && key in (meta as Record<string, unknown>)) {
    const v = (meta as Record<string, unknown>)[key];
    return typeof v === "string" ? v : "";
  }
  return "";
}

function extractFilePaths(diff: string): string[] {
  const paths = new Set<string>();
  for (const line of diff.split("\n")) {
    const m = /^\+\+\+ b\/(.+)$/.exec(line) ?? /^diff --git a\/.+ b\/(.+)$/.exec(line);
    if (m?.[1]) paths.add(m[1]);
  }
  return Array.from(paths);
}

/** Seconds (no unit suffix) — the `resultSummary` i18n template appends "s" itself. */
function formatDurationSeconds(ms: number | null): string {
  if (ms == null) return "—";
  return (ms / 1000).toFixed(1);
}

function DiffTabContent({ value, onChange, t }: { value: string; onChange: (v: string) => void; t: ReturnType<typeof useTranslations> }) {
  return <Textarea value={value} onChange={onChange} placeholder={t("caseEditor.diffPlaceholder")} rows={16} mono />;
}

function FilesTabContent({ diff }: { diff: string }) {
  const files = React.useMemo(() => extractFilePaths(diff), [diff]);
  if (files.length === 0) {
    // No dedicated "no files" copy exists in the `eval` i18n namespace yet —
    // reuse the codebase's "–" empty-value convention (see RunCostBadge)
    // rather than inventing untranslated English text.
    return <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 2px" }}>–</div>;
  }
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {files.map((f) => (
        <li
          key={f}
          className="mono"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            padding: "6px 2px",
            borderBottom: "1px solid var(--border)",
            color: "var(--text-secondary)",
          }}
        >
          <Icon.FileText size={13} aria-hidden="true" style={{ color: "var(--text-muted)" }} />
          {f}
        </li>
      ))}
    </ul>
  );
}

function PrMetaTabContent({
  title,
  body,
  onTitleChange,
  onBodyChange,
  t,
}: {
  title: string;
  body: string;
  onTitleChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div>
      <FormField label={t("caseEditor.titleLabel")}>
        <TextInput value={title} onChange={onTitleChange} placeholder={t("caseEditor.titlePlaceholder")} />
      </FormField>
      <FormField label={t("caseEditor.bodyLabel")}>
        <Textarea value={body} onChange={onBodyChange} placeholder={t("caseEditor.bodyPlaceholder")} rows={6} />
      </FormField>
    </div>
  );
}

function LastRunBadge({
  status,
  expected,
  t,
}: {
  status: EvalCaseStatus;
  expected: number;
  t: ReturnType<typeof useTranslations>;
}) {
  const passed = status.pass === true;
  const degraded = status.degraded;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginTop: 12,
        padding: "9px 12px",
        borderRadius: 7,
        border: `1px solid ${passed ? "var(--ok)" : "var(--crit)"}`,
        background: passed ? "var(--ok-bg)" : "var(--crit-bg)",
        fontSize: 12.5,
      }}
    >
      {passed ? (
        <Icon.CheckCircle size={14} style={{ color: "var(--ok)" }} aria-hidden="true" />
      ) : (
        <Icon.XCircle size={14} style={{ color: "var(--crit)" }} aria-hidden="true" />
      )}
      <span style={{ fontWeight: 600 }}>{passed ? t("caseEditor.lastRunPassed") : t("caseEditor.lastRunFailed")}</span>
      <span className="tnum" style={{ color: "var(--text-muted)" }}>
        {t("caseEditor.lastRunSummary", {
          expected,
          got: status.produced_count == null ? "—" : status.produced_count,
          duration: formatDurationSeconds(status.duration_ms),
        })}
      </span>
      <span aria-hidden="true" style={{ color: "var(--text-muted)" }}>
        ·
      </span>
      <RunCostBadge cost={status.cost_usd} />
      {degraded && (
        <span style={{ color: "var(--warn)" }}>· {t("dashboard.degraded.badge")}</span>
      )}
    </div>
  );
}

export interface EvalCaseEditorModalProps {
  ownerKind: EvalOwnerKind;
  ownerId: string;
  /** Display name of the owning agent — shown in the modal sub-header. */
  ownerName?: string;
  /** Omit/undefined = creating a new case; pass the existing case to edit it. */
  evalCase?: EvalCase | null;
  onClose: () => void;
  onSave: (input: EvalCaseInput, opts: { runOnSave: boolean }) => void | Promise<void>;
  /** Wired by the caller — runs this single case (`POST …/eval-cases/:caseId/run`). */
  onRunCase?: () => void | Promise<void>;
  isSaving?: boolean;
  isRunning?: boolean;
  /** This case's latest run result — drives the "Last run passed/failed" badge. */
  lastRun?: EvalCaseStatus | null;
}

export function EvalCaseEditorModal({
  ownerKind,
  ownerId,
  ownerName,
  evalCase,
  onClose,
  onSave,
  onRunCase,
  isSaving,
  isRunning,
  lastRun,
}: EvalCaseEditorModalProps) {
  const t = useTranslations("eval");
  const isEdit = !!evalCase;

  const [name, setName] = React.useState(evalCase?.name ?? "");
  const [diff, setDiff] = React.useState(evalCase?.input_diff ?? "");
  const [prTitle, setPrTitle] = React.useState(() => readMetaField(evalCase?.input_meta, "title"));
  const [prBody, setPrBody] = React.useState(() => readMetaField(evalCase?.input_meta, "body"));
  const [expectedOutputText, setExpectedOutputText] = React.useState(() =>
    evalCase ? JSON.stringify(evalCase.expected_output ?? {}, null, 2) : defaultExpectedOutputText(),
  );
  const [runOnSave, setRunOnSave] = React.useState(true);
  const [tab, setTab] = React.useState<InputTabKey>("diff");

  const validation = React.useMemo(() => validateExpectedOutput(expectedOutputText), [expectedOutputText]);
  const canSave = name.trim().length > 0 && validation.valid;
  const expectedCount = validation.valid ? validation.value.findings.length : 0;

  const addFindingSkeleton = () => {
    const base = validation.valid ? validation.value : { kind: "must_find" as const, findings: [] };
    const next = { ...base, findings: [...base.findings, SKELETON_FINDING] };
    setExpectedOutputText(JSON.stringify(next, null, 2));
  };

  const handleSave = async () => {
    if (!canSave || !validation.valid) return;
    await onSave(
      {
        owner_kind: ownerKind,
        owner_id: ownerId,
        name: name.trim(),
        input_diff: diff,
        input_files: extractFilePaths(diff),
        input_meta: { title: prTitle, body: prBody },
        expected_output: validation.value,
        notes: evalCase?.notes ?? null,
      },
      { runOnSave },
    );
  };

  return (
    <Modal
      width={920}
      title={evalCase ? t("caseEditor.caseTitle", { name: evalCase.name }) : t("caseEditor.newCase")}
      subtitle={ownerName ? t("caseEditor.subtitle", { owner: ownerName }) : undefined}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Toggle on={runOnSave} onChange={setRunOnSave} />
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t("caseEditor.runOnSave")}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button kind="ghost" onClick={onClose}>
              {t("caseEditor.cancel")}
            </Button>
            {isEdit && onRunCase && (
              <Button kind="secondary" icon="Play" onClick={onRunCase} disabled={!!isRunning} loading={isRunning}>
                {isRunning ? t("caseEditor.running") : t("caseEditor.runCase")}
              </Button>
            )}
            <Button kind="primary" onClick={handleSave} disabled={!canSave || !!isSaving} loading={isSaving}>
              {isSaving ? t("caseEditor.saving") : t("caseEditor.save")}
            </Button>
          </div>
        </div>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, padding: 24 }}>
        <div>
          <FormField label={t("caseEditor.nameLabel")} required>
            <TextInput value={name} onChange={setName} placeholder={t("caseEditor.namePlaceholder")} />
          </FormField>

          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8 }}>
            {t("caseEditor.inputLabel")}
          </div>
          <Tabs
            pad="0"
            tabs={[
              { key: "diff", label: t("caseEditor.tabs.diff") },
              { key: "files", label: t("caseEditor.tabs.files") },
              { key: "prMeta", label: t("caseEditor.tabs.prMeta") },
            ]}
            value={tab}
            onChange={(k) => setTab(k as InputTabKey)}
          />
          <div style={{ marginTop: 12 }}>
            {tab === "diff" && <DiffTabContent value={diff} onChange={setDiff} t={t} />}
            {tab === "files" && <FilesTabContent diff={diff} />}
            {tab === "prMeta" && (
              <PrMetaTabContent title={prTitle} body={prBody} onTitleChange={setPrTitle} onBodyChange={setPrBody} t={t} />
            )}
          </div>
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
              {t("caseEditor.expectedOutput")}
            </span>
            <Badge
              icon={validation.valid ? "Check" : "X"}
              color={validation.valid ? "var(--ok)" : "var(--crit)"}
              bg={validation.valid ? "var(--ok-bg)" : "var(--crit-bg)"}
            >
              {validation.valid ? t("caseEditor.validJson") : t("caseEditor.invalidJson")}
            </Badge>
          </div>
          <Textarea value={expectedOutputText} onChange={setExpectedOutputText} rows={16} mono />
          <div style={{ marginTop: 8 }}>
            <Button kind="tertiary" size="sm" icon="Plus" onClick={addFindingSkeleton}>
              {t("caseEditor.findingSkeleton")}
            </Button>
          </div>
          {lastRun && <LastRunBadge status={lastRun} expected={expectedCount} t={t} />}
        </div>
      </div>
    </Modal>
  );
}
