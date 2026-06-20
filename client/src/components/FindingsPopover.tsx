import React from "react";
import { Icon, SEV, CAT } from "@devdigest/ui";

export interface FindingPreviewItem {
  id: string;
  severity: string;
  category: string;
  title: string;
  file: string;
  start_line: number;
  confidence: number;
  rationale: string;
}

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

export function FindingsPopover({
  items,
  top,
  left,
}: {
  items: FindingPreviewItem[];
  top: number;
  left: number;
}) {
  if (items.length === 0) return null;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top,
        left,
        zIndex: 1000,
        width: 340,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "0 8px 24px rgba(0,0,0,.18)",
        padding: "10px 0",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          padding: "0 14px 8px",
          borderBottom: "1px solid var(--border)",
          marginBottom: 6,
        }}
      >
        {items.length} finding{items.length === 1 ? "" : "s"} in this run
      </div>

      {[...items]
        .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))
        .map((f) => {
          const sev = SEV[f.severity as keyof typeof SEV] ?? SEV.SUGGESTION;
          const cat = CAT[f.category as keyof typeof CAT];
          const SevIcon = Icon[sev.icon];
          const pct = Math.round(f.confidence * 100);
          const confColor = pct >= 85 ? "var(--ok)" : pct >= 65 ? "var(--warn)" : "var(--text-muted)";

          return (
            <div
              key={f.id}
              style={{
                padding: "8px 14px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <SevIcon size={13} style={{ color: sev.c, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 550, color: "var(--text-primary)", flex: 1, minWidth: 0 }}>
                  {f.title}
                </span>
                {cat && (
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      background: "var(--bg-surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      padding: "1px 6px",
                      flexShrink: 0,
                    }}
                  >
                    {cat.label}
                  </span>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}
                >
                  {f.file}:{f.start_line}
                </span>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: confColor, flexShrink: 0, display: "flex", alignItems: "center", gap: 3 }}
                >
                  <span style={{ width: 5, height: 5, borderRadius: 99, background: confColor }} />
                  {pct}% conf
                </span>
              </div>

              {f.rationale && (
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    lineHeight: 1.45,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {f.rationale}
                </p>
              )}
            </div>
          );
        })}
    </div>
  );
}
