/**
 * AC-9/AC-10/AC-14 — AgentsRepository.setAttachedDocs persists the exact
 * ordered path array and leaves `version` untouched (reorders never bump it).
 *
 * Hermetic: mocks the Drizzle `Db` query-builder chain directly (the same
 * convention as `reviews/repository/run.repo.severity.test.ts` — no real
 * Postgres, no testcontainers).
 */
import { describe, it, expect, vi } from 'vitest';
import { AgentsRepository } from './repository.js';
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

describe('AgentsRepository.setAttachedDocs', () => {
  it('persists the exact ordered path array and touches no other column', async () => {
    const existingRow = { id: 'agent-1', version: 3, attachedDocPaths: [] };
    const { db, setCalls } = makeUpdateDb([{ ...existingRow, attachedDocPaths: ['a.md', 'b.md'] }]);
    const repo = new AgentsRepository(db);

    const result = await repo.setAttachedDocs('ws-1', 'agent-1', ['a.md', 'b.md']);

    // The .set() payload is EXACTLY { attachedDocPaths } — nothing else
    // (proves version/name/etc. are never part of this write).
    expect(setCalls).toEqual([{ attachedDocPaths: ['a.md', 'b.md'] }]);
    expect(result?.attachedDocPaths).toEqual(['a.md', 'b.md']);
    expect(result?.version).toBe(3); // unchanged from the row the DB "returned"
  });

  it('reordering the same paths persists the new order and still does not bump version', async () => {
    const { db, setCalls } = makeUpdateDb([
      { id: 'agent-1', version: 1, attachedDocPaths: ['b.md', 'a.md'] },
    ]);
    const repo = new AgentsRepository(db);

    const result = await repo.setAttachedDocs('ws-1', 'agent-1', ['b.md', 'a.md']);

    expect(setCalls).toEqual([{ attachedDocPaths: ['b.md', 'a.md'] }]);
    expect(result?.attachedDocPaths).toEqual(['b.md', 'a.md']);
    expect(result?.version).toBe(1);
  });

  it('returns undefined when no matching agent exists in the workspace', async () => {
    const { db } = makeUpdateDb([]);
    const repo = new AgentsRepository(db);

    const result = await repo.setAttachedDocs('ws-1', 'missing-agent', ['a.md']);

    expect(result).toBeUndefined();
  });
});
