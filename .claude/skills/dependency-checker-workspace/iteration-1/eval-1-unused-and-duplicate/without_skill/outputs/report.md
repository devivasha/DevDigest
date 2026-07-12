# Dependency Audit — Unused & Duplicate Packages

Repository: `fixtures/mini-repo` (packages: `server/`, `client/`, `reviewer-core/`, `e2e/`, plus `server/src/vendor/shared/`).

## Method

For every `package.json` I enumerated the declared `dependencies`/`devDependencies`, then grepped every `.ts`/`.tsx` source file in that package for `import`/`require` statements and matched each declared package against actual usage. Path-alias imports (`@devdigest/shared`, `@devdigest/api/config`, `@devdigest/reviewer-core/pipeline`) are internal cross-package references, not npm packages, so they were excluded from the npm-dependency check.

## Summary — packages to remove

| Package.json | Package | Reason | Action |
|---|---|---|---|
| `client/package.json` | `axios` | Declared but never imported anywhere in `client/` | **Remove** |
| `client/package.json` | `moment` | Overlaps with `date-fns` — two date libraries doing the same job | **Remove** (migrate the one call site to `date-fns`) |
| `server/package.json` | `lodash` | Declared but never imported anywhere in `server/` | **Remove** |
| `server/package.json` | `eslint` | Never imported, no ESLint config file, no `lint` script — and mis-placed in `dependencies` | **Remove** |

---

## 1. Unused dependencies

### `client/package.json` → `axios` ^1.7.2
No `import ... from 'axios'` (or `require('axios')`) exists anywhere under `client/`. The client's only HTTP-adjacent code (`client/src/lib/api.ts`) uses `zod` for schema parsing, not axios. **Remove `axios` from `client/package.json`.**

### `server/package.json` → `lodash` ^4.17.21
No reference to `lodash` in any file under `server/` (`config.ts`, `index.ts`, `service.ts`, `db/schema.ts`, `vendor/shared/index.ts`). **Remove `lodash` from `server/package.json`.**

### `server/package.json` → `eslint` ^9.9.0
- No `import`/`require` of `eslint`.
- No ESLint configuration file exists (`.eslintrc*` / `eslint.config.*` — none found in the repo).
- No `lint` script in any `package.json`.
- It is also declared in `dependencies` (ships to production) rather than `devDependencies`.

With no config and no script, ESLint is dead weight here. **Remove `eslint` from `server/package.json`.** (If linting is wanted later, re-add under `devDependencies` with an actual config and a `lint` script.)

---

## 2. Duplicate / overlapping dependencies

### `moment` vs `date-fns` in `client/package.json` — two date libraries, same job

Both are declared in `client/package.json` and both are used in the **same file**, `client/src/lib/dates.ts`:

```ts
import { format } from 'date-fns'   // formatShort() -> format(date, 'yyyy-MM-dd')
import moment from 'moment'          // fromNow()     -> moment(date).fromNow()
```

`date-fns` and `moment` are direct substitutes. `moment` is in long-term maintenance mode and is significantly heavier. Standardize on `date-fns` and drop `moment`.

**Recommended fix:** replace the single `moment` call site with the `date-fns` equivalent, then remove `moment`.

```ts
import { format, formatDistanceToNow } from 'date-fns'

export function formatShort(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export function fromNow(date: Date): string {
  return formatDistanceToNow(date, { addSuffix: true })
}
```

Then **remove `moment` from `client/package.json`.**

---

## 3. Notable (not a removal, but worth flagging)

### `zod` version divergence — `client` v4 vs `server` v3
- `client/package.json`: `zod` `^4.0.5`
- `server/package.json`: `zod` `^3.23.8`

Both packages use `zod` legitimately (`client/src/lib/api.ts` and `server/src/config.ts`), so neither should be removed. But they are pinned to **different major versions** of the same library. Zod v3 → v4 has breaking API changes; keeping the packages on different majors risks subtle incompatibilities if schemas/inferred types are ever shared across the client/server boundary (e.g. via `@devdigest/shared`). Recommend aligning both on a single major version.

---

## 4. Packages confirmed used (keep)

| Package.json | Package | Where used |
|---|---|---|
| `client` | `next` | Framework runtime for the App Router page (`client/src/app/page.tsx`); consumed by the Next toolchain, not via an explicit import |
| `client` | `react` | JSX runtime for `page.tsx` (React 19 automatic JSX transform — no explicit import required) |
| `client` | `zod` | `client/src/lib/api.ts` |
| `client` | `date-fns` | `client/src/lib/dates.ts` |
| `client` | `vitest`, `typescript` (dev) | test/build toolchain |
| `server` | `fastify` | `server/src/index.ts` |
| `server` | `drizzle-orm` | `server/src/db/schema.ts` (`drizzle-orm/pg-core`) |
| `server` | `zod` | `server/src/config.ts` |
| `server` | `vitest`, `typescript` (dev) | test/build toolchain |
| `reviewer-core` | — | `dependencies` is empty; nothing to remove |
| `e2e` | `playwright` | `e2e/src/flow.spec.ts` |

`next` and `react` have no explicit `import ... from '...'` line, but they are the framework/runtime for a Next.js React page component and are genuinely required — they are **not** unused.

---

## Final action list

1. `client/package.json` — remove **`axios`**.
2. `client/package.json` — remove **`moment`** (migrate `fromNow()` in `client/src/lib/dates.ts` to `date-fns`'s `formatDistanceToNow`).
3. `server/package.json` — remove **`lodash`**.
4. `server/package.json` — remove **`eslint`**.
5. (Optional, no removal) Align `zod` to a single major version across `client` and `server`.
