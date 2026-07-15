import type { CSSProperties } from "react";
import type { AgentColumn } from "@devdigest/shared";
import { COLUMN_WIDTH } from "./constants";

/** Co-located styles for MultiAgentColumns + AgentColumnCard. */
export const s = {
  /** Horizontal-scroll fallback for narrow viewports; the row itself wraps
   * gracefully first via `flexWrap`. */
  scrollWrap: {
    overflowX: "auto",
    paddingBottom: 4,
  } satisfies CSSProperties,
  row: {
    display: "flex",
    flexWrap: "wrap",
    gap: 16,
    alignItems: "start",
  } satisfies CSSProperties,
  /** Card border: solid frame + a COLOURED TOP BORDER in the agent's accent. */
  card: (accent: string): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    flex: `0 0 ${COLUMN_WIDTH}px`,
    width: COLUMN_WIDTH,
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "var(--border)",
    borderTopWidth: 3,
    borderTopColor: accent,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  }),
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    borderBottomColor: "var(--border)",
  } satisfies CSSProperties,
  iconTile: (accent: string): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 32,
    height: 32,
    borderRadius: 8,
    background: `${accent}26`,
    color: accent,
  }),
  headerMain: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    minWidth: 0,
    flex: 1,
  } satisfies CSSProperties,
  agentName: {
    margin: 0,
    fontSize: 14,
    fontWeight: 700,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  metaLine: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  statusIcon: (status: AgentColumn["status"]): CSSProperties => ({
    color:
      status === "done" ? "var(--ok)" : status === "failed" ? "var(--crit)" : "var(--text-muted)",
    animation: status === "running" ? "ddspin 1s linear infinite" : undefined,
    flexShrink: 0,
  }),
  scoreWrap: {
    flexShrink: 0,
    marginLeft: "auto",
  } satisfies CSSProperties,
  failedReason: {
    margin: 0,
    fontSize: 12,
    color: "var(--crit)",
  } satisfies CSSProperties,
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 12,
    flex: 1,
  } satisfies CSSProperties,
  findingsList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    margin: 0,
    padding: 0,
    listStyle: "none",
  } satisfies CSSProperties,
  /** COLOURED LEFT BORDER by severity. */
  findingItem: (severityColor: string): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    gap: 3,
    padding: "6px 8px",
    borderRadius: 4,
    borderLeftStyle: "solid",
    borderLeftWidth: 3,
    borderLeftColor: severityColor,
    background: "var(--bg-hover)",
  }),
  findingHeader: {
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
  } satisfies CSSProperties,
  findingTitle: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--text-primary)",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } satisfies CSSProperties,
  findingFile: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  footer: {
    marginTop: "auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "10px 12px",
    borderTopStyle: "solid",
    borderTopWidth: 1,
    borderTopColor: "var(--border)",
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
};
