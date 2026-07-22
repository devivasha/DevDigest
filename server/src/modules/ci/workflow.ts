import { stringify as stringifyYaml } from 'yaml';
import type { CiFile } from '@devdigest/shared';
import { RUNNER_ENTRY_PATH, SUPPORTED_TRIGGERS, WORKFLOW_PATH, type SupportedTrigger } from './constants.js';

/**
 * T3 — generates the editable `.github/workflows/devdigest-review.yml`.
 *
 * PURE function — no DB, no filesystem, no adapter instantiation. This is
 * the file a `target=gha` export ships; other targets (`circle`/`jenkins`/
 * `cli`) never call this and instead render a read-only placeholder in the
 * client (AC-3), which this module does not concern itself with.
 */

export interface CiWorkflowInput {
  /** Subset of `SUPPORTED_TRIGGERS` — becomes `on.pull_request.types` (AC-8). */
  triggers: string[];
  /** Wires the runner's post mode (AC-9). */
  postAs: 'github_review' | 'pr_comment' | 'none';
}

/**
 * Normalizes `triggers` to the canonical `SUPPORTED_TRIGGERS` order and
 * drops anything unrecognized — the generated `pull_request.types` list is
 * always a deterministic, valid subset regardless of input ordering
 * (AC-8; defense-in-depth alongside `CiExportInput` validation upstream).
 */
function normalizeTriggers(triggers: string[]): SupportedTrigger[] {
  const requested = new Set(triggers);
  return SUPPORTED_TRIGGERS.filter((t) => requested.has(t));
}

/**
 * Builds the GitHub Actions workflow document as a plain object, then
 * serializes it with the `yaml` package (AC-29 — no manual string
 * concatenation for either the manifest or the workflow). The only
 * `uses:` step present is `actions/checkout` — required infrastructure to
 * get `.devdigest/**` onto the runner before it can be invoked — and it is
 * an editable placeholder the user may swap out (AC-6); the review itself
 * runs via `run: node .devdigest/runner/index.js` directly, never through a
 * DevDigest-published marketplace action.
 */
export function buildWorkflowFile(input: CiWorkflowInput): CiFile {
  const types = normalizeTriggers(input.triggers);

  const doc = {
    name: 'DevDigest Review',
    on: {
      pull_request: {
        // AC-8: derived 1:1 from the Configure step's trigger selection.
        types: types.length > 0 ? types : [...SUPPORTED_TRIGGERS],
      },
    },
    jobs: {
      review: {
        'runs-on': 'ubuntu-latest',
        permissions: {
          contents: 'read',
          'pull-requests': 'write',
        },
        steps: [
          {
            name: 'Checkout (editable placeholder — swap for your own checkout step if needed)',
            uses: 'actions/checkout@v4',
          },
          {
            name: 'Run DevDigest review',
            // The bundled runner is invoked directly — no marketplace action
            // is required for the review itself (AC-6).
            run: `node ${RUNNER_ENTRY_PATH}`,
            env: {
              // AC-9: wires the Configure step's "Post results as" choice
              // into the runner's post mode.
              DEVDIGEST_POST_AS: input.postAs,
              OPENROUTER_API_KEY: '${{ secrets.OPENROUTER_API_KEY }}',
              GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
              DEVDIGEST_INGEST_TOKEN: '${{ secrets.DEVDIGEST_INGEST_TOKEN }}',
            },
          },
        ],
      },
    },
  };

  const contents = stringifyYaml(doc);

  return {
    path: WORKFLOW_PATH,
    contents,
    editable: true,
  };
}
