/**
 * AC-18/AC-19/AC-21 run-time union resolver: builds the ordered, deduped list
 * of repo-relative doc paths to inject as the `## Project context` block.
 *
 * Pure application-layer function — no filesystem, no network, no container
 * access. Callers (the run executor, T10) are responsible for:
 *  - filtering skills to only those that are ENABLED/loaded before calling
 *    this function — this helper trusts `loadedSkills` as-is and does NOT
 *    read or check any `enabled` field itself (AC-18's enabled-filtering
 *    happens upstream).
 *  - actually reading each returned path from the clone (this function only
 *    resolves which paths to read, never their contents).
 */

export interface ResolveSpecPathsInput {
  /** The agent's own attached doc paths, in attach order. */
  agentPaths: string[];
  /** Loaded (already enabled-filtered) skills, in load order. */
  loadedSkills: { paths: string[] }[];
}

/**
 * Builds the deterministic ordered path list: the agent's paths first (in
 * their given order), then each loaded skill's paths in turn (in load order,
 * each skill's own paths in their given order). Deduplicates by exact
 * repo-relative path string, keeping the FIRST occurrence (AC-19, AC-21).
 *
 * Dedupe key note: this is an exact string match — no normalization
 * (no trimming, no case-folding, no leading-`./` stripping). It matches
 * discovery's `path` output verbatim (T4), so as long as every producer of a
 * path string (discovery, agent attach, skill attach) emits the same
 * canonical form, this is safe. If any producer ever emits an equivalent but
 * differently-formatted path (e.g. `docs/x.md` vs `./docs/x.md`), dedupe will
 * miss it and both would be read/injected as if distinct — flagged as a
 * latent risk, not fixed here since normalization is out of this function's
 * pure, trusting-its-input contract.
 */
export function resolveSpecPaths(input: ResolveSpecPathsInput): string[] {
  const { agentPaths, loadedSkills } = input;

  const ordered: string[] = [];
  const seen = new Set<string>();

  const addAll = (paths: string[]): void => {
    for (const path of paths) {
      if (!seen.has(path)) {
        seen.add(path);
        ordered.push(path);
      }
    }
  };

  addAll(agentPaths);
  for (const skill of loadedSkills) {
    addAll(skill.paths);
  }

  return ordered;
}
