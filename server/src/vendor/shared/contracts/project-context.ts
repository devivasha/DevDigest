import { z } from 'zod';

/**
 * Project Context — human-attached repo markdown docs (specs/docs/insights)
 * that get read fresh on each run and injected into the existing
 * `## Project context` prompt slot (reviewer-core already wraps + guards it,
 * see `reviewer-core/src/prompt.ts`).
 *
 * Discovery walks a repo's clone working tree for `**\/{specs,docs,insights}/**\/*.md`
 * (bucket set lives in `modules/project-context/constants.ts`, not inlined here).
 * Attach persistence (which paths, in what order) lives on `Agent`/`Skill`
 * (`attached_doc_paths`, see `contracts/knowledge.ts`) — this file only carries
 * the discovery/read/write payload shapes.
 *
 * Field names are snake_case (contract convention).
 */

// ---- Discovery ----
export const DocumentBucket = z.enum(['specs', 'docs', 'insights']);
export type DocumentBucket = z.infer<typeof DocumentBucket>;

export const DiscoveredDocument = z.object({
  path: z.string(),
  bucket: DocumentBucket,
  estimated_tokens: z.number().int(),
  // Count of agents (in the workspace) whose attach list includes this path.
  // Optional — only populated where the caller has agent context (T7 service).
  used_by_agents: z.number().int().optional(),
});
export type DiscoveredDocument = z.infer<typeof DiscoveredDocument>;

export const DiscoverySummary = z.object({
  document_count: z.number().int(),
  total_estimated_tokens: z.number().int(),
  // ISO timestamp of when discovery ran.
  refreshed_at: z.string(),
  // false when the repo's clone working tree is absent — discovery then
  // returns an empty document list rather than erroring.
  clone_available: z.boolean(),
});
export type DiscoverySummary = z.infer<typeof DiscoverySummary>;

// ---- Document read/write (Preview / Edit-in-place) ----
export const DocumentContent = z.object({
  path: z.string(),
  text: z.string(),
});
export type DocumentContent = z.infer<typeof DocumentContent>;

// ---- Request bodies ----
// Ordered list of repo-relative paths — order IS attach order (drives
// run-time injection order); persisted verbatim, never the document text.
export const SetAttachedDocsBody = z.object({
  paths: z.array(z.string()),
});
export type SetAttachedDocsBody = z.infer<typeof SetAttachedDocsBody>;

export const SaveDocumentBody = z.object({
  path: z.string(),
  text: z.string(),
});
export type SaveDocumentBody = z.infer<typeof SaveDocumentBody>;
