# Dependency Sanity Check — Pre-Ship

Scope: `server/`, `client/`, `reviewer-core/`, `e2e/` (+ `@devdigest/shared` at `server/src/vendor/shared/`).
Method: read every `package.json` / `tsconfig.json`, mapped every `import` in source against declared deps and the path aliases in the root `tsconfig.json`. `node_modules` not installed, so this is static analysis only.

## Verdict

**Do not ship as-is.** There is one architecture-level red flag (a cross-package dependency cycle that also breaks `reviewer-core`'s isolation contract) plus a few smaller hygiene issues. The cycle is the one to fix before shipping.

---

## Cross-package dependency graph

```
e2e ──(@playwright/test only)──▶  [nothing internal]

client ──▶ @devdigest/shared   (type ReviewDTO)

server/index ─▶ server/config, server/service, @devdigest/shared
server/service ─▶ @devdigest/shared, server/db/schema, server/format

@devdigest/shared (lives INSIDE server) ─▶ @devdigest/reviewer-core/meta
                                                        │
reviewer-core/meta ─▶ @devdigest/api/config  (== server/config)  ◀── back into server
```

The last two lines are the problem: **server → reviewer-core → server**.

---

## Findings (prioritized)

### 1. CRITICAL — `reviewer-core` depends on `server`, creating a package cycle
- `reviewer-core/src/meta.ts` line 1: `import { config } from '@devdigest/api/config'` — reviewer-core reaches into the server package.
- `server/src/vendor/shared/index.ts` line 1: `import { engineName } from '@devdigest/reviewer-core/meta'` — server (via the shared module) reaches into reviewer-core.
- Result: a bidirectional **package-level circular dependency** (`server ⇄ reviewer-core`). You cannot build/reason about either package independently.
- This directly violates the documented contract that `reviewer-core` is **"Pure TypeScript — no framework, injected LLM provider"** and is **"always consumed as raw TypeScript source"**. It must sit at the bottom of the graph and depend on nothing internal, especially not the API layer.
- Extra smell: `engineName` is computed as `` `reviewer@${config.port}` `` — the review engine's identity is derived from the server's HTTP port at import time. That is backwards coupling (inner layer reading outer-layer runtime config).

**Fix:** invert it. `reviewer-core` should not import server config. Have the engine name be a constant (or injected in), and if the server wants to tag it with a port, let the *server* compose that, not reviewer-core. After this, `reviewer-core` has zero internal deps again.

### 2. CRITICAL — `reviewer-core/package.json` declares `"dependencies": {}` but has a hidden dependency on server
- The manifest says zero dependencies, yet the code transitively pulls in `server/config` (and behind it `zod`, and conceptually the whole server package). The declared contract and the real dependency graph disagree. Same root cause as #1; fixing #1 makes the empty `dependencies` honest again.

### 3. HIGH — the "shared contracts" module is no longer neutral
- `@devdigest/shared` (`server/src/vendor/shared/index.ts`) is imported by both `client` and `server` and is meant to be a leaf module of plain contracts/types. But it exports a **runtime value** `DEFAULT_ENGINE = engineName`, which drags reviewer-core → server into anything that imports shared.
- Today `client/src/app/page.tsx` only uses the *type* `ReviewDTO` (erased at build), so the client bundle likely dodges the runtime chain — but that's luck, not design. Any client code that touches `DEFAULT_ENGINE` would pull server/reviewer-core internals into the browser bundle.

**Fix:** keep `shared` type-only / dependency-free. Move `DEFAULT_ENGINE` out of shared, or make it a plain literal that doesn't import reviewer-core.

### 4. MEDIUM — `vitest` major-version skew across packages
- `server` and `reviewer-core`: `vitest ^2.0.5`; `client`: `vitest ^1.6.0`. A 1.x vs 2.x split means different config/API behavior and two copies in the tree. Align all three on 2.x.

### 5. MEDIUM — two date libraries for the same job
- `server` uses `date-fns ^3.6.0`; `client` uses `dayjs ^1.11.0`. Redundant surface area and two formatting styles across the codebase. Standardize on one (both projects only do trivial formatting, so either works).

### 6. LOW — unused dependency `uuid` in server
- `server/package.json` declares `uuid ^10.0.0`, but `uuid` is imported nowhere in the source. Dead dependency — remove it (or start using it).

---

## Checked and OK
- **`next` / `react` in client**: not explicitly `import`ed, but genuinely required — Next.js uses file-convention entry points and React 19's automatic JSX runtime. Keep them.
- **`zod`**: `^4.0.5` in both client and server — consistent, no skew.
- **`typescript`**: `^5.5.4` everywhere — consistent.
- **`e2e`**: depends only on `@playwright/test` (used) — clean, no internal coupling.
- **Path aliases**: all internal imports (`@devdigest/api/*`, `@devdigest/reviewer-core/*`, `@devdigest/shared`) resolve against the root `tsconfig.json` `paths`. Consistent with the repo's "aliases, not `workspace:*`" convention, so undeclared internal deps in `package.json` are expected and fine.

---

## Fix-before-ship checklist
1. Remove `reviewer-core/src/meta.ts`'s import of `@devdigest/api/config`; make the engine name a constant (or inject it). Breaks the server⇄reviewer-core cycle. **(blocking)**
2. Move `DEFAULT_ENGINE` off the shared module so `@devdigest/shared` stays type-only/leaf. **(blocking)**
3. Align `vitest` to a single major (2.x) across client/server/reviewer-core.
4. Pick one date library (drop either `date-fns` or `dayjs`).
5. Delete the unused `uuid` dependency from `server`.
