"use client";

import React from "react";
import { IconBtn } from "@devdigest/ui";

export interface SecretRevealProps {
  title: string;
  value: string;
  hint?: string;
  onCopy: () => void;
  copyLabel: string;
}

/** Shows the one-time `CiExport.ingest_secret` (D4/AC-24) with a copy button. The value
 *  only ever lives in the export mutation's in-memory response (`useExportCi`'s local
 *  `data`) — never written to localStorage/sessionStorage/a persisted query cache, so it
 *  disappears the moment the wizard modal unmounts, matching "shown once, never
 *  persisted beyond the modal session". */
export function SecretReveal({ title, value, hint, onCopy, copyLabel }: SecretRevealProps) {
  return (
    <div
      style={{
        border: "1px solid var(--border-strong)",
        borderRadius: 10,
        padding: 16,
        background: "var(--bg-elevated)",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <code
          className="mono"
          style={{ flex: 1, wordBreak: "break-all", fontSize: 12.5, color: "var(--text-primary)" }}
        >
          {value}
        </code>
        <IconBtn icon="Copy" label={copyLabel} onClick={onCopy} />
      </div>
      {hint && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.45 }}>{hint}</div>}
    </div>
  );
}
