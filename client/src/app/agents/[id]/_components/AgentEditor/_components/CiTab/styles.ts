import type { CSSProperties } from "react";

/** Co-located styles for CiTab (mirrors ConfigTab's `s` pattern). */
export const s = {
  wrap: { maxWidth: 900 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", marginBottom: 20, gap: 12 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" } satisfies CSSProperties,
  headerText: { flex: 1 } satisfies CSSProperties,
  section: {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    padding: 18,
    marginBottom: 20,
  } satisfies CSSProperties,
  sectionTitle: { fontSize: 14, fontWeight: 700, marginBottom: 14 } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse" } satisfies CSSProperties,
  th: { padding: "6px 10px", fontSize: 11, color: "var(--text-muted)", textAlign: "left" } satisfies CSSProperties,
  td: { padding: "8px 10px", fontSize: 12.5 } satisfies CSSProperties,
  link: { color: "var(--accent)", fontWeight: 600, textDecoration: "none" } satisfies CSSProperties,
  muted: { color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
