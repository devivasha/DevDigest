import type { SmartDiff, SmartDiffFile, SmartDiffRole } from '@devdigest/shared';

export const LARGE_PR_THRESHOLD = 500;
export const LARGE_FILE_THRESHOLD = 200;

/**
 * Derives a short "What this does" summary from the file's patch without any
 * LLM call. Strategy (in priority order):
 *   1. Named exports / functions / classes in added lines — "Adds: rateLimit, bucketKey"
 *   2. First meaningful added line that isn't an import or comment
 *   3. null (caller will hide the section)
 */
export function deriveFileSummary(patch: string | null | undefined): string | null {
  if (!patch) return null;

  const addedLines = patch
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1).trim())
    .filter((l) => l.length > 4);

  // Collect up to 3 named symbols from export / function / class declarations.
  const names: string[] = [];
  for (const line of addedLines) {
    const m =
      line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/) ??
      line.match(/(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/) ??
      line.match(/export\s+(?:const|let|var)\s+(\w+)/) ??
      line.match(/export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)/);
    if (m?.[1] && !names.includes(m[1])) names.push(m[1]);
    if (names.length >= 3) break;
  }
  if (names.length > 0) return `Adds: ${names.join(', ')}`;

  // Fallback: first meaningful added line (skip imports, comments, braces).
  const fallback = addedLines.find(
    (l) =>
      l.length > 12 &&
      !l.startsWith('import ') &&
      !l.startsWith('//') &&
      !l.startsWith('*') &&
      !l.startsWith('/*') &&
      l !== '{' &&
      l !== '}',
  );
  if (!fallback) return null;
  return fallback.length > 120 ? fallback.slice(0, 120) + '…' : fallback;
}

// Checked first — these always win over wiring/core.
export const BOILERPLATE_PATTERNS: RegExp[] = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.lock$/,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.next\//,
  /\.min\.(js|css)$/,
  /\/__snapshots__\//,
  /\.snap$/,
  /\.generated\.(ts|js)$/,
  /drizzle\/.*\.sql$/,
];

// Checked second — DI wiring, configs, entry-points.
export const WIRING_PATTERNS: RegExp[] = [
  /(^|\/)index\.(ts|tsx|js|jsx)$/,
  /(^|\/)app\.(ts|tsx|js)$/,
  /(^|\/)server\.(ts|js)$/,
  /(^|\/)main\.(ts|js)$/,
  /\.config\.(ts|js|cjs|mjs)$/,
  /(^|\/)config\.(ts|js)$/,
  /\.env(\.|$)/,
  /docker-compose/,
  /Dockerfile/,
  /tsconfig.*\.json$/,
  /next\.config\./,
];

export function classifyFile(path: string): SmartDiffRole {
  if (BOILERPLATE_PATTERNS.some((p) => p.test(path))) return 'boilerplate';
  if (WIRING_PATTERNS.some((p) => p.test(path))) return 'wiring';
  return 'core';
}

/**
 * Buckets already-enriched SmartDiffFile rows into core/wiring/boilerplate
 * groups and derives the "too big" split suggestion — pure, no I/O. Callers
 * (e.g. GET /pulls/:id/smart-diff, the Why+Risk Brief service) build the
 * SmartDiffFile[] (dedup-by-path, finding_lines, pseudocode_summary) and pass
 * it in here. Returns an empty-`groups` SmartDiff (never throws) when `files`
 * is empty — e.g. a title-only PR with no changed files.
 */
export function groupSmartDiff(files: SmartDiffFile[]): SmartDiff {
  const buckets = new Map<SmartDiffRole, SmartDiffFile[]>([
    ['core', []],
    ['wiring', []],
    ['boilerplate', []],
  ]);
  let totalLines = 0;
  for (const f of files) {
    const role = classifyFile(f.path);
    buckets.get(role)!.push(f);
    totalLines += f.additions + f.deletions;
  }

  const boilerplatePaths = (buckets.get('boilerplate') ?? []).map((f) => f.path);
  const corePaths = [
    ...(buckets.get('core') ?? []),
    ...(buckets.get('wiring') ?? []),
  ].map((f) => f.path);
  const proposed_splits =
    totalLines > LARGE_PR_THRESHOLD && boilerplatePaths.length > 0
      ? [
          { name: 'Logic changes', files: corePaths },
          { name: 'Lockfile / generated', files: boilerplatePaths },
        ]
      : [];

  return {
    groups: (['core', 'wiring', 'boilerplate'] as SmartDiffRole[])
      .map((role) => ({ role, files: buckets.get(role)! }))
      .filter((g) => g.files.length > 0),
    split_suggestion: {
      too_big: totalLines > LARGE_PR_THRESHOLD,
      total_lines: totalLines,
      proposed_splits,
    },
  };
}
