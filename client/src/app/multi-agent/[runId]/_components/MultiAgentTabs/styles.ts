import type { CSSProperties } from "react";

/** Co-located styles for MultiAgentTabs (tab row, agent summary, finding cards). */
export const s = {
  wrap: { display: "flex", flexDirection: "column" } satisfies CSSProperties,

  tabRow: {
    display: "flex",
    gap: 2,
    padding: "0 28px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  tab: (active: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 16px",
    border: "none",
    background: "transparent",
    borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
    marginBottom: -1,
    cursor: "pointer",
    fontSize: 14,
    fontWeight: active ? 600 : 500,
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
  }),
  tabScore: (color: string): CSSProperties => ({
    fontWeight: 700,
    color,
  }),

  body: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    padding: "20px 28px",
  } satisfies CSSProperties,

  summaryCard: (accent: string): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "16px 20px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    borderLeft: `4px solid ${accent}`,
    background: "var(--bg-elevated)",
  }),
  summaryMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  summaryName: (accent: string): CSSProperties => ({
    fontSize: 15,
    fontWeight: 650,
    color: accent,
    marginBottom: 4,
  }),
  summaryText: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    margin: 0,
  } satisfies CSSProperties,
  summaryRight: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 6,
    flexShrink: 0,
  } satisfies CSSProperties,
  summaryMeta: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  findingsList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,

  card: (borderColor: string): CSSProperties => ({
    borderRadius: 8,
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${borderColor}`,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  }),
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    cursor: "pointer",
  } satisfies CSSProperties,
  cardHeaderMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  cardTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  cardTitle: {
    fontSize: 13,
    fontWeight: 650,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  cardMetaRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  chevron: (expanded: boolean): CSSProperties => ({
    flexShrink: 0,
    color: "var(--text-muted)",
    transform: expanded ? "rotate(180deg)" : "none",
    transition: "transform .15s ease",
  }),
  cardBody: {
    padding: "0 14px 14px",
  } satisfies CSSProperties,
  prose: {
    fontSize: 14,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  suggestionWrap: { marginTop: 14 } satisfies CSSProperties,
  suggestionLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    marginBottom: 8,
    textTransform: "uppercase",
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    gap: 8,
    marginTop: 14,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  loadingText: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
