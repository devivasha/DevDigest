import type { SkillCase } from "../../src/index.js";

// This skill answers "where does this code go?" and "can this file import that file?" for the
// DevDigest backend's four onion layers (domain / application / infrastructure / presentation).
// "quality" cases run with NO tools (skillTask measures SKILL.md content in isolation — see
// tasks.ts), so each prompt inlines the concrete code scenario the skill must reason over
// directly, instead of pointing at real files the model would otherwise have to Read.

export const cases: SkillCase[] = [
  {
    name: "flags a service that queries the DB directly and points it at the repository layer",
    kind: "quality",
    prompt: `In our Fastify backend I have this service method. Is this correct per our architecture? If not, what's wrong and where should the code go?

// server/src/modules/reviews/service.ts
import { reviews } from "../../db/schema.js";
import { eq } from "drizzle-orm";

export class ReviewService {
  constructor(private container: Container) {}

  async getById(id: string) {
    const rows = await this.container.db
      .select()
      .from(reviews)
      .where(eq(reviews.id, id));
    return rows[0];
  }
}`,
    grounding: ["repository"],
    practices: [
      "the answer identifies this as an onion/layering violation: the application layer (service.ts) is doing infrastructure work by querying the database directly",
      "the answer states the Drizzle query (this.container.db.select()/from()/where() and the db/schema import) belongs in repository.ts (the infrastructure layer), not in service.ts",
      "the answer explains the service should call a repository method and receive a domain/DTO type, rather than importing the Drizzle schema itself",
      "the answer references the inward-only dependency rule or the principle that Drizzle stays in infrastructure ($inferSelect/$inferInsert and schema imports never leave the repository)",
    ],
    threshold: 0.7,
    maxTurns: 8,
  },
  {
    name: "answers a layer-placement question with the correct layer and the file it lives in",
    kind: "quality",
    prompt: `We're adding a GitHub adapter that calls the GitHub REST API to fetch pull request diffs, and a new module that uses it. Two questions: (1) which onion layer does the GitHub API client belong to, and where in the repo does it live? (2) which file instantiates it with 'new GitHubClient(...)'? Answer concisely with the layer name and the concrete path.`,
    practices: [
      "the answer places the GitHub API client in the infrastructure layer (as an adapter), e.g. under an adapters/ directory, because it performs external I/O",
      "the answer states that the 'new GitHubClient(...)' instantiation belongs exclusively in the composition root, src/platform/container.ts, and not in a service constructor",
      "the answer does not tell the user to instantiate the adapter inside a service.ts constructor (e.g. it explicitly avoids 'new GitHubClient()' inside the service)",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
  {
    name: "flags a fat route handler and reduces it to validate → call service → reply",
    kind: "quality",
    prompt: `Review this Fastify route against our backend architecture rules and tell me what to change.

// server/src/modules/reviews/routes.ts
app.post("/reviews", async (req, reply) => {
  const body = req.body as { repoUrl: string };
  if (!body.repoUrl.startsWith("https://github.com/")) {
    return reply.code(400).send({ error: "only github urls" });
  }
  const score = body.repoUrl.length > 80 ? "large" : "small";
  const rows = await app.db.insert(reviews).values({ repoUrl: body.repoUrl, score }).returning();
  return reply.send(rows[0]);
});`,
    grounding: ["service"],
    practices: [
      "the answer flags that the route handler is too fat / violates the 'thin routes' rule, which limits a handler to three things: validate input, call one service method, send the reply",
      "the answer says the business logic (the 'large'/'small' score branching) belongs in the application layer (service.ts), not in the route",
      "the answer says the database insert (app.db.insert(...)) belongs in the repository/infrastructure layer, not in the route handler",
      "the answer recommends replacing the manual startsWith check with Zod validation of the HTTP request shape at the presentation layer",
      "the rewritten/recommended handler ends up doing only: validate with Zod, call a single service method, and send the reply",
    ],
    threshold: 0.7,
    maxTurns: 8,
  },
];
