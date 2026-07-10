/**
 * Configurable bucket set for Project Context discovery.
 *
 * A repo-relative markdown file is discoverable when it lives at any depth
 * beneath a directory whose name is one of these buckets — i.e.
 * `**\/{specs,docs,insights}/**\/*.md`. Keep the match logic in `discovery.ts`
 * driven by this constant (not an inline literal) so adding/removing a bucket
 * here is the only change needed (AC-3).
 */
export const BUCKETS = ['specs', 'docs', 'insights'] as const;

export type BucketName = (typeof BUCKETS)[number];
