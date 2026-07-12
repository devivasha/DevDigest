# Review: `UsageService` (server/src/modules/usage/service.ts)

Nice that it typechecks and runs, but I'd hold the push. There are a few things here that our conventions actively forbid, plus a real behavioral bug. Flagging in priority order.

## Blockers

### 1. Service reads `process.env` directly (secrets rule)
```ts
const llm = new OpenAIProvider(process.env.OPENAI_API_KEY!);
```
Per our constraints, `LocalSecretsProvider` is the **only** place allowed to touch `process.env`; everywhere else consumes the injected `SecretsProvider`. This line breaks that. Pull the key from the container's secrets provider instead of the environment. The `!` also silently defers a missing-key failure to a confusing runtime crash inside the LLM call.

### 2. Application layer talks to the DB directly (onion layering)
```ts
import * as t from '../../db/schema.js';
...
const rows = await this.container.db.select().from(t.runLogs).where(...);
```
The service is building a Drizzle query and importing the schema. That's infrastructure/persistence work leaking into the application layer. It should call a `UsageRepository` (injected via the container) that owns the query; the service should never import `db/schema` or hold a Drizzle query builder. This keeps the dependency pointing inward and makes the service unit-testable without a DB.

### 3. Service `new`s a concrete adapter instead of depending on an abstraction
```ts
const llm = new OpenAIProvider(...);
```
We inject the LLM provider through DI precisely so the service depends on the interface, not `OpenAIProvider` the concrete class. Hard-instantiating it (a) couples the app layer to a specific vendor adapter, (b) re-creates the client on every call, and (c) makes this method impossible to test without hitting OpenAI. Resolve the provider off `this.container` instead.

## Behavioral bug

### 4. `summarizeUsage` doesn't summarize the month
```ts
const total = await this.monthlyTokens(workspaceId, new Date(0));
...
prompt: `Summarize usage for the month: ${total} tokens.`
```
`new Date(0)` is the Unix epoch, so `monthlyTokens` sums **all usage ever**, but the prompt (and the "usage banner" this feeds) claims it's the month. Pass an actual start-of-month `since` so the number matches the label.

## Worth fixing before it bites

- **Aggregate in SQL, not JS.** `monthlyTokens` does `.select()` (all columns, all rows) and reduces in memory. For a busy workspace that pulls every run-log row over the network to sum one column. Use a `SUM(total_tokens)` aggregate in the query and return the scalar.
- **No error handling on the external call.** `llm.complete(...)` can throw/time out; right now that surfaces as an unhandled rejection and the whole banner errors. Decide on a fallback (e.g. return a plain "N tokens this month" string) rather than letting the LLM be a hard dependency for a banner.
- **Unbounded prompt / cost.** Every banner render triggers a live LLM completion. Consider whether this needs to be an LLM call at all, or at least cache it — otherwise usage summaries themselves burn tokens on each view.

## Summary
Correctness-wise it "works," but items 1-3 violate our secrets + onion-layering conventions and item 4 is a wrong number reaching the UI. I'd route the query through a repository, take both the LLM provider and the API key from the container, and fix the `since` before pushing.
