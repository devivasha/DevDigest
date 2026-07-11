/**
 * Discovery — finds repo markdown docs under `specs|docs|insights` folders
 * (any depth) in a repo's clone working tree, so a human can attach them to
 * an Agent/Skill. This is the infrastructure-layer I/O for Project Context;
 * `service.ts` (T7) is the only intended caller.
 *
 * Reads paths + file SIZES only — NEVER file bodies. `estimated_tokens` is
 * derived from `fs.stat().size` via the same char/4 heuristic as
 * `approxTokens` (`adapters/tokenizer/index.ts`), applied to byte length
 * instead of string length since we don't read the file content. This keeps
 * the NFR (p95 ≤ 2s for ≤5k files) achievable, but means the estimate can
 * differ slightly from a real tokenizer count — particularly for files with
 * multi-byte UTF-8 characters, where byte length overstates char count. The
 * actual file body is only ever read later, at run-time injection (T10).
 */
import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { DiscoveredDocument, DiscoverySummary } from '@devdigest/shared';
import type { Tokenizer } from '../../adapters/tokenizer/index.js';
import { BUCKETS, type BucketName } from './constants.js';

/** Directories skipped entirely while walking — never descended into. */
const SKIP_DIRS = new Set(['.git', 'node_modules']);

const BUCKET_SET = new Set<string>(BUCKETS);

function isBucketName(segment: string): segment is BucketName {
  return BUCKET_SET.has(segment);
}

/**
 * Determine the bucket for a `/`-normalized repo-relative path, or `null` if
 * none of its directory segments are a configured bucket.
 *
 * "Outermost bucket wins": segments are scanned left-to-right (i.e. from the
 * repo root inward) and the FIRST one found in `BUCKETS` is returned. E.g.
 * `docs/specs/x.md` → bucket `docs`, NOT `specs`, because `docs` is
 * encountered first walking down from the root. This makes bucket assignment
 * deterministic and stable across repeated runs (AC-4).
 */
function bucketFor(normalizedRelPath: string): BucketName | null {
  const segments = normalizedRelPath.split('/');
  // The last segment is the filename itself — only directory segments count.
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    if (segment !== undefined && isBucketName(segment)) {
      return segment;
    }
  }
  return null;
}

/** Single DFS walk of the tree, collecting absolute paths of `.md` files. */
async function walk(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // Directory vanished mid-walk, or is unreadable — skip it rather than
    // fail the whole discovery pass.
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(join(dir, entry.name));
    }
  }
}

function emptySummary(refreshedAt: string): DiscoverySummary {
  return {
    document_count: 0,
    total_estimated_tokens: 0,
    refreshed_at: refreshedAt,
    clone_available: false,
  };
}

/**
 * Discover repo markdown docs under `specs|docs|insights` folders (any
 * depth) in `cloneRoot` — i.e. `**\/{specs,docs,insights}/**\/*.md` — and
 * nothing outside those folders.
 *
 * Returns an empty result with `clone_available: false` (never throws) when
 * `cloneRoot` is `null` or absent from disk (AC-5).
 *
 * `tokenizer` is accepted for interface stability — it's injected via
 * `ContainerOverrides.tokenizer` at the call site (T7) — but is intentionally
 * NOT invoked here. Discovery estimates tokens from file size alone (see
 * module doc comment above) and never reads a file body, so there is nothing
 * for a real encoder to tokenize at this stage. Keeping the parameter avoids
 * a signature change if a future revision needs a more precise, body-reading
 * estimate.
 */
export async function discover(
  cloneRoot: string | null,
  tokenizer: Tokenizer,
): Promise<{ documents: DiscoveredDocument[]; summary: DiscoverySummary }> {
  void tokenizer;

  const refreshedAt = new Date().toISOString();

  if (cloneRoot === null) {
    return { documents: [], summary: emptySummary(refreshedAt) };
  }

  try {
    const rootStat = await stat(cloneRoot);
    if (!rootStat.isDirectory()) {
      return { documents: [], summary: emptySummary(refreshedAt) };
    }
  } catch {
    return { documents: [], summary: emptySummary(refreshedAt) };
  }

  const candidatePaths: string[] = [];
  await walk(cloneRoot, candidatePaths);

  const documents: DiscoveredDocument[] = [];
  for (const absPath of candidatePaths) {
    const relPath = relative(cloneRoot, absPath).split(sep).join('/');
    const bucket = bucketFor(relPath);
    if (bucket === null) continue;

    let sizeBytes: number;
    try {
      sizeBytes = (await stat(absPath)).size;
    } catch {
      // File vanished between the walk and this stat — skip it.
      continue;
    }

    // Byte-length stand-in for `approxTokens`'s char/4 heuristic — see
    // module doc comment for why we don't read the body.
    const estimatedTokens = Math.ceil(sizeBytes / 4);

    documents.push({
      path: relPath,
      bucket,
      estimated_tokens: estimatedTokens,
    });
  }

  documents.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const totalEstimatedTokens = documents.reduce((sum, doc) => sum + doc.estimated_tokens, 0);

  return {
    documents,
    summary: {
      document_count: documents.length,
      total_estimated_tokens: totalEstimatedTokens,
      refreshed_at: refreshedAt,
      clone_available: true,
    },
  };
}
