# Cross-Package Coupling Audit — mini-repo

**Repository root audited:** `.../dependency-checker-workspace/fixtures/mini-repo`
**Packages:** `server/`, `client/`, `reviewer-core/`, `e2e/` (plus the alias-only shared package at `server/src/vendor/shared/`)

Path aliases (from root `tsconfig.json`) that define the intended public package surfaces:

- `@devdigest/api/*` → `server/src/*`
- `@devdigest/reviewer-core/*` → `reviewer-core/src/*`
- `@devdigest/shared` → `server/src/vendor/shared/index.ts`

## Cross-package import map

| From (file:line) | Import | Resolves to package | Edge |
|---|---|---|---|
| `server/src/service.ts:1` | `@devdigest/reviewer-core/pipeline` | reviewer-core | server → reviewer-core |
| `reviewer-core/src/pipeline.ts:1` | `@devdigest/api/config` | server | reviewer-core → server |
| `client/src/lib/db.ts:1` | `../../../server/src/db/schema` | server | client → server |
| `client/src/app/page.tsx:1` | `@devdigest/shared` | shared (in server tree) | client → shared |
| `server/src/index.ts:4` | `@devdigest/shared` | shared (in server tree) | server → shared |
| `server/src/service.ts:2` | `@devdigest/shared` | shared (in server tree) | server → shared |

---

## Finding 1 — Circular import between packages (server ↔ reviewer-core)

**Confirmed. This is a true cross-package cycle.**

- `server/src/service.ts:1` imports `runPipeline` from `@devdigest/reviewer-core/pipeline`
  → **server depends on reviewer-core**
- `reviewer-core/src/pipeline.ts:1` imports `config` from `@devdigest/api/config`
  → **reviewer-core depends on server**

```
server/src/service.ts  ──imports──▶  reviewer-core/src/pipeline.ts
       ▲                                          │
       └──────────────imports─────────────────────┘
             (@devdigest/api/config → server/src/config.ts)
```

So `server → reviewer-core → server` forms a cycle. This is architecturally significant here because `reviewer-core` is meant to be a leaf/pure engine (its own `package.json` declares zero runtime dependencies), yet it reaches back up into the server's config at runtime (`return { summary: `[${config.port}] ...` }`). The dependency direction should be one-way (server consumes reviewer-core); the back-edge in `reviewer-core/src/pipeline.ts` inverts it.

No other cycles exist. `client → server` (Finding 2) is one-directional — the server does not import the client — so it does not close into a loop.

---

## Finding 2 — Package reaching into another package's internal source files

**Confirmed in three places. The worst one bypasses the alias system entirely with a relative path.**

### 2a. client reaches into server via a raw relative path (most severe)
`client/src/lib/db.ts:1`
```ts
import { reviews } from '../../../server/src/db/schema'
```
The client walks `../../../` out of its own package and into `server/src/db/schema.ts` — a server-internal Drizzle schema file. This bypasses every path alias, imports a server-internal (not part of any declared public surface), and pulls the server's `drizzle-orm` schema graph into the client bundle. There is no `@devdigest/api` alias usage here at all; it is a filesystem traversal across a package boundary. This is the clearest violation of "one package reaching into another package's internal source files."

### 2b. server reaches past reviewer-core's public barrel into an internal module
`server/src/service.ts:1`
```ts
import { runPipeline } from '@devdigest/reviewer-core/pipeline'
```
`reviewer-core` exposes a public entry point at `reviewer-core/src/index.ts` which re-exports `runPipeline` and `PipelineResult`. The server ignores that barrel and deep-imports the internal `pipeline` module directly. It should import from `@devdigest/reviewer-core` (the index), not `/pipeline`.

### 2c. reviewer-core deep-imports a server internal (config)
`reviewer-core/src/pipeline.ts:1`
```ts
import { config } from '@devdigest/api/config'
```
This reaches into `server/src/config.ts`, an internal server module (the server exposes no public barrel; `@devdigest/api/*` maps straight onto `server/src/*`). This is both the back-edge of the cycle in Finding 1 and an internal-reach violation.

**Note on `@devdigest/shared`:** the client and server both import `@devdigest/shared`, which physically resolves to `server/src/vendor/shared/index.ts`. Although that file lives inside the server tree, this is the sanctioned, alias-only shared-contract mechanism (a dedicated `index.ts` barrel targeted by the `@devdigest/shared` alias), so it is treated as intended sharing, not a violation.

---

## Finding 3 — Same dependency pinned to different major versions

**Confirmed: `zod` is on different majors in two packages that exchange data.**

| Package | `zod` version | Major |
|---|---|---|
| `server/package.json` | `^3.23.8` | **v3** |
| `client/package.json` | `^4.0.5` | **v4** |

- `server/src/config.ts:1` and `client/src/lib/api.ts:1` both `import { z } from 'zod'`, so both packages actively use zod — the server builds/validates against zod v3 while the client validates against zod v4. zod v3→v4 has breaking changes in error formatting and several APIs, and the two packages pass `ReviewDTO`-shaped data across the boundary (`client/src/app/page.tsx:8` parses a DTO produced server-side), so this drift is functionally meaningful, not cosmetic.

### Other shared dependencies (for contrast — no drift)
| Dependency | Packages | Versions | Drift? |
|---|---|---|---|
| `typescript` | server, client, reviewer-core, e2e | all `^5.5.4` | No |
| `vitest` | server, client, reviewer-core | all `^2.0.5` | No |

No other dependency is shared across packages at conflicting majors. (`date-fns ^3.6.0` and `moment ^2.30.1` both appear only in the client — that is redundant date libraries within one package, not a cross-package major-version conflict, so it is out of scope for this audit.)

---

## Summary

| # | Concern | Status | Key location(s) |
|---|---|---|---|
| 1 | Circular imports between packages | **Found** — `server ↔ reviewer-core` | `server/src/service.ts:1` ↔ `reviewer-core/src/pipeline.ts:1` |
| 2 | Reaching into another package's internal source | **Found** — 3 sites | `client/src/lib/db.ts:1` (relative traversal, worst), `server/src/service.ts:1` (bypasses reviewer-core barrel), `reviewer-core/src/pipeline.ts:1` (server internal) |
| 3 | Same dep at different major versions | **Found** — `zod` v3 vs v4 | `server/package.json` (`^3.23.8`) vs `client/package.json` (`^4.0.5`) |

### Suggested fixes
1. **Break the cycle:** remove `@devdigest/api/config` from `reviewer-core/src/pipeline.ts`. reviewer-core is a zero-dependency leaf engine; inject any needed config value (e.g. a port) as a function argument instead of importing the server's config module.
2. **Stop the client→server relative reach:** in `client/src/lib/db.ts`, do not import `../../../server/src/db/schema`. The Drizzle schema is server-internal; the client should consume a shared contract type from `@devdigest/shared` instead of the ORM table.
3. **Import through public barrels:** change `server/src/service.ts` to import `runPipeline` from `@devdigest/reviewer-core` (the `index.ts` barrel), not the internal `/pipeline` module.
4. **Align zod:** pick one major (v3 or v4) for both `server` and `client` so shared DTO validation behaves identically on both sides of the wire.
