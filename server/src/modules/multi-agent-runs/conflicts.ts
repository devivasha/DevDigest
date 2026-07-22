import type { Conflict, ConflictTake, Severity } from '@devdigest/shared';

/**
 * T3 — Pure conflict grouping (multi-agent-review plan, Phase 2).
 *
 * Zero I/O, zero LLM — `computeConflicts` is plain arithmetic/grouping over
 * finding data already persisted and read by the repository (T4)/service
 * (T5). Deterministic: calling it twice with the same input always yields
 * the same output (AC-28).
 *
 * NOTE on input shape: the public `AgentColumn`/`AgentColumnFinding` contracts
 * in `@devdigest/shared` (`contracts/observability.ts`) only expose
 * `start_line` on a column's findings (no `end_line`) — that DTO is shaped
 * for the client's read response, not for conflict computation. Overlap
 * grouping needs the full `[start_line, end_line]` range, so this module
 * defines its own local input types (`ConflictColumnInput`/
 * `ConflictFindingInput`) carrying the fields it actually needs. The service
 * layer (T5) is expected to assemble this richer shape from persisted
 * `findings` rows (which do have `end_line`) before calling
 * `computeConflicts`, separately from the slimmer `AgentColumnFinding[]` it
 * builds for the `AgentColumn` response DTO.
 */

/** One finding as needed for conflict grouping (a subset of the full `Finding`). */
export interface ConflictFindingInput {
  id: string;
  file: string;
  start_line: number;
  end_line: number;
  severity: Severity;
  title: string;
}

/** One agent's column as needed for conflict grouping. */
export interface ConflictColumnInput {
  agent_id: string;
  /** Used as `ConflictTake.persona` — no dedicated persona field exists yet. */
  agent_name: string;
  status: 'done' | 'failed' | 'running';
  findings: ConflictFindingInput[];
}

const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 3,
  WARNING: 2,
  SUGGESTION: 1,
};

interface Range {
  file: string;
  start_line: number;
  end_line: number;
}

/**
 * Overlap predicate cribbed from `server/src/modules/eval/scorer.ts:36`
 * (`matches`): same file, and the two `[start_line, end_line]` ranges
 * intersect.
 */
function overlaps(a: Range, b: Range): boolean {
  return a.file === b.file && Math.max(a.start_line, b.start_line) <= Math.min(a.end_line, b.end_line);
}

interface Tagged {
  agentId: string;
  agentName: string;
  finding: ConflictFindingInput;
}

/**
 * Tiny union-find so pairwise-overlapping findings cluster transitively.
 * `i`/`a`/`b` are always valid indices into `parent` (bounded 0..size-1 by
 * every call site below) — the non-null assertions reflect that invariant,
 * not an unchecked assumption about external input.
 */
function makeUnionFind(size: number) {
  const parent = Array.from({ length: size }, (_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  return { find, union };
}

/** Deterministic tie-break: lowest start_line, then title (alphabetical). */
function compareFindings(a: Tagged, b: Tagged): number {
  if (a.finding.start_line !== b.finding.start_line) {
    return a.finding.start_line - b.finding.start_line;
  }
  return a.finding.title.localeCompare(b.finding.title);
}

/** Lowest-start_line/title representative of a non-empty group of tagged findings. */
function representativeOf(items: Tagged[]): Tagged {
  return items.reduce((best, current) => (compareFindings(current, best) < 0 ? current : best));
}

/** Deterministic "most severe" finding among a non-empty list of one agent's own items. */
function mostSevereOf(items: Tagged[]): Tagged {
  return items.reduce((best, current) => {
    const rankDiff = SEVERITY_RANK[current.finding.severity] - SEVERITY_RANK[best.finding.severity];
    if (rankDiff > 0) return current;
    if (rankDiff < 0) return best;
    return compareFindings(current, best) < 0 ? current : best;
  });
}

/**
 * computeConflicts — group persisted findings from COMPLETED agents only by
 * same file + overlapping line range, and emit one `Conflict` per group that
 * is an actual disagreement: at least one completed agent flagged the
 * location AND at least one other completed agent did not, OR the agents
 * that did flag it assigned divergent severities. Agreement groups (every
 * completed agent flags the same severity, or nobody flags it at all) are
 * NOT conflicts and are omitted from the result.
 *
 * `failed`/`running` columns are excluded entirely (AC-22) — their findings
 * never enter the grouping and they never appear in a `takes` array. Fewer
 * than two completed (reviewing) agents can never disagree, so the result is
 * always `[]` in that case (never a crash or a blank/undefined return).
 *
 * A single agent emitting two overlapping findings at the same location is
 * NOT a special-cased "intra-agent dedup" — both findings still enter the
 * grouping normally. What guarantees a single `ConflictTake` per agent is
 * that takes are built one-per-completed-column (not one-per-finding); when
 * an agent has more than one finding in a group, its one take uses the most
 * severe of its own findings (deterministic tie-break by line then title).
 */
export function computeConflicts(columns: ConflictColumnInput[]): Conflict[] {
  const completed = columns.filter((c) => c.status === 'done');
  if (completed.length < 2) return [];

  const tagged: Tagged[] = [];
  for (const col of completed) {
    for (const finding of col.findings) {
      tagged.push({ agentId: col.agent_id, agentName: col.agent_name, finding });
    }
  }
  if (tagged.length === 0) return [];

  const { find, union } = makeUnionFind(tagged.length);
  for (let i = 0; i < tagged.length; i++) {
    for (let j = i + 1; j < tagged.length; j++) {
      if (overlaps(tagged[i]!.finding, tagged[j]!.finding)) union(i, j);
    }
  }

  const groups = new Map<number, Tagged[]>();
  for (let i = 0; i < tagged.length; i++) {
    const root = find(i);
    const bucket = groups.get(root);
    if (bucket) bucket.push(tagged[i]!);
    else groups.set(root, [tagged[i]!]);
  }

  const conflicts: Conflict[] = [];

  // Deterministic group ordering: by file, then by the group's smallest start_line.
  const orderedGroups = Array.from(groups.values()).sort((a, b) => {
    const repA = representativeOf(a);
    const repB = representativeOf(b);
    if (repA.finding.file !== repB.finding.file) return repA.finding.file.localeCompare(repB.finding.file);
    return compareFindings(repA, repB);
  });

  for (const group of orderedGroups) {
    const byAgent = new Map<string, Tagged[]>();
    for (const item of group) {
      const bucket = byAgent.get(item.agentId);
      if (bucket) bucket.push(item);
      else byAgent.set(item.agentId, [item]);
    }

    const takes: ConflictTake[] = completed.map((col) => {
      const items = byAgent.get(col.agent_id);
      if (!items || items.length === 0) {
        return {
          agent_id: col.agent_id,
          persona: col.agent_name,
          verdict: 'ignored',
          note: 'did not flag',
        };
      }
      const chosen = mostSevereOf(items);
      return {
        agent_id: col.agent_id,
        persona: col.agent_name,
        verdict: chosen.finding.severity,
        note: chosen.finding.title,
      };
    });

    const flagged = takes.filter((t) => t.verdict !== 'ignored');
    const ignored = takes.filter((t) => t.verdict === 'ignored');
    const distinctSeverities = new Set(flagged.map((t) => t.verdict));
    const isConflict = (flagged.length > 0 && ignored.length > 0) || distinctSeverities.size > 1;
    if (!isConflict) continue;

    const rep = representativeOf(group);
    conflicts.push({
      file: rep.finding.file,
      line: rep.finding.start_line,
      title: rep.finding.title,
      takes,
    });
  }

  return conflicts;
}
