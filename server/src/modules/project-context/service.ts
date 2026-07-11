/**
 * project-context/service.ts (T7) — application layer for Project Context.
 *
 * Orchestrates: resolve the repo row (workspace-scoped) → derive the clone
 * working-tree path via `GitClient.clonePathFor` → run discovery (T4,
 * infrastructure-layer I/O) → enrich each discovered document's
 * `used_by_agents` count from the workspace's agents. Read/save of a single
 * document delegate entirely to `documents.ts` (T5), which itself routes
 * every filesystem access through the T3 path guard.
 *
 * `used_by_agents` is read directly off `AgentRow.attachedDocPaths` via
 * `container.agentsRepo.list(workspaceId)` — NOT via `toAgentDto`/`Agent`.
 * This avoids a hard dependency on the agents DTO mapper (owned by a
 * concurrent task) and matches "service reads repo rows, not another
 * module's presentation shape" (onion layering).
 */
import { and, eq } from 'drizzle-orm';
import type { DiscoveredDocument, DiscoverySummary, DocumentContent } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import { NotFoundError } from '../../platform/errors.js';
import { discover } from './discovery.js';
import { readDocument, writeDocument } from './documents.js';

export class ProjectContextService {
  constructor(private container: Container) {}

  /**
   * Discover a repo's attachable markdown docs and enrich each with the
   * count of workspace agents that currently have it attached.
   */
  async listForRepo(
    workspaceId: string,
    repoId: string,
  ): Promise<{ documents: DiscoveredDocument[]; summary: DiscoverySummary }> {
    const repoRow = await this.getRepoOrThrow(workspaceId, repoId);
    const cloneRoot = this.container.git.clonePathFor({ owner: repoRow.owner, name: repoRow.name });

    const { documents, summary } = await discover(cloneRoot, this.container.tokenizer);

    const agents = await this.container.agentsRepo.list(workspaceId);
    const usageCounts = new Map<string, number>();
    for (const agent of agents) {
      for (const path of agent.attachedDocPaths) {
        usageCounts.set(path, (usageCounts.get(path) ?? 0) + 1);
      }
    }

    const enriched = documents.map((doc) => ({
      ...doc,
      used_by_agents: usageCounts.get(doc.path) ?? 0,
    }));

    return { documents: enriched, summary };
  }

  /** Guarded read of a single repo-relative document (Preview). */
  async readDocument(workspaceId: string, repoId: string, path: string): Promise<DocumentContent> {
    const repoRow = await this.getRepoOrThrow(workspaceId, repoId);
    const repoRef = { owner: repoRow.owner, name: repoRow.name };
    const text = await readDocument(this.container.git, repoRef, path);
    return { path, text };
  }

  /** Guarded working-tree write of a single repo-relative document (Edit-save). */
  async saveDocument(
    workspaceId: string,
    repoId: string,
    path: string,
    text: string,
  ): Promise<DocumentContent> {
    const repoRow = await this.getRepoOrThrow(workspaceId, repoId);
    const repoRef = { owner: repoRow.owner, name: repoRow.name };
    await writeDocument(this.container.git, repoRef, path, text);
    return { path, text };
  }

  /**
   * Resolve the repo row scoped to `workspaceId` (tenancy guard) — queried
   * directly against `t.repos` (mirrors `conventions/service.ts`'s pattern
   * for reading a sibling module's table) rather than importing
   * `RepoRepository`, since this module doesn't own the `repos` table.
   */
  private async getRepoOrThrow(workspaceId: string, repoId: string) {
    const [repoRow] = await this.container.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    if (!repoRow) throw new NotFoundError('Repo not found');
    return repoRow;
  }
}
