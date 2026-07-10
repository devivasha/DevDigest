/**
 * AC-30 security boundary: path-traversal / symlink-escape guard for all
 * clone-file access (read AND write). This is the ONLY place that decides
 * whether a repo-relative path is allowed to touch the filesystem inside a
 * repo's working-tree clone. `documents.ts` (T5) and the run-executor's
 * per-run doc read (T10) must route every clone file access through this
 * module — never call `fs.readFile`/`fs.writeFile` on a clone path directly.
 *
 * Why `..`/absolute string checks are NOT enough: a symlink that lives
 * *inside* the clone (e.g. `docs/evil -> /etc`) passes a naive `..`/absolute
 * check because the string itself never leaves the tree — only its
 * resolved target does. `fs.realpath` containment is the only reliable way
 * to catch that, so it is mandatory here, not an optimization.
 *
 * Async by design: `fs.realpath` requires a syscall, so both exported
 * functions are `async` and return `Promise<string>` (not the sync `string`
 * sketched in the plan). Callers must `await` them.
 */

import { dirname, basename, join, resolve, sep } from 'node:path';
import { realpath } from 'node:fs/promises';
import { ValidationError } from '../../platform/errors.js';

/** Node's fs error shape — used to distinguish ENOENT from other failures. */
function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

/**
 * Rejects absolute paths and any path containing a `..` segment, BEFORE any
 * filesystem access. Permissive about separators (accepts `/` and `\`) since
 * the project runs on POSIX but `relPath` may originate from client input.
 */
function assertRelPathSyntax(relPath: string): void {
  if (relPath === '') {
    throw new ValidationError('Path must not be empty');
  }
  if (relPath.startsWith('/') || relPath.startsWith('\\') || /^[a-zA-Z]:[/\\]/.test(relPath)) {
    throw new ValidationError(`Path must be relative to the clone root: ${relPath}`);
  }
  const segments = relPath.split(/[/\\]/);
  if (segments.includes('..')) {
    throw new ValidationError(`Path traversal ("..") is not allowed: ${relPath}`);
  }
}

/** Real-path a filesystem entry, mapping any failure to `ValidationError`. */
async function realpathOrThrow(path: string, message: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    throw new ValidationError(message);
  }
}

/** Throws unless `realTarget` is exactly `realCloneRoot` or nested inside it. */
function assertContained(realCloneRoot: string, realTarget: string, relPath: string): void {
  if (realTarget !== realCloneRoot && !realTarget.startsWith(realCloneRoot + sep)) {
    throw new ValidationError(`Path escapes the clone working tree: ${relPath}`);
  }
}

/**
 * Validates that `relPath` resolves to a real, existing path inside
 * `cloneRoot` — used for reads (Preview, run-time doc injection).
 *
 * - Rejects absolute `relPath` and any `relPath` containing `..`.
 * - Resolves `join(cloneRoot, relPath)`.
 * - `realpath`s both the resolved target and `cloneRoot`, and verifies the
 *   real target is `cloneRoot` itself or nested under it (blocks symlinks
 *   inside the clone that point outside it).
 *
 * @throws {ValidationError} on any violation (including a missing target —
 *   callers that need "file not found" semantics should catch and remap).
 * @returns the validated, real (symlink-resolved) absolute path.
 */
export async function assertInsideClone(cloneRoot: string, relPath: string): Promise<string> {
  assertRelPathSyntax(relPath);

  const resolvedTarget = resolve(join(cloneRoot, relPath));
  const realCloneRoot = await realpathOrThrow(
    resolve(cloneRoot),
    `Clone root does not exist: ${cloneRoot}`,
  );
  const realTarget = await realpathOrThrow(resolvedTarget, `Path does not exist: ${relPath}`);

  assertContained(realCloneRoot, realTarget, relPath);
  return realTarget;
}

/**
 * Same containment checks as {@link assertInsideClone}, but tolerates a
 * not-yet-existing write target: if the target itself doesn't exist,
 * `realpath`s its PARENT directory instead and validates that. This allows
 * creating a brand-new in-tree file while still rejecting a symlinked
 * parent directory that would otherwise smuggle the write outside the clone.
 *
 * If the target path DOES already exist (including as a symlink), its own
 * real path is checked directly — so an existing symlink pointing outside
 * the clone is rejected even before considering the parent.
 *
 * @throws {ValidationError} on any violation.
 * @returns the validated, real (symlink-resolved) absolute path the write
 *   should target. Note this is the real path of the FILE (parent resolved +
 *   original basename) — it does not itself have to exist yet.
 */
export async function assertInsideCloneForWrite(
  cloneRoot: string,
  relPath: string,
): Promise<string> {
  assertRelPathSyntax(relPath);

  const resolvedTarget = resolve(join(cloneRoot, relPath));
  const realCloneRoot = await realpathOrThrow(
    resolve(cloneRoot),
    `Clone root does not exist: ${cloneRoot}`,
  );

  try {
    const realTarget = await realpath(resolvedTarget);
    assertContained(realCloneRoot, realTarget, relPath);
    return realTarget;
  } catch (err) {
    if (!isErrnoException(err) || err.code !== 'ENOENT') {
      throw new ValidationError(`Unable to validate write target: ${relPath}`);
    }
  }

  // Target doesn't exist yet — validate its parent directory instead so a
  // brand-new in-tree file can be created, but a symlinked parent cannot.
  const parentDir = dirname(resolvedTarget);
  const realParent = await realpathOrThrow(
    parentDir,
    `Parent directory does not exist: ${relPath}`,
  );
  assertContained(realCloneRoot, realParent, relPath);
  return join(realParent, basename(resolvedTarget));
}
