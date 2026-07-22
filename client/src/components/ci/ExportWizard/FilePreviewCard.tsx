"use client";

import React from "react";
import { Badge, Textarea } from "@devdigest/ui";
import type { CiFile } from "@/vendor/shared/contracts/eval-ci";

export interface FilePreviewCardProps {
  file: CiFile;
  /** Human-friendly section title shown above the code block (e.g. "Workflow file"). */
  title: string;
  editableLabel: string;
  readOnlyLabel: string;
  emptyLabel: string;
  /** Present only for the workflow file when the current target is `gha` (AC-3, AC-6). */
  onChange?: (contents: string) => void;
}

/** The one Preview card that shows real file bytes (AC-4): a title + editable/
 *  read-only badge above a code block. The workflow file becomes a live
 *  `<Textarea>` when `onChange` + `file.editable` are both present (gha target
 *  only); otherwise its contents render read-only in a `<pre>`. */
export function FilePreviewCard({ file, title, editableLabel, readOnlyLabel, emptyLabel, onChange }: FilePreviewCardProps) {
  const canEdit = Boolean(onChange) && file.editable;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{title}</span>
        <Badge color={file.editable ? "var(--accent)" : "var(--text-muted)"}>
          {file.editable ? editableLabel : readOnlyLabel}
        </Badge>
      </div>
      {canEdit ? (
        <Textarea value={file.contents} onChange={onChange} rows={14} mono />
      ) : (
        <pre
          className="mono"
          style={{
            margin: 0,
            padding: 12,
            fontSize: 12,
            lineHeight: 1.6,
            maxHeight: 220,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            color: "var(--text-secondary)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            background: "var(--bg-surface)",
          }}
        >
          {file.contents || `(${emptyLabel})`}
        </pre>
      )}
    </div>
  );
}
