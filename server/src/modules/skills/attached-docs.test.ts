/**
 * AC-14/AC-16 — SkillsRepository.setAttachedDocs persists the exact ordered
 * path array and leaves `version`, `evidenceFiles`, AND `threatLevel`
 * untouched (unlike `update()`, which resets `threatLevel` on a body change).
 *
 * Hermetic: mocks the Drizzle `Db` query-builder chain directly (same
 * convention as `reviews/repository/run.repo.severity.test.ts` and the
 * sibling `agents/attached-docs.test.ts` — no real Postgres).
 */
import { describe, it, expect, vi } from 'vitest';
import { SkillsRepository } from './repository.js';
import type { Db } from '../../db/client.js';

/** Build a mock Db whose `.update(...).set(...).where(...).returning()` chain
 *  resolves to `returning`, and records exactly what `.set()` was called with. */
function makeUpdateDb(returning: unknown[]): { db: Db; setCalls: unknown[] } {
  const setCalls: unknown[] = [];
  const chain = {
    set: vi.fn((values: unknown) => {
      setCalls.push(values);
      return chain;
    }),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returning),
  };
  const db = { update: vi.fn().mockReturnValue(chain) } as unknown as Db;
  return { db, setCalls };
}

describe('SkillsRepository.setAttachedDocs', () => {
  it('persists the exact ordered path array and touches no other column', async () => {
    const { db, setCalls } = makeUpdateDb([
      {
        id: 'skill-1',
        version: 5,
        evidenceFiles: ['conv1.md', 'conv2.md'],
        threatLevel: 'suspicious',
        attachedDocPaths: ['a.md', 'b.md'],
      },
    ]);
    const repo = new SkillsRepository(db);

    const result = await repo.setAttachedDocs('ws-1', 'skill-1', ['a.md', 'b.md']);

    // The .set() payload is EXACTLY { attachedDocPaths } — proves version,
    // evidenceFiles, and threatLevel are never part of this write.
    expect(setCalls).toEqual([{ attachedDocPaths: ['a.md', 'b.md'] }]);
    expect(result?.attachedDocPaths).toEqual(['a.md', 'b.md']);
    expect(result?.version).toBe(5);
    expect(result?.evidenceFiles).toEqual(['conv1.md', 'conv2.md']);
    expect(result?.threatLevel).toBe('suspicious');
  });

  it('reordering persists the new order and still leaves version/evidenceFiles/threatLevel untouched', async () => {
    const { db, setCalls } = makeUpdateDb([
      {
        id: 'skill-1',
        version: 5,
        evidenceFiles: ['conv1.md', 'conv2.md'],
        threatLevel: 'suspicious',
        attachedDocPaths: ['b.md', 'a.md'],
      },
    ]);
    const repo = new SkillsRepository(db);

    const result = await repo.setAttachedDocs('ws-1', 'skill-1', ['b.md', 'a.md']);

    expect(setCalls).toEqual([{ attachedDocPaths: ['b.md', 'a.md'] }]);
    expect(result?.attachedDocPaths).toEqual(['b.md', 'a.md']);
    expect(result?.version).toBe(5);
    expect(result?.evidenceFiles).toEqual(['conv1.md', 'conv2.md']);
    expect(result?.threatLevel).toBe('suspicious');
  });

  it('returns undefined when no matching skill exists in the workspace', async () => {
    const { db } = makeUpdateDb([]);
    const repo = new SkillsRepository(db);

    const result = await repo.setAttachedDocs('ws-1', 'missing-skill', ['a.md']);

    expect(result).toBeUndefined();
  });
});
