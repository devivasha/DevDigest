"use client";
import React from "react";
import { Button, Skeleton } from "@devdigest/ui";
import { useSkillVersions, useRestoreSkillVersion, useSkill } from "../../../../../../../lib/hooks/skills";

function LineDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const maxLines = Math.max(oldLines.length, newLines.length);
  const lines: { kind: "added" | "removed" | "context"; text: string }[] = [];
  for (let i = 0; i < Math.min(maxLines, 60); i++) {
    const o = oldLines[i] ?? "";
    const n = newLines[i] ?? "";
    if (o !== n) {
      if (o) lines.push({ kind: "removed", text: o });
      if (n) lines.push({ kind: "added", text: n });
    } else {
      lines.push({ kind: "context", text: o });
    }
  }
  return (
    <pre
      style={{
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        overflow: "auto",
        maxHeight: 400,
        margin: 0,
        lineHeight: 1.65,
        padding: "10px 12px",
        background: "var(--bg-muted)",
        borderRadius: 4,
        border: "1px solid var(--border)",
      }}
    >
      {lines.map((l, i) => (
        <div
          key={i}
          style={{
            background:
              l.kind === "added"
                ? "rgba(0,200,100,0.10)"
                : l.kind === "removed"
                  ? "rgba(255,80,80,0.10)"
                  : "transparent",
            color:
              l.kind === "added"
                ? "var(--success-text, #34d399)"
                : l.kind === "removed"
                  ? "var(--error-text, #f87171)"
                  : "var(--text-secondary)",
            paddingLeft: 4,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {l.kind === "added" ? "+ " : l.kind === "removed" ? "- " : "  "}
          {l.text}
        </div>
      ))}
    </pre>
  );
}

function FullBody({ body }: { body: string }) {
  return (
    <pre
      style={{
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        overflow: "auto",
        maxHeight: 400,
        margin: 0,
        lineHeight: 1.65,
        padding: "10px 12px",
        background: "var(--bg-muted)",
        borderRadius: 4,
        border: "1px solid var(--border)",
        color: "var(--text-secondary)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      }}
    >
      {body}
    </pre>
  );
}

export function VersionsTab({ skillId }: { skillId: string }) {
  const { data: versions, isLoading } = useSkillVersions(skillId);
  const { data: skill } = useSkill(skillId);
  const restore = useRestoreSkillVersion();
  const [diffOpen, setDiffOpen] = React.useState<number | null>(null);

  if (isLoading) return <Skeleton height={200} />;
  if (!versions || versions.length === 0) {
    return (
      <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No version history yet.</p>
    );
  }

  const currentVersion = skill?.version;
  const count = versions.length;

  return (
    <div style={{ maxWidth: 720 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Version history</h2>
        <span
          style={{
            fontSize: 12,
            background: "var(--bg-muted)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: "2px 10px",
            color: "var(--text-secondary)",
          }}
        >
          {count} {count === 1 ? "version" : "versions"}
        </span>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 20px" }}>
        Every save snapshots the body so eval runs stay reproducible against the exact text they scored.
      </p>

      {/* Version rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {versions.map((v, idx) => {
          const prev = versions[idx + 1];
          const isOpen = diffOpen === v.version;
          const isCurrent = v.version === currentVersion;

          return (
            <div
              key={v.version}
              style={{
                borderRadius: 6,
                border: "1px solid var(--border)",
                overflow: "hidden",
              }}
            >
              {/* Row */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 16px",
                  background: "var(--bg-surface)",
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 13, minWidth: 24 }}>
                  v{v.version}
                </span>

                {isCurrent && (
                  <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--success, #34d399)" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--success, #34d399)", display: "inline-block" }} />
                    Current
                  </span>
                )}

                <span style={{ flex: 1, fontSize: 12, color: "var(--text-muted)" }}>
                  {v.created_at ? new Date(v.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : ""}
                </span>

                <Button
                  kind="secondary"
                  size="sm"
                  onClick={() => setDiffOpen(isOpen ? null : v.version)}
                >
                  {isOpen ? "Hide" : "Diff"}
                </Button>

                {!isCurrent && (
                  <Button
                    kind="secondary"
                    size="sm"
                    onClick={() => {
                      if (window.confirm(`Restore v${v.version}? This creates a new version with the old body.`)) {
                        restore.mutate({ id: skillId, version: v.version });
                      }
                    }}
                    disabled={restore.isPending}
                  >
                    Restore
                  </Button>
                )}
              </div>

              {/* Diff / body panel */}
              {isOpen && (
                <div style={{ padding: "0 16px 14px" }}>
                  {prev ? (
                    <LineDiff oldText={prev.body} newText={v.body} />
                  ) : (
                    <FullBody body={v.body} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
