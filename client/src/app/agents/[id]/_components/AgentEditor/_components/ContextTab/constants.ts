import type { DocumentBucket } from "@devdigest/shared";

/** Bucket accent colors — mirrors SkillsTab's TYPE_COLOR pattern. */
export const BUCKET_COLOR: Record<DocumentBucket, string> = {
  specs: "var(--accent)",
  docs: "var(--ok)",
  insights: "var(--warn)",
};

/** Stable display order for buckets when sorting unattached docs. */
export const BUCKET_ORDER: DocumentBucket[] = ["specs", "docs", "insights"];
