import type { DocumentBucket } from "@devdigest/shared";

export const SKELETON_ROWS = 4;

/**
 * Per-bucket badge colour pair. Always paired with a translated text label in
 * <BucketBadge> — WCAG 2.1 AA requires the bucket never be conveyed by colour
 * alone.
 */
export const BUCKET_COLOR: Record<DocumentBucket, { color: string; bg: string }> = {
  specs: { color: "var(--accent-text)", bg: "var(--accent-bg)" },
  docs: { color: "var(--ok)", bg: "var(--ok-bg)" },
  insights: { color: "var(--warn)", bg: "var(--warn-bg)" },
};

export type DrawerTab = "preview" | "edit";

export interface DrawerSelection {
  path: string;
  tab: DrawerTab;
}
