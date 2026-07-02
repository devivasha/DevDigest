import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { getContext } from "../_shared/context.js";
import { IdParams } from "../_shared/schemas.js";
import { BlastService } from "./service.js";

export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BlastService(container);

  app.get("/pulls/:id/blast", { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getForPr(req.params.id, workspaceId);
  });
}
