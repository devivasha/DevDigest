/**
 * blast/service.ts — application layer for the Blast Radius feature (T2).
 *
 * ZERO LLM calls: everything here reads from `container.repoIntel` (the
 * repo-intel facade, built at clone/index time) plus a prior-PRs DB query.
 * The `summary` field is a deterministic interpolated string — no provider
 * is ever invoked.
 *
 * Mapping notes (facade camelCase `BlastResult` -> contract snake_case
 * `BlastResponse`):
 *   - `downstream[]` is built for EVERY changed symbol (even those with zero
 *     callers), grouped by `viaSymbol`, in `changedSymbols` order. Callers are
 *     already cross-file / decl-file-excluded / rank-sorted by the facade —
 *     we only cap at `MAX_CALLERS_PER_SYMBOL`, never re-sort or re-filter.
 *   - Per-symbol `endpoints_affected` / `crons_affected` come from
 *     `factsByFile[callerFile]`, which is ABSENT on the degraded/ripgrep path
 *     — those unions collapse to `[]` in that case.
 *   - Top-level `impacted_endpoints` ALWAYS comes from the facade's flat
 *     `impactedEndpoints` (populated even when degraded).
 *   - Top-level `impacted_crons` is the union of `factsByFile[*].crons`
 *     (empty when degraded, since `factsByFile` is absent).
 */
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { BlastResponse, DownstreamImpact, PrHistoryItem } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import { MAX_CALLERS_PER_SYMBOL } from '../repo-intel/constants.js';

/** Cap on the number of prior-PRs history entries returned. */
const MAX_HISTORY_ITEMS = 10;

/**
 * A caller living in a test file isn't a meaningful "blast radius" — changing
 * a symbol doesn't break its tests the way it breaks a production consumer, and
 * test files carry endpoint/cron string literals (fixtures) that would flood
 * the card with false "impacted endpoints". So test-file callers are excluded
 * from downstream callers AND from the top-level endpoint/cron unions.
 */
function isTestFile(path: string): boolean {
  return /(^|\/)(test|tests|__tests__|__mocks__|e2e)\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
}

/** Row shape as read from `pullRequests` (drizzle select result). */
type PullRequestRow = typeof t.pullRequests.$inferSelect;

export class BlastService {
  constructor(private container: Container) {}

  async getBlast(
    workspaceId: string,
    pr: PullRequestRow,
    changedPaths: string[],
  ): Promise<BlastResponse> {
    const [blast, state, history] = await Promise.all([
      this.container.repoIntel.getBlastRadius(pr.repoId, changedPaths),
      this.container.repoIntel.getIndexState(pr.repoId),
      this.getHistory(workspaceId, pr, changedPaths),
    ]);

    const downstream: DownstreamImpact[] = blast.changedSymbols.map((sym) => {
      const callers = blast.callers
        .filter((c) => c.viaSymbol === sym.name && !isTestFile(c.file))
        .slice(0, MAX_CALLERS_PER_SYMBOL)
        .map((c) => ({ name: c.symbol, file: c.file, line: c.line }));

      const endpoints = new Set<string>();
      const crons = new Set<string>();
      for (const caller of callers) {
        const facts = blast.factsByFile?.[caller.file];
        if (!facts) continue;
        for (const e of facts.endpoints) endpoints.add(e);
        for (const c of facts.crons) crons.add(c);
      }

      return {
        symbol: sym.name,
        callers,
        endpoints_affected: [...endpoints],
        crons_affected: [...crons],
      };
    });

    // Top-level unions come ONLY from non-test caller files. When the facade
    // provides per-file facts (persistent path) we union those, skipping test
    // files; otherwise (degraded ripgrep path) there's no file attribution, so
    // we fall back to the flat list unfiltered.
    const impactedEndpoints = new Set<string>();
    const impactedCrons = new Set<string>();
    if (blast.factsByFile) {
      const nonTestCallerFiles = new Set(
        blast.callers.filter((c) => !isTestFile(c.file)).map((c) => c.file),
      );
      for (const [file, facts] of Object.entries(blast.factsByFile)) {
        if (!nonTestCallerFiles.has(file)) continue;
        for (const e of facts.endpoints) impactedEndpoints.add(e);
        for (const c of facts.crons) impactedCrons.add(c);
      }
    } else {
      for (const e of blast.impactedEndpoints) impactedEndpoints.add(e);
    }

    const totalCallers = downstream.reduce((sum, d) => sum + d.callers.length, 0);
    const summary = `${blast.changedSymbols.length} symbol(s) changed, ${totalCallers} downstream caller(s), ${impactedEndpoints.size} endpoint(s) impacted.`;

    return {
      changed_symbols: blast.changedSymbols.map((s) => ({ name: s.name, file: s.file, kind: s.kind })),
      downstream,
      impacted_endpoints: [...impactedEndpoints],
      impacted_crons: [...impactedCrons],
      status: state.status,
      degraded: Boolean(blast.degraded || state.degraded),
      degraded_reason: blast.reason ?? state.degradedReason ?? undefined,
      history,
      summary,
    };
  }

  /**
   * Prior PRs (same repo + workspace, excluding this PR) that touched at
   * least one of the currently-changed paths. Joins `prFiles` -> `pullRequests`
   * so multiple overlapping-file rows collapse into one history item per PR,
   * with `files_overlap` accumulating every matching path. Ordered by most
   * recently updated PR first, capped at `MAX_HISTORY_ITEMS`.
   */
  private async getHistory(
    workspaceId: string,
    pr: PullRequestRow,
    changedPaths: string[],
  ): Promise<PrHistoryItem[]> {
    if (changedPaths.length === 0) return [];

    const rows = await this.container.db
      .select({
        id: t.pullRequests.id,
        number: t.pullRequests.number,
        title: t.pullRequests.title,
        author: t.pullRequests.author,
        openedAt: t.pullRequests.openedAt,
        updatedAt: t.pullRequests.updatedAt,
        path: t.prFiles.path,
      })
      .from(t.prFiles)
      .innerJoin(t.pullRequests, eq(t.prFiles.prId, t.pullRequests.id))
      .where(
        and(
          eq(t.pullRequests.workspaceId, workspaceId),
          eq(t.pullRequests.repoId, pr.repoId),
          ne(t.pullRequests.id, pr.id),
          inArray(t.prFiles.path, changedPaths),
        ),
      )
      .orderBy(desc(t.pullRequests.updatedAt));

    // Rows are ordered by updatedAt DESC already; collapse into one entry per
    // PR (first-seen order = most-recent-first) while accumulating the
    // overlapping paths for that PR.
    const order: string[] = [];
    const byPr = new Map<
      string,
      { number: number; title: string; author: string; openedAt: Date | null; updatedAt: Date | null; paths: Set<string> }
    >();
    for (const row of rows) {
      let entry = byPr.get(row.id);
      if (!entry) {
        entry = {
          number: row.number,
          title: row.title,
          author: row.author,
          openedAt: row.openedAt,
          updatedAt: row.updatedAt,
          paths: new Set(),
        };
        byPr.set(row.id, entry);
        order.push(row.id);
      }
      entry.paths.add(row.path);
    }

    return order.slice(0, MAX_HISTORY_ITEMS).map((id) => {
      const entry = byPr.get(id)!;
      const mergedAt = entry.updatedAt ?? entry.openedAt;
      return {
        pr_number: entry.number,
        title: entry.title,
        merged_at: mergedAt ? mergedAt.toISOString() : '',
        author: entry.author,
        files_overlap: [...entry.paths],
        notes: '',
      };
    });
  }
}
