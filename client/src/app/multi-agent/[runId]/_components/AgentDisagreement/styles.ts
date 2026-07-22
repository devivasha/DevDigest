import type { CSSProperties } from "react";

/** Co-located styles for AgentDisagreement. */
export const s = {
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  titleGroup: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  title: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  } satisfies CSSProperties,
  count: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  toggle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 12px",
    borderRadius: 20,
    fontSize: 12.5,
    fontWeight: 500,
    color: "var(--text-secondary)",
    background: "var(--bg-hover)",
    border: "1px solid var(--border)",
    cursor: "pointer",
  } satisfies CSSProperties,
  toggleActive: {
    color: "var(--accent)",
    border: "1px solid var(--accent)",
    background: "color-mix(in srgb, var(--accent) 12%, transparent)",
  } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  location: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  cardTitle: {
    fontSize: 13.5,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  takesGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
  } satisfies CSSProperties,
  takeColumn: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  persona: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  verdictLine: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11.5,
    fontWeight: 600,
    letterSpacing: "0.03em",
  } satisfies CSSProperties,
  dot: {
    width: 7,
    height: 7,
    borderRadius: 99,
    flexShrink: 0,
  } satisfies CSSProperties,
  didNotFlag: {
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  note: {
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.4,
  } satisfies CSSProperties,
} as const;
