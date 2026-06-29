import type { SmartDiffRole } from '@devdigest/shared';

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
