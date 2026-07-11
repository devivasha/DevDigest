import type { Container } from "../../platform/container.js";
import type {
  DegradedReason,
  FileRankDetail,
  SetupCommand,
  StackFacts,
} from "../repo-intel/types.js";
import { CRITICAL_MAX, COMMANDS_MAX, READING_MAX, TOP_N } from "./constants.js";

/**
 * Deterministic fact bundle for the Onboarding Tour (AC-1, AC-2, AC-7, AC-9,
 * AC-19). Collected EXCLUSIVELY via `container.repoIntel` — no `container.db`,
 * no `container.llm`, no `fs`, no network. This makes "a stubbed facade fully
 * drives the facts" literally true and keeps this module at zero LLM cost.
 */
export interface OnboardingFacts {
  header: {
    /** `getIndexState().filesIndexed` — drives AC-2's header copy. */
    filesIndexed: number;
    /** `getIndexState().updatedAt` — kept (not the tour's own `generatedAt`)
     * so the service can compute the AC-16 stale compare on read. */
    indexUpdatedAt: Date;
    degraded: boolean;
    degradedReason?: DegradedReason;
  };
  /** Candidate files in `getTopFilesByRankDetailed` order (already
   * `rank DESC`), capped to `READING_MAX` (AC-9). */
  readingPath: FileRankDetail[];
  /** Top-200 candidates scored by the pinned AC-7 formula, sorted DESC,
   * capped to `CRITICAL_MAX`; `callerCount` = the file's importer count. */
  criticalCandidates: Array<{ path: string; rank: number; callerCount: number }>;
  /** Repo-wide "METHOD /path" inventory (unbounded by TOP_N by design). */
  routeInventory: string[];
  stack: StackFacts;
  /** `getSetupCommands().commands`, capped to `COMMANDS_MAX`. */
  commands: SetupCommand[];
  /** `getRepoMap().text` — narrative input only. */
  repoMapText: string;
}

/**
 * Collects `OnboardingFacts` for a repo. Uses ONLY `container.repoIntel.*`
 * (AC-1). Never calls `getCriticalPaths()` — AC-7 redefines "critical" via
 * rank + importer count, not dependency chains.
 */
export async function collectFacts(
  container: Container,
  repoId: string,
): Promise<OnboardingFacts> {
  const repoIntel = container.repoIntel;

  const [indexState, rankedFiles, routeInventory, stack, setupCommands, repoMap] =
    await Promise.all([
      repoIntel.getIndexState(repoId),
      repoIntel.getTopFilesByRankDetailed(repoId, TOP_N),
      repoIntel.getRouteInventory(repoId),
      repoIntel.getStackFacts(repoId),
      repoIntel.getSetupCommands(repoId),
      repoIntel.getRepoMap(repoId),
    ]);

  const importerCounts = await repoIntel.getFileImporterCounts(
    repoId,
    rankedFiles.map((f) => f.path),
  );

  // Reading path: already rank DESC from the facade — do not re-sort.
  const readingPath = rankedFiles.slice(0, READING_MAX);

  // Pinned AC-7 critical-score formula (must match the spec's plan text
  // verbatim — the test-writer computes expected order from this same
  // formula):
  //   imp(f)     = importerCounts[f] ?? 0
  //   maxImp     = max over the TOP_N candidate set of imp(f)  (0 if all zero)
  //   normImp(f) = maxImp > 0 ? imp(f) / maxImp : 0
  //   score(f)   = rank(f) * (1 + normImp(f))
  //   sort DESC by score; tie-break rank(f) DESC; final tie-break path ASC
  const maxImp = rankedFiles.reduce(
    (max, f) => Math.max(max, importerCounts[f.path] ?? 0),
    0,
  );

  const criticalCandidates = rankedFiles
    .map((f) => {
      const imp = importerCounts[f.path] ?? 0;
      const normImp = maxImp > 0 ? imp / maxImp : 0;
      const score = f.rank * (1 + normImp);
      return { path: f.path, rank: f.rank, callerCount: imp, score };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.rank !== a.rank) return b.rank - a.rank;
      return a.path.localeCompare(b.path);
    })
    .slice(0, CRITICAL_MAX)
    .map(({ path, rank, callerCount }) => ({ path, rank, callerCount }));

  return {
    header: {
      filesIndexed: indexState.filesIndexed,
      indexUpdatedAt: indexState.updatedAt,
      degraded: indexState.degraded ?? false,
      degradedReason: indexState.degradedReason,
    },
    readingPath,
    criticalCandidates,
    routeInventory,
    stack,
    commands: setupCommands.commands.slice(0, COMMANDS_MAX),
    repoMapText: repoMap.text,
  };
}
