import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { CiFile } from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import { RUNNER_ENTRY_PATH } from './constants.js';

/**
 * T5 — injectable loader for the bundled `.devdigest/runner/index.js` file
 * embedded in every `gha` export (AC-4, AC-6).
 *
 * `agent-runner/dist/index.js` is the ncc-compiled, self-contained CI runner
 * (see `agent-runner/CLAUDE.md`) — a multi-MB build artifact that is
 * gitignored and only exists after `cd agent-runner && pnpm build` (or
 * `npm run build`) has been run at least once. It is NOT part of this
 * module's owned paths and MUST NOT be re-implemented here.
 *
 * The loader is exported as a plain async function (`RunnerBundleLoader`)
 * rather than hard-coded inline in `service.ts`, specifically so `CiService`
 * can take it as an injected dependency with `loadRunnerBundleFile` as its
 * real default — hermetic tests (T11) override it with a tiny in-memory
 * placeholder `CiFile` instead of requiring a real ncc build to exist on
 * disk.
 */

// Resolved relative to THIS module (works identically under `tsx`/ts-node
// dev — `src/modules/ci/runner-bundle.ts` — and the compiled build —
// `dist/modules/ci/runner-bundle.js`, since `dist/` mirrors `src/`'s
// directory depth 1:1). Four levels up from `server/src/modules/ci/` (or
// `server/dist/modules/ci/`) reaches the repo root, where `agent-runner/`
// is a sibling package — see `platform/prompts.ts` for the same
// `fileURLToPath(import.meta.url)`-relative pattern used elsewhere.
const RUNNER_BUNDLE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'agent-runner',
  'dist',
  'index.js',
);

/**
 * Thrown when the ncc-built runner bundle is absent (never built, or a
 * stale checkout). Deliberately a distinct, typed error — not a generic
 * `Error` — so callers (and the global error handler) can tell "runner not
 * built" apart from any other filesystem failure.
 */
export class RunnerBundleMissingError extends AppError {
  constructor(path: string) {
    super(
      'runner_bundle_missing',
      `Runner bundle not found at ${path}. Build it first: cd agent-runner && pnpm build (or npm run build).`,
      500,
    );
  }
}

/** Injection seam — `CiService`'s constructor takes one of these, defaulting
 *  to `loadRunnerBundleFile` below. */
export type RunnerBundleLoader = () => Promise<CiFile>;

/**
 * Real default loader — reads the actual ncc-built bundle off disk and
 * returns it as the `.devdigest/runner/index.js` `CiFile`. `editable: false`
 * — the bundled runner is a build artifact, never hand-edited in the
 * Preview/Install steps (unlike the manifest/skills/workflow files).
 */
export const loadRunnerBundleFile: RunnerBundleLoader = async () => {
  let contents: string;
  try {
    contents = await readFile(RUNNER_BUNDLE_PATH, 'utf8');
  } catch {
    throw new RunnerBundleMissingError(RUNNER_BUNDLE_PATH);
  }
  return {
    path: RUNNER_ENTRY_PATH,
    contents,
    editable: false,
  };
};
