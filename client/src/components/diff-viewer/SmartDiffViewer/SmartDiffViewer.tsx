"use client";

import React from "react";
import type { SmartDiff, SmartDiffRole, FindingRecord } from "@devdigest/shared";
import type { PrFile } from "@/lib/types";
import type { DiffCommentApi } from "../comments";
import { GroupSection } from "./GroupSection";

interface SmartDiffViewerProps {
  smartDiff: SmartDiff;
  files: PrFile[];
  findings: FindingRecord[];
  commenting?: DiffCommentApi;
  onFindingClick?: (findingId: string) => void;
}

export function SmartDiffViewer({
  smartDiff,
  files,
  findings,
  commenting,
  onFindingClick,
}: SmartDiffViewerProps) {
  const fileByPath = React.useMemo(() => {
    const m = new Map<string, PrFile>();
    for (const f of files) m.set(f.path, f);
    return m;
  }, [files]);

  const findingsByFile = React.useMemo(() => {
    const m = new Map<string, FindingRecord[]>();
    for (const f of findings) {
      const list = m.get(f.file) ?? [];
      list.push(f);
      m.set(f.file, list);
    }
    return m;
  }, [findings]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {smartDiff.groups.map((group) => {
        // Deduplicate by path — guards against stale cached API responses that
        // may contain duplicate rows from the DB before the server-side fix.
        const seen = new Set<string>();
        const dedupedFiles = group.files.filter((f) => {
          if (seen.has(f.path)) return false;
          seen.add(f.path);
          return true;
        });
        return (
          <GroupSection
            key={group.role}
            role={group.role as SmartDiffRole}
            files={dedupedFiles}
            fileByPath={fileByPath}
            findingsByFile={findingsByFile}
            commenting={commenting}
            onFindingClick={onFindingClick}
            defaultCollapsed={group.role === "boilerplate"}
          />
        );
      })}
    </div>
  );
}
