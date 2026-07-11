/**
 * AC-19/AC-21 — resolveSpecPaths: agent-first, then skills in load order,
 * dedupe keeping the FIRST occurrence.
 */
import { describe, it, expect } from 'vitest';
import { resolveSpecPaths } from './injection.js';

describe('resolveSpecPaths', () => {
  it('orders agent paths first, then each skill in load order, deduping first-wins', () => {
    const result = resolveSpecPaths({
      agentPaths: ['a', 'b'],
      loadedSkills: [{ paths: ['b', 'c'] }, { paths: ['a', 'd'] }],
    });

    expect(result).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns [] when there are no agent paths and no loaded skills', () => {
    expect(resolveSpecPaths({ agentPaths: [], loadedSkills: [] })).toEqual([]);
  });

  it('does not filter by any "enabled" concept — trusts loadedSkills as given', () => {
    // resolveSpecPaths has no `enabled` field on its input at all; passing
    // only the paths the caller already decided to include is the contract.
    const result = resolveSpecPaths({
      agentPaths: [],
      loadedSkills: [{ paths: ['only-this-one'] }],
    });
    expect(result).toEqual(['only-this-one']);
  });
});
