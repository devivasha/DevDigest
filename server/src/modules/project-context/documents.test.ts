/**
 * AC-32/AC-33 — guarded read/write of a single doc inside a repo's clone.
 *
 * Uses a real temp dir as the "clone" (path-guard needs real `fs.realpath`),
 * and a stub `GitClient` whose only implemented method is `clonePathFor` —
 * every other method throws if called, proving `readDocument`/`writeDocument`
 * perform NO git operation (no clone/sync/readFile/etc.), only plain fs I/O
 * gated by the T3 guard.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitClient, RepoRef } from '@devdigest/shared';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { readDocument, writeDocument } from './documents.js';

const repoRef: RepoRef = { owner: 'acme', name: 'widgets' };

let cloneRoot: string;

/** A GitClient stub that only supports `clonePathFor` — any other call is a
 *  test failure, proving documents.ts never performs a git operation. */
function makeGuardOnlyGit(root: string): GitClient {
  const unexpected = (method: string) => () => {
    throw new Error(`unexpected git call: ${method} — documents.ts must not call this`);
  };
  return {
    clonePathFor: () => root,
    clone: unexpected('clone'),
    fetchPullHead: unexpected('fetchPullHead'),
    sync: unexpected('sync'),
    currentHead: unexpected('currentHead'),
    diff: unexpected('diff'),
    diffNameOnly: unexpected('diffNameOnly'),
    blame: unexpected('blame'),
    log: unexpected('log'),
    readFile: unexpected('readFile'),
  } as unknown as GitClient;
}

let git: GitClient;

beforeEach(async () => {
  cloneRoot = await mkdtemp(join(tmpdir(), 'dd-documents-'));
  git = makeGuardOnlyGit(cloneRoot);
});

afterEach(async () => {
  await rm(cloneRoot, { recursive: true, force: true });
});

describe('readDocument', () => {
  it('reads a guarded in-tree file (round trip with writeDocument)', async () => {
    await mkdir(join(cloneRoot, 'docs'), { recursive: true });
    await writeFile(join(cloneRoot, 'docs', 'readme.md'), '# Hello', 'utf8');

    const text = await readDocument(git, repoRef, 'docs/readme.md');
    expect(text).toBe('# Hello');
  });

  it('refuses a traversal path with ValidationError', async () => {
    await expect(readDocument(git, repoRef, '../../etc/passwd')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('refuses an absolute path with ValidationError', async () => {
    await expect(readDocument(git, repoRef, '/etc/passwd')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('maps a missing file to NotFoundError (not ValidationError)', async () => {
    await mkdir(join(cloneRoot, 'docs'), { recursive: true });

    await expect(readDocument(git, repoRef, 'docs/missing.md')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('writeDocument', () => {
  it('writes a new guarded in-tree file, then reads it back unchanged', async () => {
    await mkdir(join(cloneRoot, 'docs'), { recursive: true });

    await writeDocument(git, repoRef, 'docs/new.md', 'fresh content');

    const onDisk = await readFile(join(cloneRoot, 'docs', 'new.md'), 'utf8');
    expect(onDisk).toBe('fresh content');

    const readBack = await readDocument(git, repoRef, 'docs/new.md');
    expect(readBack).toBe('fresh content');
  });

  it('refuses a traversal path with ValidationError', async () => {
    await expect(
      writeDocument(git, repoRef, '../../etc/passwd', 'pwned'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses an absolute path with ValidationError', async () => {
    await expect(writeDocument(git, repoRef, '/etc/passwd', 'pwned')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('performs no git side effects — only clonePathFor is ever called', async () => {
    await mkdir(join(cloneRoot, 'docs'), { recursive: true });

    // If writeDocument/readDocument called ANY other GitClient method, the
    // stub above throws and this test fails.
    await writeDocument(git, repoRef, 'docs/no-git.md', 'plain fs write');
    await readDocument(git, repoRef, 'docs/no-git.md');
  });
});
