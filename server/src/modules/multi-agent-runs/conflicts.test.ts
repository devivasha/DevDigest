import { describe, expect, it } from 'vitest';
import { computeConflicts, type ConflictColumnInput, type ConflictFindingInput } from './conflicts.js';

function finding(over: Partial<ConflictFindingInput> = {}): ConflictFindingInput {
  return {
    id: 'f-default',
    file: 'src/a.ts',
    start_line: 10,
    end_line: 12,
    severity: 'WARNING',
    title: 'Default finding',
    ...over,
  };
}

function column(over: Partial<ConflictColumnInput> = {}): ConflictColumnInput {
  return {
    agent_id: 'agent-default',
    agent_name: 'Agent Default',
    status: 'done',
    findings: [],
    ...over,
  };
}

describe('computeConflicts', () => {
  it('groups overlapping findings in the same file from different completed agents (AC-18)', () => {
    const columns: ConflictColumnInput[] = [
      column({
        agent_id: 'a1',
        agent_name: 'Security Bot',
        findings: [finding({ id: 'f1', file: 'src/a.ts', start_line: 10, end_line: 12, severity: 'CRITICAL', title: 'SQL injection' })],
      }),
      column({
        agent_id: 'a2',
        agent_name: 'Perf Bot',
        findings: [], // did not flag -> conflict since a1 flagged, a2 did not
      }),
    ];

    const conflicts = computeConflicts(columns);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.file).toBe('src/a.ts');
    expect(conflicts[0]!.takes).toHaveLength(2);
  });

  it('does not group findings in different files or non-overlapping ranges (AC-18)', () => {
    const columns: ConflictColumnInput[] = [
      column({
        agent_id: 'a1',
        agent_name: 'A1',
        findings: [
          finding({ id: 'f1', file: 'src/a.ts', start_line: 1, end_line: 3, severity: 'CRITICAL', title: 'Issue A' }),
          finding({ id: 'f2', file: 'src/b.ts', start_line: 1, end_line: 3, severity: 'CRITICAL', title: 'Issue B (diff file)' }),
          finding({ id: 'f3', file: 'src/a.ts', start_line: 50, end_line: 55, severity: 'CRITICAL', title: 'Issue C (non-overlap)' }),
        ],
      }),
      column({
        agent_id: 'a2',
        agent_name: 'A2',
        findings: [], // a2 flags nothing anywhere -> every one of a1's findings is a conflict (a2 "did not flag")
      }),
    ];

    const conflicts = computeConflicts(columns);
    // Three separate groups: (src/a.ts:1-3), (src/b.ts:1-3), (src/a.ts:50-55) — none merged.
    expect(conflicts).toHaveLength(3);
    const files = conflicts.map((c) => `${c.file}:${c.line}`).sort();
    expect(files).toEqual(['src/a.ts:1', 'src/a.ts:50', 'src/b.ts:1']);
  });

  it('marks a completed agent that reviewed but did not flag the location as "did not flag" (AC-19)', () => {
    const columns: ConflictColumnInput[] = [
      column({
        agent_id: 'a1',
        agent_name: 'Flagger',
        findings: [finding({ id: 'f1', severity: 'WARNING', title: 'Something off' })],
      }),
      column({ agent_id: 'a2', agent_name: 'Silent', findings: [] }),
    ];

    const conflicts = computeConflicts(columns);
    expect(conflicts).toHaveLength(1);
    const silentTake = conflicts[0]!.takes.find((t) => t.agent_id === 'a2');
    expect(silentTake).toBeDefined();
    expect(silentTake?.verdict).toBe('ignored');
    expect(silentTake?.note).toBe('did not flag');
  });

  it('classifies agreement (same severity, all flag) as NOT a conflict, and divergent severities as a conflict (AC-20)', () => {
    const agreeing: ConflictColumnInput[] = [
      column({
        agent_id: 'a1',
        agent_name: 'A1',
        findings: [finding({ id: 'f1', severity: 'WARNING', title: 'Same issue' })],
      }),
      column({
        agent_id: 'a2',
        agent_name: 'A2',
        findings: [finding({ id: 'f2', severity: 'WARNING', title: 'Same issue' })],
      }),
    ];
    expect(computeConflicts(agreeing)).toEqual([]);

    const diverging: ConflictColumnInput[] = [
      column({
        agent_id: 'a1',
        agent_name: 'A1',
        findings: [finding({ id: 'f1', severity: 'CRITICAL', title: 'Big deal' })],
      }),
      column({
        agent_id: 'a2',
        agent_name: 'A2',
        findings: [finding({ id: 'f2', severity: 'SUGGESTION', title: 'Minor nit' })],
      }),
    ];
    const conflicts = computeConflicts(diverging);
    expect(conflicts).toHaveLength(1);
    const severities = conflicts[0]!.takes.map((t) => t.verdict).sort();
    expect(severities).toEqual(['CRITICAL', 'SUGGESTION']);
  });

  it('excludes failed and running agents from takes entirely (AC-22)', () => {
    const columns: ConflictColumnInput[] = [
      column({
        agent_id: 'a1',
        agent_name: 'A1',
        findings: [finding({ id: 'f1', severity: 'CRITICAL', title: 'Vuln' })],
      }),
      column({ agent_id: 'a2', agent_name: 'A2', status: 'failed', findings: [] }),
      column({ agent_id: 'a3', agent_name: 'A3', status: 'running', findings: [] }),
    ];

    // Only one COMPLETED agent (a1) -> fewer than 2 completed reviewers -> never a conflict.
    expect(computeConflicts(columns)).toEqual([]);

    const withSecondCompleted: ConflictColumnInput[] = [
      ...columns,
      column({ agent_id: 'a4', agent_name: 'A4', status: 'done', findings: [] }),
    ];
    const conflicts = computeConflicts(withSecondCompleted);
    expect(conflicts).toHaveLength(1);
    const agentIds = conflicts[0]!.takes.map((t) => t.agent_id).sort();
    expect(agentIds).toEqual(['a1', 'a4']);
    expect(agentIds).not.toContain('a2');
    expect(agentIds).not.toContain('a3');
  });

  it('never crashes or returns undefined with fewer than 2 completed agents (gotcha)', () => {
    expect(computeConflicts([])).toEqual([]);
    expect(computeConflicts([column({ agent_id: 'solo', findings: [finding()] })])).toEqual([]);
    expect(
      computeConflicts([
        column({ agent_id: 'a1', status: 'failed', findings: [finding()] }),
        column({ agent_id: 'a2', status: 'running', findings: [] }),
      ]),
    ).toEqual([]);
  });

  it('computing twice over the same input yields identical output (AC-28 determinism)', () => {
    const columns: ConflictColumnInput[] = [
      column({
        agent_id: 'a1',
        agent_name: 'A1',
        findings: [
          finding({ id: 'f1', file: 'src/a.ts', start_line: 10, end_line: 12, severity: 'CRITICAL', title: 'Issue' }),
          finding({ id: 'f2', file: 'src/b.ts', start_line: 5, end_line: 8, severity: 'WARNING', title: 'Other issue' }),
        ],
      }),
      column({
        agent_id: 'a2',
        agent_name: 'A2',
        findings: [finding({ id: 'f3', file: 'src/a.ts', start_line: 11, end_line: 11, severity: 'SUGGESTION', title: 'Nit' })],
      }),
      column({ agent_id: 'a3', agent_name: 'A3', findings: [] }),
    ];

    const first = computeConflicts(columns);
    const second = computeConflicts(columns);
    expect(second).toEqual(first);
  });

  it('does not create a spurious self-conflict when one agent emits two overlapping findings at the same location', () => {
    const columns: ConflictColumnInput[] = [
      column({
        agent_id: 'a1',
        agent_name: 'DoubleFlagger',
        findings: [
          finding({ id: 'f1', file: 'src/a.ts', start_line: 10, end_line: 12, severity: 'WARNING', title: 'First flag' }),
          finding({ id: 'f2', file: 'src/a.ts', start_line: 11, end_line: 13, severity: 'CRITICAL', title: 'Second flag, same spot' }),
        ],
      }),
      // a2 reviewed but did not flag this location at all -> the group is a
      // real conflict (flagged vs. did-not-flag), not because a1 "disagreed
      // with itself" between its own two findings.
      column({ agent_id: 'a2', agent_name: 'Silent', findings: [] }),
    ];

    const conflicts = computeConflicts(columns);
    // a1 still contributes exactly ONE take, not two, even though it has two
    // overlapping findings at this location.
    expect(conflicts).toHaveLength(1);
    const a1Takes = conflicts[0]!.takes.filter((t) => t.agent_id === 'a1');
    expect(a1Takes).toHaveLength(1);
    // Deterministic: picks the most severe of its own two findings.
    expect(a1Takes[0]!.verdict).toBe('CRITICAL');
    const a2Take = conflicts[0]!.takes.find((t) => t.agent_id === 'a2');
    expect(a2Take?.verdict).toBe('ignored');
  });
});
