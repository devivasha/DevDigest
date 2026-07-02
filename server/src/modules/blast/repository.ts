import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import * as t from "../../db/schema.js";

export class BlastRepository {
  constructor(private readonly db: Db) {}

  async resolvePrAndRepo(prId: string, workspaceId: string) {
    const [pr] = await this.db
      .select()
      .from(t.pullRequests)
      .where(
        and(
          eq(t.pullRequests.workspaceId, workspaceId),
          eq(t.pullRequests.id, prId),
        ),
      );

    if (!pr) return { pr: null, repo: null };

    const [repo] = await this.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.id, pr.repoId));

    return { pr, repo: repo ?? null };
  }

  async getChangedFilePaths(prId: string): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.prFiles.path })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
    return rows.map((r: { path: string }) => r.path);
  }

  async findPriorPrsTouchingSameFiles(
    repoId: string,
    excludePrId: string,
    paths: string[],
    limit = 5,
  ) {
    if (paths.length === 0) return [];
    return this.db
      .selectDistinct({
        id: t.pullRequests.id,
        number: t.pullRequests.number,
        title: t.pullRequests.title,
        openedAt: t.pullRequests.openedAt,
        status: t.pullRequests.status,
      })
      .from(t.pullRequests)
      .innerJoin(t.prFiles, eq(t.pullRequests.id, t.prFiles.prId))
      .where(
        and(
          eq(t.pullRequests.repoId, repoId),
          ne(t.pullRequests.id, excludePrId),
          inArray(t.prFiles.path, paths),
        ),
      )
      .orderBy(desc(t.pullRequests.openedAt))
      .limit(limit);
  }
}
