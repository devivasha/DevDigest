/**
 * AC-32/AC-33: guarded read/write of a single markdown document inside a
 * repo's clone working tree. Powers Preview (read), Edit-save (write), and
 * run-time prompt injection (read via T10's per-run doc loading).
 *
 * Every filesystem access here goes through the T3 guard
 * (`assertInsideClone` / `assertInsideCloneForWrite` in `./path-guard.ts`) —
 * never call `fs.readFile`/`fs.writeFile` directly on a clone path, and
 * never use `GitClient.readFile` (`simple-git.ts`'s `readFile` is a bare,
 * unguarded `readFile(join(clonePathFor(repo), path))`) for anything that
 * touches this module's paths.
 *
 * `writeDocument` performs NO git operation — no add, no commit, no push.
 * It is a working-tree-only edit; a later `git.sync()` (`reset --hard`) will
 * clobber it. That resync-clobber risk is a UI warning surfaced elsewhere
 * (T12/T13), not something this module guards against.
 *
 * ---- Error contract (read by T7 routes + T10 run-executor) ----
 * - Guard violation (absolute path, `..` traversal, symlink escape outside
 *   the clone, missing clone root) → `ValidationError` (code:
 *   'validation_error', statusCode 422), thrown by `path-guard.ts` and
 *   propagated unchanged.
 * - Missing file on read → `NotFoundError` (code: 'not_found', statusCode
 *   404). `assertInsideClone` itself throws `ValidationError` for a missing
 *   target (it realpaths the target as part of containment checking), so
 *   `readDocument` catches that specific case — identified by the guard's
 *   own `"Path does not exist:"` message prefix — and re-throws as
 *   `NotFoundError` so callers can tell "file not found" apart from "guard
 *   violation" (400/422 vs 404). Any other `ValidationError` message (e.g.
 *   escape, traversal, missing clone root) is a guard violation and is
 *   re-thrown unchanged.
 * - Missing parent directory on write → `ValidationError` (422), thrown by
 *   `assertInsideCloneForWrite` and propagated unchanged. This still
 *   satisfies "save failure reported, not silently dropped" — the caller
 *   receives a clear, typed error instead of an ENOENT bubbling up raw.
 * - Non-UTF-8 / undecodable file content on read → `ValidationError` (422)
 *   thrown by `readDocument` itself (round-trip byte comparison — Node's
 *   `Buffer#toString('utf8')` silently substitutes `U+FFFD` for invalid
 *   sequences instead of throwing, so it can't be trusted on its own).
 * - Any other unreadable/unwritable condition (permission denied, target is
 *   a directory, disk full, etc.) → the underlying `fs` `ErrnoException`
 *   propagates unchanged. It is always a thrown error, never swallowed, so
 *   callers (e.g. the run executor) can catch-and-record into
 *   `specs_missing`.
 */

import { readFile, writeFile } from 'node:fs/promises';
import type { GitClient, RepoRef } from '@devdigest/shared';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { assertInsideClone, assertInsideCloneForWrite } from './path-guard.js';

const MISSING_TARGET_PREFIX = 'Path does not exist:';

/**
 * Reads a repo-relative markdown (or any text) file from the repo's clone
 * working tree, after validating the path stays inside the clone.
 *
 * @throws {NotFoundError} if the file does not exist inside the clone.
 * @throws {ValidationError} on any guard violation (traversal, absolute
 *   path, symlink escape, missing clone root) or non-UTF-8 content.
 */
export async function readDocument(
  git: GitClient,
  repoRef: RepoRef,
  path: string,
): Promise<string> {
  const cloneRoot = git.clonePathFor(repoRef);

  let validatedPath: string;
  try {
    validatedPath = await assertInsideClone(cloneRoot, path);
  } catch (err) {
    if (err instanceof ValidationError && err.message.startsWith(MISSING_TARGET_PREFIX)) {
      throw new NotFoundError(`Document not found: ${path}`, { path });
    }
    throw err;
  }

  const buf = await readFile(validatedPath);
  const text = buf.toString('utf8');
  // `toString('utf8')` never throws — invalid byte sequences are silently
  // replaced with U+FFFD. Round-trip re-encoding is the only reliable way
  // to detect that substitution happened, so callers can skip-and-record
  // unreadable/non-UTF-8 documents instead of silently serving mangled text.
  if (Buffer.compare(Buffer.from(text, 'utf8'), buf) !== 0) {
    throw new ValidationError(`Document is not valid UTF-8: ${path}`, { path });
  }
  return text;
}

/**
 * Writes `text` to a repo-relative path inside the repo's clone working
 * tree, after validating the path stays inside the clone. Working-tree
 * write only — performs NO git operation (no add, no commit, no push).
 *
 * @throws {ValidationError} on any guard violation (traversal, absolute
 *   path, symlink escape, missing clone root, missing parent directory).
 */
export async function writeDocument(
  git: GitClient,
  repoRef: RepoRef,
  path: string,
  text: string,
): Promise<void> {
  const cloneRoot = git.clonePathFor(repoRef);
  const validatedPath = await assertInsideCloneForWrite(cloneRoot, path);
  await writeFile(validatedPath, text, 'utf8');
}
