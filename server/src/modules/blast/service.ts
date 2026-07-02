import type { Container } from "../../platform/container.js";
import type { BlastRadiusResult, Provider } from "@devdigest/shared";
import { NotFoundError } from "../../platform/errors.js";
import { BlastRepository } from "./repository.js";
import { resolveFeatureModel } from "../settings/feature-models.js";

export class BlastService {
  private readonly repo: BlastRepository;

  constructor(private readonly container: Container) {
    this.repo = new BlastRepository(container.db);
  }

  async getForPr(
    prId: string,
    workspaceId: string,
  ): Promise<BlastRadiusResult> {
    const { pr, repo } = await this.repo.resolvePrAndRepo(prId, workspaceId);
    if (!pr) throw new NotFoundError("Pull request not found");
    if (!repo) throw new NotFoundError("Repo not found");

    const changedFiles = await this.repo.getChangedFilePaths(pr.id);

    if (changedFiles.length === 0) {
      return {
        changedSymbols: [],
        callers: [],
        impactedEndpoints: [],
        degraded: true,
        reason: "no_data",
      };
    }

    const blastResult = await this.container.repoIntel.getBlastRadius(
      repo.id,
      changedFiles,
    );

    const priorPrsRaw = await this.repo.findPriorPrsTouchingSameFiles(
      repo.id,
      pr.id,
      changedFiles,
    );

    const priorPrs = priorPrsRaw.map(
      (p: {
        id: string;
        number: number;
        title: string;
        openedAt: Date | null;
        status: string;
      }) => ({
        id: p.id,
        number: p.number,
        title: p.title,
        openedAt: p.openedAt ? p.openedAt.toISOString() : null,
        status: p.status,
      }),
    );

    let summary: string | undefined;
    try {
      const { provider, model } = await resolveFeatureModel(
        this.container,
        workspaceId,
        "review_intent",
      );
      const llm = await this.container.llm(provider as Provider);
      const result = await llm.complete({
        model,
        messages: [
          {
            role: "system",
            content: "You summarize code impact maps in one concise sentence.",
          },
          {
            role: "user",
            content: `Blast radius: ${blastResult.changedSymbols.map((s) => s.name).join(", ")} changed. ${blastResult.callers.length} callers, ${blastResult.impactedEndpoints.length} endpoints affected. Summarize in one sentence.`,
          },
        ],
        maxTokens: 150,
        temperature: 0.2,
      });
      summary = result.text.trim();
    } catch {
      // LLM failure must not block the response
    }

    return { ...blastResult, priorPrs, summary };
  }
}
