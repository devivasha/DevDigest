/**
 * core/resolve.ts — id-resolution (application layer).
 *
 * Flat tool args are `repo` (name/slug) and `pr` (PR number), but the review /
 * conventions endpoints take internal ids. No lookup-by-name or lookup-by-number
 * endpoint exists, so we resolve by LISTING and matching:
 *
 *   repo name  → repoId   via GET /repos       (match full_name → name → owner/name)
 *   (repo, pr) → pullId   via GET /repos/:id/pulls (match number === pr)
 *
 * Errors are RETURNED as structured `{ error }` values (forward-leading text),
 * never thrown — the thin tool maps them to `toolError`. This file imports the
 * infrastructure `client` + shared types only; it never touches MCP/transport.
 */

import type { DevDigestClient } from "../http/client.js";

export type Resolved<T> = ({ error: string } & Partial<T>) | (T & { error?: undefined });

/** Resolve a `repo` arg (`owner/name`, `full_name`, or bare `name`) to its repoId. */
export async function resolveRepoId(
  client: DevDigestClient,
  repo: string,
): Promise<Resolved<{ repoId: string }>> {
  const repos = await client.listRepos();
  const needle = repo.trim().toLowerCase();

  // Match order: full_name (owner/name) → name → owner/name composed. First
  // pass that yields ≥1 match wins; ties within a pass are ambiguity.
  const byFullName = repos.filter((r) => r.full_name.toLowerCase() === needle);
  const byOwnerName = repos.filter(
    (r) => `${r.owner}/${r.name}`.toLowerCase() === needle,
  );
  const byName = repos.filter((r) => r.name.toLowerCase() === needle);

  const matches = byFullName.length ? byFullName : byOwnerName.length ? byOwnerName : byName;

  if (matches.length === 1) {
    return { repoId: matches[0]!.id };
  }
  if (matches.length === 0) {
    const available = repos.map((r) => r.full_name).join(", ") || "(none)";
    return {
      error: `Repo '${repo}' not found. Available: ${available}. Pass owner/name if ambiguous.`,
    };
  }
  // Multiple → ambiguous bare name across owners.
  const options = matches.map((r) => r.full_name).join(", ");
  return {
    error: `Repo '${repo}' is ambiguous across owners (${options}). Pass the full owner/name.`,
  };
}

/** Resolve a `(repo, pr#)` pair to `{ repoId, pullId }`. */
export async function resolvePullId(
  client: DevDigestClient,
  repo: string,
  pr: number,
): Promise<Resolved<{ repoId: string; pullId: string }>> {
  const repoRes = await resolveRepoId(client, repo);
  if (repoRes.error !== undefined) return { error: repoRes.error };
  const repoId = repoRes.repoId!;

  const pulls = await client.listPulls(repoId);
  const match = pulls.find((p) => p.number === pr);

  if (!match) {
    const open = pulls
      .slice(0, 10)
      .map((p) => `#${p.number}`)
      .join(", ") || "(none)";
    return { error: `PR #${pr} not found in ${repo}. Known PRs: ${open}.` };
  }
  // PrMeta.id is nullish — a pull without a persisted id can't be reviewed.
  if (!match.id) {
    return {
      error: `PR #${pr} in ${repo} has no internal id yet (not fully indexed). Try again after the repo finishes syncing.`,
    };
  }
  return { repoId, pullId: match.id };
}
