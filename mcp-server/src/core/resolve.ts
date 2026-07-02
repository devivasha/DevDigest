/**
 * Id-resolution helpers — application layer.
 *
 * Resolves human-readable names (repo slug, PR number) to internal UUIDs by
 * calling list endpoints on the DevDigest API.  Errors are returned as
 * structured { error } values — never thrown — so callers can forward them
 * as tool results.
 *
 * Layer: application/orchestration.  Imports DevDigestClient (infrastructure)
 * and @devdigest/shared types only.  No MCP/transport code.
 */

import type { DevDigestClient } from '../http/client.js';

// ---------------------------------------------------------------------------
// Repo resolution
// ---------------------------------------------------------------------------

/** Successful outcome of repo resolution. */
export type RepoResolved = { repoId: string };

/** Failed outcome — forward-leading error message for the calling agent. */
export type ResolutionError = { error: string };

/**
 * Resolve a repo arg (name or owner/name) to the internal repoId UUID.
 *
 * Match strategy (case-insensitive), in order:
 *   1. full_name  (owner/name) — authoritative and unambiguous
 *   2. name       — bare repo name (ambiguous if multiple owners)
 *   3. owner/name constructed from Repo fields (redundant guard)
 *
 * Returns { repoId } on exactly one match.
 * Returns { error } listing available full_names when none or multiple match.
 */
export async function resolveRepoId(
  client: DevDigestClient,
  repo: string,
): Promise<RepoResolved | ResolutionError> {
  let repos;
  try {
    repos = await client.listRepos();
  } catch (cause) {
    return {
      error: `DevDigest API unreachable while listing repos: ${String(cause)}`,
    };
  }

  const needle = repo.toLowerCase();

  const matches = repos.filter((r) => {
    const fullName = r.full_name.toLowerCase();
    const namePart = r.name.toLowerCase();
    const constructed = `${r.owner.toLowerCase()}/${namePart}`;
    return (
      fullName === needle || namePart === needle || constructed === needle
    );
  });

  if (matches.length === 1) {
    const match = matches[0];
    if (!match) {
      // Defensive: array access after length check
      return { error: `Internal: unexpected empty match array` };
    }
    return { repoId: match.id };
  }

  const available = repos.map((r) => r.full_name).join(', ');

  if (matches.length === 0) {
    return {
      error: `Repo '${repo}' not found. Available: ${available}. Pass owner/name if ambiguous.`,
    };
  }

  // Multiple matches — bare name is ambiguous across owners
  const ambiguous = matches.map((r) => r.full_name).join(', ');
  return {
    error: `Repo '${repo}' is ambiguous — matches: ${ambiguous}. Pass owner/name to disambiguate.`,
  };
}

// ---------------------------------------------------------------------------
// Pull-request resolution
// ---------------------------------------------------------------------------

/** Successful outcome of pull-request resolution. */
export type PullResolved = { repoId: string; pullId: string };

/**
 * Resolve (repo, pr number) to the internal pullId UUID.
 *
 * Resolves repo first, then fetches the list of PRs for that repo and matches
 * on PR number.  The `PrMeta.id` field is .nullish() in the contract; rows
 * without an id are skipped (they are GitHub-only PRs not yet persisted).
 *
 * Returns { repoId, pullId } on a match.
 * Returns { error } with forward-leading guidance when nothing matches.
 */
export async function resolvePullId(
  client: DevDigestClient,
  repo: string,
  pr: number,
): Promise<PullResolved | ResolutionError> {
  const repoResult = await resolveRepoId(client, repo);
  if ('error' in repoResult) {
    return repoResult;
  }

  const { repoId } = repoResult;

  let pulls;
  try {
    pulls = await client.listPulls(repoId);
  } catch (cause) {
    return {
      error: `DevDigest API unreachable while listing PRs for repo '${repo}': ${String(cause)}`,
    };
  }

  for (const pull of pulls) {
    if (pull.number === pr) {
      // Guard the nullish id — skip rows without a persisted id
      if (pull.id == null) {
        return {
          error: `PR #${pr} in '${repo}' exists but has no internal id (not yet persisted). Try again after the repo has been synced.`,
        };
      }
      return { repoId, pullId: pull.id };
    }
  }

  // PR not found — provide a few open PR numbers as forward-leading context
  const openNumbers = pulls
    .filter((p) => p.id != null)
    .slice(0, 5)
    .map((p) => `#${p.number}`)
    .join(', ');

  const hint = openNumbers ? ` Open PRs: ${openNumbers}.` : '';
  return {
    error: `PR #${pr} not found in '${repo}'.${hint}`,
  };
}
