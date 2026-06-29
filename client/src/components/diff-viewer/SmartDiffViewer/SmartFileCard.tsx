/* SmartFileCard — FileCard extended with:
   - "What this does" pseudocode summary (when provided by reviewer)
   - Severity badges showing finding counts per file
   - Per-line finding indicators (colored left border + severity chip) */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SeverityBadge } from "@devdigest/ui";
import type { SmartDiffFile, FindingRecord } from "@devdigest/shared";
import type { PrFile } from "@/lib/types";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { parsePatch, type Line } from "../helpers";
import { s, chevronFor } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";
import { AUTO_EXPAND_MAX_LINES } from "../constants";

function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

function findingForLine(ln: Line, findings: FindingRecord[]): FindingRecord | undefined {
  const lineNo = ln.newNo ?? ln.oldNo;
  if (lineNo == null) return undefined;
  return findings.find((f) => f.start_line <= lineNo && lineNo <= f.end_line);
}

interface SmartFileCardProps {
  file: SmartDiffFile;
  prFile: PrFile;
  fileFindings: FindingRecord[];
  commenting?: DiffCommentApi;
  onFindingClick?: (findingId: string) => void;
}

export function SmartFileCard({
  file,
  prFile,
  fileFindings,
  commenting,
  onFindingClick,
}: SmartFileCardProps) {
  const t = useTranslations("shell");
  const [open, setOpen] = React.useState(
    (prFile.additions ?? 0) + (prFile.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES,
  );
  const lines = React.useMemo(() => parsePatch(prFile.patch), [prFile.patch]);

  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === prFile.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, prFile.path, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === prFile.path).length
    : 0;

  // Severity breakdown for badge display.
  const critCount = fileFindings.filter((f) => f.severity === "CRITICAL").length;
  const warnCount = fileFindings.filter((f) => f.severity === "WARNING").length;
  const suggCount = fileFindings.filter((f) => f.severity === "SUGGESTION").length;

  // Most severe finding for single-click navigation from the file header badge.
  const mostSevere =
    fileFindings.find((f) => f.severity === "CRITICAL") ??
    fileFindings.find((f) => f.severity === "WARNING") ??
    fileFindings[0];

  return (
    <div style={s.fileCard}>
      <div onClick={() => setOpen((o) => !o)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {prFile.path}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{prFile.additions}</span>{" "}
          <span style={s.delText}>−{prFile.deletions}</span>
        </span>

        {/* Finding severity badges — click navigates to Agent runs */}
        {critCount > 0 && (
          <button
            type="button"
            title={t("smartDiff.goToFinding")}
            onClick={(e) => {
              e.stopPropagation();
              if (mostSevere && onFindingClick) onFindingClick(mostSevere.id);
            }}
            style={badgeBtnStyle}
          >
            <SeverityBadge severity="CRITICAL" count={critCount} compact />
          </button>
        )}
        {warnCount > 0 && (
          <button
            type="button"
            title={t("smartDiff.goToFinding")}
            onClick={(e) => {
              e.stopPropagation();
              const target =
                fileFindings.find((f) => f.severity === "WARNING") ?? mostSevere;
              if (target && onFindingClick) onFindingClick(target.id);
            }}
            style={badgeBtnStyle}
          >
            <SeverityBadge severity="WARNING" count={warnCount} compact />
          </button>
        )}
        {suggCount > 0 && (
          <button
            type="button"
            title={t("smartDiff.goToFinding")}
            onClick={(e) => {
              e.stopPropagation();
              const target =
                fileFindings.find((f) => f.severity === "SUGGESTION") ?? mostSevere;
              if (target && onFindingClick) onFindingClick(target.id);
            }}
            style={badgeBtnStyle}
          >
            <SeverityBadge severity="SUGGESTION" count={suggCount} compact />
          </button>
        )}

        {commentCount > 0 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
      </div>

      {/* "What this does" — shown only when reviewer populated it */}
      {file.pseudocode_summary && (
        <div style={summaryStyle}>
          <Icon.Sparkles size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <span style={{ color: "#ffffff", fontWeight: 700 }}>
            {t("smartDiff.whatThisDoes")}
          </span>
          <span style={{ color: "var(--text-secondary)" }}>{file.pseudocode_summary}</span>
        </div>
      )}

      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => (
              <CodeLine
                key={i}
                ln={ln}
                path={prFile.path}
                threads={threadsForLine(ln, matched)}
                commenting={commenting}
                finding={findingForLine(ln, fileFindings)}
                onFindingClick={onFindingClick}
              />
            ))
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}

const badgeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  display: "inline-flex",
};

const summaryStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 6,
  fontSize: 12,
  padding: "5px 12px 6px",
  borderBottom: "1px solid var(--border)",
  lineHeight: 1.4,
};
