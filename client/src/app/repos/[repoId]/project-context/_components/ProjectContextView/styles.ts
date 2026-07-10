import type { CSSProperties } from "react";

/** Co-located styles for the Project Context page + drawer. */
export const s = {
  pageHeader: {
    padding: "24px 32px 10px",
  } satisfies CSSProperties,
  pageTitle: {
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: "-0.02em",
  } satisfies CSSProperties,
  pageSubtitle: {
    fontSize: 14,
    color: "var(--text-secondary)",
    marginTop: 4,
  } satisfies CSSProperties,
  card: {
    margin: "14px 32px 44px",
    border: "1px solid var(--border)",
    borderRadius: 10,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  loadingStack: {
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "12px 20px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  rowMain: {
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,
  filename: {
    fontSize: 14,
    fontWeight: 550,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  folder: {
    fontSize: 12,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  footer: {
    padding: "12px 20px",
    borderTop: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 13,
    color: "var(--text-secondary)",
    display: "flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  resyncWarning: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "10px 12px",
    borderRadius: 7,
    background: "var(--warn-bg)",
    color: "var(--warn)",
    fontSize: 13,
    lineHeight: 1.5,
    marginBottom: 12,
  } satisfies CSSProperties,
  textarea: {
    width: "100%",
    minHeight: 320,
    resize: "vertical",
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    fontSize: 13,
    lineHeight: 1.55,
    outline: "none",
  } satisfies CSSProperties,
  drawerFooter: {
    display: "flex",
    alignItems: "center",
    gap: 14,
  } satisfies CSSProperties,
  saveStatus: {
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  drawerBody: {
    minHeight: 200,
  } satisfies CSSProperties,
} as const;
