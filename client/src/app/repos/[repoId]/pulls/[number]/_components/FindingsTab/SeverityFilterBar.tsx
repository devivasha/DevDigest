import React from "react";
import { Chip, SEV, type Severity } from "@devdigest/ui";

const LEVELS: Severity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

export function SeverityFilterBar({
  counts,
  active,
  onChange,
}: {
  counts: Partial<Record<Severity, number>>;
  active: Severity | null;
  onChange: (s: Severity | null) => void;
}) {
  const visible = LEVELS.filter((s) => (counts[s] ?? 0) > 0);
  if (visible.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
      {visible.map((s) => (
        <Chip
          key={s}
          icon={SEV[s].icon}
          color={SEV[s].c}
          count={counts[s]}
          active={active === s}
          onClick={() => onChange(active === s ? null : s)}
        >
          {SEV[s].label}
        </Chip>
      ))}
    </div>
  );
}
