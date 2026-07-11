import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { OnboardingTour } from "@devdigest/shared";
import { getContext } from "../_shared/context.js";
import { OnboardingService } from "./service.js";

const RepoParams = z.object({ repoId: z.string().uuid() });

export default async function onboardingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /repos/:repoId/onboarding — re-serve the stored tour (zero LLM
   * calls), or generate one if none exists yet (AC-14).
   */
  app.get(
    "/repos/:repoId/onboarding",
    { schema: { params: RepoParams, response: { 200: OnboardingTour } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new OnboardingService(app.container);
      return service.getTour(workspaceId, req.params.repoId);
    },
  );

  /**
   * POST /repos/:repoId/onboarding/generate — (re)generate the tour. Also
   * the Regenerate action; never triggers a clone/index job (AC-15).
   */
  app.post(
    "/repos/:repoId/onboarding/generate",
    { schema: { params: RepoParams, response: { 201: OnboardingTour } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new OnboardingService(app.container);
      const tour = await service.generate(workspaceId, req.params.repoId);
      reply.status(201);
      return tour;
    },
  );
}
