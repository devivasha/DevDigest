"use client";

import React from "react";
import { Button, Icon } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.8 ? "var(--success)" : value >= 0.6 ? "var(--warning)" : "var(--error)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          flex: 1,
          height: 4,
          background: "var(--border)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 28, textAlign: "right" }}>
        {pct}%
      </span>
    </div>
  );
}

export function ConventionCard({
  candidate,
  repoId,
  onAccept,
  onReject,
  onRuleChange,
  pending,
}: {
  candidate: ConventionCandidate;
  repoId: string;
  onAccept: () => void;
  onReject: () => void;
  onRuleChange: (rule: string) => void;
  pending?: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(candidate.rule);
  const [snippetOpen, setSnippetOpen] = React.useState(true);

  function commitEdit() {
    setEditing(false);
    if (draft.trim() && draft !== candidate.rule) {
      onRuleChange(draft.trim());
    }
  }

  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: `1px solid ${candidate.accepted ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 8,
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Category chip + edit icon */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "2px 8px",
            borderRadius: 4,
            background: "var(--bg-muted)",
            color: "var(--text-secondary)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {candidate.category}
        </span>
        <button
          onClick={() => { setEditing(true); setDraft(candidate.rule); }}
          title="Edit rule"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-muted)",
            padding: 2,
            display: "flex",
            alignItems: "center",
          }}
        >
          <Icon.Edit size={12} />
        </button>
      </div>

      {/* Rule text */}
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditing(false); }}
          style={{
            fontSize: 14,
            fontStyle: "italic",
            color: "var(--text-primary)",
            background: "var(--bg-muted)",
            border: "1px solid var(--accent)",
            borderRadius: 4,
            padding: "4px 8px",
            width: "100%",
            outline: "none",
          }}
        />
      ) : (
        <p
          style={{
            fontSize: 14,
            fontStyle: "italic",
            color: "var(--text-primary)",
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          {candidate.rule}
        </p>
      )}

      {/* Evidence path */}
      {candidate.evidence_path && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <code style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {candidate.evidence_path}
          </code>
          <button
            onClick={() => setSnippetOpen((o) => !o)}
            title={snippetOpen ? "Hide snippet" : "Show snippet"}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              padding: 2,
              display: "flex",
              alignItems: "center",
            }}
          >
            <Icon.ChevronDown
              size={12}
              style={{ transform: snippetOpen ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }}
            />
          </button>
        </div>
      )}

      {/* Evidence snippet */}
      {snippetOpen && candidate.evidence_snippet && (
        <pre
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            background: "var(--bg-muted)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "8px 12px",
            margin: 0,
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            color: "var(--text-secondary)",
          }}
        >
          {candidate.evidence_snippet}
        </pre>
      )}

      {/* Confidence bar */}
      <ConfidenceBar value={candidate.confidence} />

      {/* Accept / Reject */}
      <div style={{ display: "flex", gap: 8 }}>
        <Button
          kind="secondary"
          size="sm"
          icon="Check"
          active={candidate.accepted}
          disabled={pending}
          onClick={onAccept}
        >
          {candidate.accepted ? "Accepted" : "Accept"}
        </Button>
        <Button
          kind="ghost"
          size="sm"
          icon="X"
          active={!candidate.accepted}
          disabled={pending}
          onClick={onReject}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
