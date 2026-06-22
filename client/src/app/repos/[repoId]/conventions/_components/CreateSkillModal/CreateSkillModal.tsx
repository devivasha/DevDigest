"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button, Icon } from "@devdigest/ui";
import { useCreateSkill } from "@/lib/hooks/skills";

export function CreateSkillModal({
  body: initialBody,
  repoName,
  acceptedCount,
  onClose,
}: {
  body: string;
  repoName: string;
  acceptedCount: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const createSkill = useCreateSkill();
  const [name, setName] = React.useState(`${repoName}-conventions`);
  const [description, setDescription] = React.useState(
    `${acceptedCount} conventions extracted from ${repoName}`
  );
  const [body, setBody] = React.useState(initialBody);

  async function handleCreate() {
    const skill = await createSkill.mutateAsync({
      name,
      description,
      type: "convention",
      source: "extracted",
      body,
      enabled: true,
    });
    onClose();
    router.push(`/skills/${skill.id}?tab=config`);
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          width: "min(680px, 95vw)",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Create skill from conventions</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {repoName}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4 }}
          >
            <Icon.X size={18} />
          </button>
        </div>

        {/* Info banner */}
        <div
          style={{
            background: "var(--bg-muted)",
            borderBottom: "1px solid var(--border)",
            padding: "10px 20px",
            fontSize: 12,
            color: "var(--text-secondary)",
          }}
        >
          Merged from <strong>{acceptedCount} accepted conventions</strong> in <code>{repoName}</code>. Everything below is editable before you save.
        </div>

        {/* Form */}
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", flex: 1 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
              Name <span style={{ color: "var(--error)" }}>*</span>
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                background: "var(--bg-muted)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "8px 12px",
                fontSize: 14,
                color: "var(--text-primary)",
                outline: "none",
              }}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>Description</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{
                background: "var(--bg-muted)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "8px 12px",
                fontSize: 14,
                color: "var(--text-primary)",
                outline: "none",
              }}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
              Skill body <span style={{ color: "var(--error)" }}>*</span>
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={16}
              style={{
                background: "var(--bg-muted)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "8px 12px",
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                color: "var(--text-primary)",
                outline: "none",
                resize: "vertical",
              }}
            />
          </label>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "14px 20px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <Button kind="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            kind="primary"
            size="sm"
            icon="Sparkles"
            disabled={!name.trim() || !body.trim() || createSkill.isPending}
            onClick={handleCreate}
          >
            {createSkill.isPending ? "Creating…" : "Create skill"}
          </Button>
        </div>
      </div>
    </div>
  );
}
