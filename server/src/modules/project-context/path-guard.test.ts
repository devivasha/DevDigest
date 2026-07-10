/**
 * AC-30 — path-traversal / symlink-escape guard tests for BOTH read
 * (`assertInsideClone`) and write (`assertInsideCloneForWrite`) paths.
 *
 * Uses REAL temp directories + real `fs.symlink` (hermetic — pure local fs,
 * no network, no DB) so the symlink-escape case exercises the actual
 * `fs.realpath` containment check, not a mocked stand-in.
 *
 * Gotcha (see insights/INSIGHTS.md, 2026-07-10): AppError subclasses never
 * override `.name` — every instance reports `name === 'AppError'`. Assert
 * with `instanceof ValidationError`, never `err.name === 'ValidationError'`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ValidationError } from '../../platform/errors.js';
import { assertInsideClone, assertInsideCloneForWrite } from './path-guard.js';

let cloneRoot: string;
let outsideDir: string;

beforeEach(async () => {
  cloneRoot = await mkdtemp(join(tmpdir(), 'dd-path-guard-clone-'));
  outsideDir = await mkdtemp(join(tmpdir(), 'dd-path-guard-outside-'));
});

afterEach(async () => {
  await rm(cloneRoot, { recursive: true, force: true });
  await rm(outsideDir, { recursive: true, force: true });
});

describe('assertInsideClone (read guard)', () => {
  it('rejects a ".." traversal path', async () => {
    await expect(assertInsideClone(cloneRoot, '../../etc/passwd')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejects an absolute path', async () => {
    await expect(assertInsideClone(cloneRoot, '/etc/passwd')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejects a symlink inside the clone that escapes to an outside directory', async () => {
    await writeFile(join(outsideDir, 'secret.txt'), 'top secret', 'utf8');
    await symlink(outsideDir, join(cloneRoot, 'evil-link'), 'dir');

    await expect(assertInsideClone(cloneRoot, 'evil-link/secret.txt')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('accepts an in-tree file at any depth', async () => {
    await mkdir(join(cloneRoot, 'docs', 'nested'), { recursive: true });
    await writeFile(join(cloneRoot, 'docs', 'nested', 'readme.md'), '# hi', 'utf8');

    const real = await assertInsideClone(cloneRoot, 'docs/nested/readme.md');
    expect(real.endsWith(join('docs', 'nested', 'readme.md'))).toBe(true);
  });
});

describe('assertInsideCloneForWrite (write guard)', () => {
  it('rejects a ".." traversal path', async () => {
    await expect(
      assertInsideCloneForWrite(cloneRoot, '../../etc/passwd'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an absolute path', async () => {
    await expect(assertInsideCloneForWrite(cloneRoot, '/etc/passwd')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejects a write whose parent directory is a symlink escaping the clone (new file)', async () => {
    await symlink(outsideDir, join(cloneRoot, 'evil-link'), 'dir');

    // Target file itself does not exist yet — guard must fall back to
    // realpath-ing the PARENT ("evil-link"), which resolves outside the clone.
    await expect(
      assertInsideCloneForWrite(cloneRoot, 'evil-link/new-file.md'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a write to an existing symlink that itself escapes the clone', async () => {
    await writeFile(join(outsideDir, 'secret.txt'), 'top secret', 'utf8');
    await symlink(join(outsideDir, 'secret.txt'), join(cloneRoot, 'secret-link.md'));

    await expect(assertInsideCloneForWrite(cloneRoot, 'secret-link.md')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('accepts creating a brand-new in-tree file (parent exists, target does not)', async () => {
    await mkdir(join(cloneRoot, 'docs'), { recursive: true });

    const real = await assertInsideCloneForWrite(cloneRoot, 'docs/new-file.md');
    expect(real.endsWith(join('docs', 'new-file.md'))).toBe(true);
  });

  it('accepts overwriting an existing in-tree file', async () => {
    await mkdir(join(cloneRoot, 'docs'), { recursive: true });
    await writeFile(join(cloneRoot, 'docs', 'existing.md'), 'old content', 'utf8');

    const real = await assertInsideCloneForWrite(cloneRoot, 'docs/existing.md');
    expect(real.endsWith(join('docs', 'existing.md'))).toBe(true);
  });
});
