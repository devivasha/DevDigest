"use client";

import React from "react";

export interface SummaryCardProps {
  /** Human-friendly section title, e.g. "Agent manifest" / "Linked skills (2)". */
  title: string;
  /** Secondary line under the title — usually the file path (mono) or an
   *  empty-state message. Omitted when the card renders `children` instead. */
  subtitle?: string;
  /** Render the subtitle in a monospace face (paths yes, prose no). */
  mono?: boolean;
  children?: React.ReactNode;
}

/** A compact, content-free bundle card for the Preview step (AC-4): shows WHAT
 *  file will be created (title + path) without dumping its bytes. Only the
 *  workflow file — the one thing the user may want to edit — renders its actual
 *  contents (see `FilePreviewCard`). */
export function SummaryCard({ title, subtitle, mono = true, children }: SummaryCardProps) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg-elevated)",
        padding: 16,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{title}</div>
      {subtitle && (
        <div
          className={mono ? "mono" : undefined}
          style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 6 }}
        >
          {subtitle}
        </div>
      )}
      {children}
    </div>
  );
}
