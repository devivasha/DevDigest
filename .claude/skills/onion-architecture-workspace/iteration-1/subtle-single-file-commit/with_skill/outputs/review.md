# Review: `server/src/modules/usage/service.ts`

Short answer: yes — I'd hold this before pushing. It typechecks and "works," but as written it's an application-layer (`service.ts`) file that reaches straight through the infrastructure layer and instantiates an adapter itself. Those are onion-architecture violations, not style nits, and a couple are also secrets-policy violations. None of them show up in a typecheck.

## Blocking

### 1. Service talks to Drizzle directly — no repository layer
```ts
import { and, eq, gte } from 'drizzle-orm';
import * as t from '../../db/schema.js';
...
const rows = await this.container.db.select().from(t.runLogs).where(...);
return rows.reduce((sum, r) => sum + (r.totalTokens ?? 0), 0);
```
A `service.ts` may **not** import `drizzle-orm` or `db/schema/*`, and may not run queries off `container.db`. That's the infrastructure layer's job (`dependency-rule.md` allow-list; `application-layer.md` "What Services MUST NOT Do"). Two consequences here:
- The raw DB row (`r.totalTokens`) leaks Drizzle's `$inferSelect` shape into the service — rule 4, "Drizzle stays in infrastructure."
- There is no `repository.ts` in this module at all, so the whole infra layer is missing.

**Fix:** add `modules/usage/repository.ts` with a `UsageRepository(container.db)` that owns the query and returns a plain number (or a small DTO). The service calls `this.repo.monthlyTokens(workspaceId, since)`. Move the `drizzle-orm` / `db/schema` imports into that repo.

### 2. Adapter instantiated inside the service (`new OpenAIProvider(...)`)
```ts
import { OpenAIProvider } from '../../adapters/llm/openai.js';
...
const llm = new OpenAIProvider(process.env.OPENAI_API_KEY!);
```
Three separate rules broken in one line:
- Services may not import `adapters/*` directly — pull the LLM from the container (`dependency-rule.md`).
- `new` on an adapter is only allowed in `platform/container.ts`, the single composition root (`di-container.md`, "The One Rule").
- `process.env` is read directly. Per the repo's secrets constraint, `LocalSecretsProvider` is the *only* place that reads `process.env`; everywhere else uses the injected `SecretsProvider`. The container's `llm()` factory already fetches the key via secrets.

**Fix:**
```ts
const llm = await this.container.llm('openai');
const res = await llm.complete({ prompt: ... });
```
This also makes the method testable via `ContainerOverrides` — right now it can only ever hit the real OpenAI API, so no hermetic test can cover `summarizeUsage`.

## Worth fixing while you're in here

- **`monthlyTokens` name vs. behavior:** `summarizeUsage` calls it with `new Date(0)`, i.e. all-time, not "the month" — yet the prompt says "for the month." Either scope the `since` to the current month or rename. Minor, but it's a real correctness/labeling bug.
- **Return shape:** `summarizeUsage` returns a bare `string`. Fine for now, but if the usage banner grows, prefer a DTO from `vendor/shared/contracts/` rather than widening the string.

## Good as-is
- `monthlyTokens` filters by `workspaceId` — workspace scoping is present (mandatory per `infrastructure-layer.md`). Keep that filter in the repository when you move the query.

## Suggested shape
```
modules/usage/
├── service.ts      ← orchestrates: repo.monthlyTokens() + container.llm('openai')
└── repository.ts   ← owns the runLogs query + drizzle/schema imports
```
Once the query moves to a repo and the LLM comes from `container.llm('openai')`, `service.ts` should have zero imports of `drizzle-orm`, `db/schema`, `adapters/*`, or `process.env`.
