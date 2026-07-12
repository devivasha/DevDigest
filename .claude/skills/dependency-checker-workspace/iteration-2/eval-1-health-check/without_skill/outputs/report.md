# Dependency Health Check — DevDigest (mini-repo-2)

Scope: `server/`, `client/`, `reviewer-core/`, `e2e/`, plus `@devdigest/shared` (which physically lives at `server/src/vendor/shared/`). Cross-package wiring is done through TypeScript path aliases in the root `tsconfig.json` (this is intentionally not a monorepo — no `workspace:*`, no npm graph between packages). `node_modules` are not installed, so this audit is based on the manifests, the root tsconfig aliases, and the actual `import` statements in source.

## Verdict

Mostly healthy at the third-party-version level, but there is **one architectural problem that will bite you** — a circular dependency between `server` and `reviewer-core` that also breaks `reviewer-core`'s "pure, dependency-free engine" contract. There are also a few smaller cleanups (dependency-manifest drift, a test-runner version split, duplicated date libraries, one unused dependency, and reproducibility gaps).

---

## Cross-package dependency graph

Resolving the aliases:
`@devdigest/api/*` → `server/src/*`, `@devdigest/reviewer-core/*` → `reviewer-core/src/*`, `@devdigest/shared` → `server/src/vendor/shared/index.ts`.

```mermaid
flowchart LR
  client -->|type ReviewDTO / ReviewStatus| shared
  subgraph server_pkg[server package]
    server
    shared[shared (vendor)]
  end
  server --> shared
  shared -->|engineName| reviewercore[reviewer-core]
  reviewercore -->|config.port| server
  server --> fastify & drizzle[drizzle-orm] & zoded[zod] & datefns[date-fns]
  client --> next & react & zodc[zod] & dayjs & tailwind[tailwindcss]
  e2e --> playwright[@playwright/test]

  linkStyle 3 stroke:#e11,stroke-width:3px
```

The red edge (`reviewer-core → server`) closes a loop: `server` (via its vendored `shared`) depends on `reviewer-core`, and `reviewer-core` depends back on `server`.

---

## Findings (prioritized)

### 1. CRITICAL — Circular dependency `server ⇄ reviewer-core`, and `reviewer-core` violates its "pure engine" contract

`reviewer-core/src/meta.ts`:

```ts
import { config } from '@devdigest/api/config'
export const engineName = `reviewer@${config.port}`
```

That single import creates two problems at once:

- **Package cycle.** `server/src/vendor/shared/index.ts` imports `@devdigest/reviewer-core/meta` (for `engineName`, re-exported as `DEFAULT_ENGINE`), and `server/src/service.ts` consumes `shared`. Meanwhile `reviewer-core` imports back into `server` for its config. So `server → reviewer-core → server`. The concrete module chain is `server/service → shared → reviewer-core/meta → server/config`. Today the module graph doesn't infinite-loop (because `config` only pulls in `zod`), but it is a genuine package-level cycle: any future import of `shared` from `server/config`, or of anything server-side from `reviewer-core`, turns it into a real initialization cycle. Cycles like this also defeat incremental builds and make the two packages impossible to reason about or extract independently.

- **Contract violation.** Per the project's own charter, `reviewer-core` is "Pure TypeScript — no framework, injected LLM provider," is a leaf, and is "always consumed as raw TypeScript source." By reaching into `@devdigest/api/config`, the engine now transitively couples to the server's runtime configuration (and to `process.env.DATABASE_URL`, since `config` reads it). The engine can no longer be used or tested without dragging the server along.

**Fix:** invert the dependency — `reviewer-core` must not import from `server`. `engineName` should not be derived from the server's port at all; if the engine needs a name/config value, inject it. For example:

```ts
// reviewer-core/src/meta.ts  (no server import)
export const engineName = 'reviewer'
// or: export function makeEngineName(opts: { port: number }) { return `reviewer@${opts.port}` }
```

Then let `server` compose the runtime-specific string on its side (it already owns `config`), rather than the engine pulling config in. This removes the cycle and restores `reviewer-core` as a true leaf.

### 2. HIGH — `reviewer-core` manifest claims zero dependencies but actually depends on `server`

`reviewer-core/package.json` declares `"dependencies": {}`. That is now inaccurate: the code depends on `@devdigest/api/config`. Because the coupling rides on a TS path alias rather than an npm edge, nothing enforces or surfaces it — the manifest lies about the package's real dependency surface. Once Finding #1 is fixed the manifest becomes true again; until then it's a trap for anyone who trusts the manifest (or tries to publish/extract the engine).

**Fix:** resolve #1 (preferred), which makes `dependencies: {}` honest. If a legitimate cross-package dependency ever must stay, encode it as an explicit boundary and document it — don't leave it invisible in an alias.

### 3. MEDIUM — `vitest` major-version split across packages

- `server`: `vitest ^2.0.5`
- `reviewer-core`: `vitest ^2.0.5`
- `client`: `vitest ^1.6.0`  ← one major behind

Running the same test tool at two different majors invites config/API drift (vitest changed several config and mocking behaviors between 1.x and 2.x) and makes shared testing conventions unreliable. Since each package installs independently, this won't be auto-deduped either.

**Fix:** bump `client` to `vitest ^2` (align on the majority) and re-run the client suite. Standardize on a single major across all three test-bearing packages.

### 4. MEDIUM — Two different date libraries for the same job

- `server` uses `date-fns ^3.6.0` (`format(...)` in `format.ts`)
- `client` uses `dayjs ^1.11.0` (`format(...)` in `dates.ts`)

Both are only doing simple `Date → 'YYYY-MM-DD…'` string formatting. Carrying two libraries for one concern is redundant surface area, two sets of formatting-token conventions to keep straight (`date-fns` uses `yyyy-MM-dd`, `dayjs` uses `YYYY-MM-DD`), and two things to patch/upgrade.

**Fix:** pick one. `date-fns` is already on the server and is tree-shakeable, which suits the client bundle; consolidating the client onto `date-fns` (or standardizing both on `dayjs`) removes a dependency and unifies formatting. Not urgent, but it's easy cleanup that pays off later.

### 5. MEDIUM — Unused dependency: `uuid` in `server`

`server/package.json` declares `uuid ^10.0.0`, but there is no `import` of `uuid` anywhere in the repo. Dead dependency = install weight, an extra thing to audit/patch, and a false signal about what the server uses.

**Fix:** remove `uuid` from `server` dependencies (and add it back only if/when something actually imports it). Note: `@types/uuid` isn't declared either, which corroborates that it was never wired up.

### 6. LOW — Missing runtime peers/types in `client`

`client` declares `react ^19` and `next ^15` but not `react-dom` (a required peer of both React and Next) nor `@types/react` / `@types/node`. JSX in `page.tsx` and the Next runtime need `react-dom` at runtime and `@types/react` to typecheck cleanly. It may "work" today only because nothing is installed yet.

**Fix:** add `react-dom ^19` to dependencies and `@types/react`, `@types/react-dom`, `@types/node` to devDependencies in `client`.

### 7. LOW — No lockfiles and no pinned package manager → non-reproducible installs

There are no `pnpm-lock.yaml` (or any lockfile) in the repo and no `packageManager` field / `.npmrc`. Combined with `^`-carets everywhere, two developers (or CI) installing on different days can resolve different transitive trees. `drizzle-orm ^0.30.10` is especially exposed here: it's a pre-1.0 (`0.x`) package that ships breaking changes between minors, and `^0.30.10` still floats within `0.30.x`.

**Fix:** commit a lockfile per package (the project uses pnpm), add `"packageManager": "pnpm@<version>"` to the root `package.json` to pin the toolchain, and treat `drizzle-orm` with extra care on upgrades (read its changelog before bumping even a patch).

---

## Things that are fine (checked, no action needed)

- **`zod` versions match** across `client` and `server` (`^4.0.5` both). This matters because `shared` types flow between them — a v3/v4 split would have broken the shared contract. Good.
- **`typescript ^5.5.4`** is consistent in every package.
- **No unused deps** in `client` (`next`/`react`/`tailwindcss` are used implicitly by the App Router + JSX + `tailwind.config.ts`; `dayjs`/`zod` are imported directly), `reviewer-core` (empty), or `e2e` (`@playwright/test` is used in `flow.spec.ts`).
- **`@devdigest/shared` direction is otherwise sound**: `client` imports only *types* (`ReviewDTO`, `ReviewStatus`) from it, which is the intended shared-contract pattern.

---

## Suggested order of operations

1. Break the cycle / restore the leaf: remove the `@devdigest/api/config` import from `reviewer-core/src/meta.ts` (Findings #1, #2).
2. Delete unused `uuid` from `server` (#5).
3. Align `vitest` to a single major in `client` (#3).
4. Add `react-dom` + missing `@types/*` to `client` (#6).
5. Consolidate on one date library (#4).
6. Commit lockfiles and pin `packageManager`; be deliberate about `drizzle-orm` bumps (#7).

The first item is the one that actually threatens correctness and the project's stated architecture; the rest is hygiene that keeps the setup from degrading.
