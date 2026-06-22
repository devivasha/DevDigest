import type { ConventionCandidate } from '@devdigest/shared';
import type { ConventionRow } from './repository.js';

/** Map a DB row to the public ConventionCandidate DTO. */
export function toConventionDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    category: row.category ?? '',
    rule: row.rule,
    evidence_path: row.evidencePath ?? '',
    evidence_snippet: row.evidenceSnippet ?? '',
    confidence: row.confidence ?? 0,
    accepted: row.accepted,
  };
}

/**
 * Render accepted conventions into a single skill markdown body,
 * grouped by category.
 */
export function buildSkillBody(repoName: string, candidates: ConventionCandidate[]): string {
  const accepted = candidates.filter((c) => c.accepted);
  if (accepted.length === 0) return '';

  const byCategory = new Map<string, ConventionCandidate[]>();
  for (const c of accepted) {
    const arr = byCategory.get(c.category) ?? [];
    arr.push(c);
    byCategory.set(c.category, arr);
  }

  const lines: string[] = [
    `# ${repoName}-conventions`,
    '',
    `House conventions for \`${repoName}\`. Flag changes that violate any rule below and cite the offending \`file:line\`.`,
    '',
  ];

  for (const [cat, items] of byCategory) {
    lines.push(`## ${cat}`, '');
    for (const item of items) {
      lines.push(`**${item.rule}**`, '');
      if (item.evidence_path) {
        lines.push(`Detected in \`${item.evidence_path}\`:`, '');
        if (item.evidence_snippet) {
          lines.push('```', item.evidence_snippet, '```', '');
        }
      }
    }
  }

  return lines.join('\n').trimEnd();
}

/** Config filenames to probe in the repo root regardless of rank. */
export const CONFIG_FILES = [
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  'eslint.config.js',
  'eslint.config.ts',
  'tsconfig.json',
  'tsconfig.base.json',
  '.prettierrc',
  '.prettierrc.json',
  'prettier.config.js',
  '.prettierrc.cjs',
  '.editorconfig',
] as const;
