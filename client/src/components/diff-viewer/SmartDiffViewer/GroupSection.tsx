"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { SmartDiffFile, SmartDiffRole, FindingRecord } from "@devdigest/shared";
import type { PrFile } from "@/lib/types";
import type { DiffCommentApi } from "../comments";
import { SmartFileCard } from "./SmartFileCard";

const ROLE_META: Record<SmartDiffRole, { color: string; icon: keyof typeof Icon }> = {
  core: { color: "var(--crit)", icon: "Code" },
  wiring: { color: "var(--warn)", icon: "GitBranch" },
  boilerplate: { color: "var(--text-muted)", icon: "Boxes" },
};

interface GroupSectionProps {
  role: SmartDiffRole;
  files: SmartDiffFile[];
  fileByPath: Map<string, PrFile>;
  findingsByFile: Map<string, FindingRecord[]>;
  commenting?: DiffCommentApi;
  onFindingClick?: (findingId: string) => void;
  defaultCollapsed?: boolean;
}

export function GroupSection({
  role,
  files,
  fileByPath,
  findingsByFile,
  commenting,
  onFindingClick,
  defaultCollapsed = false,
}: GroupSectionProps) {
  const t = useTranslations("shell");
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  const meta = ROLE_META[role];
  const RoleIcon = Icon[meta.icon];

  const totalFindings = files.reduce(
    (sum, f) => sum + (findingsByFile.get(f.path)?.length ?? 0),
    0,
  );

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed((c) => !c)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setCollapsed((c) => !c);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 12px",
          marginBottom: 8,
          borderLeft: `3px solid ${meta.color}`,
          background: "var(--bg-elevated)",
          borderRadius: "0 6px 6px 0",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <RoleIcon size={14} style={{ color: meta.color, flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>
          {t(`smartDiff.role.${role}`)}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-muted)", flex: 1 }}>
          {t(`smartDiff.roleDesc.${role}`)}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {files.length} {files.length === 1 ? "file" : "files"}
          {totalFindings > 0 && (
            <span style={{ color: "var(--warn)", marginLeft: 6 }}>
              · {totalFindings} finding{totalFindings !== 1 ? "s" : ""}
            </span>
          )}
        </span>
        <Icon.ChevronDown
          size={14}
          style={{
            color: "var(--text-muted)",
            transform: collapsed ? "rotate(-90deg)" : "none",
            transition: "transform .12s",
          }}
        />
      </div>

      {!collapsed && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {files.map((f) => {
            const prFile = fileByPath.get(f.path);
            if (!prFile) return null;
            return (
              <SmartFileCard
                key={f.path}
                file={f}
                prFile={prFile}
                fileFindings={findingsByFile.get(f.path) ?? []}
                commenting={commenting}
                onFindingClick={onFindingClick}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
