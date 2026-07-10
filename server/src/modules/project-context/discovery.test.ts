/**
 * AC-1..AC-6 — discovery: bucket inclusion/exclusion at any depth, the
 * DiscoveredDocument shape (path/bucket/estimated_tokens), outermost-bucket-
 * wins ordering, configurable BUCKETS, and clone-absent handling.
 *
 * Hermetic: real temp dirs on local fs only (no network/DB). `discover` never
 * reads file bodies — verified below by handing it a `Tokenizer` whose
 * `count()` throws; if discovery ever started reading bodies to tokenize
 * them, this test would blow up instead of passing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Tokenizer } from '../../adapters/tokenizer/index.js';
import { discover } from './discovery.js';

/** A tokenizer that blows up if ever invoked — proves discovery never reads bodies. */
const throwingTokenizer: Tokenizer = {
  count: () => {
    throw new Error('discovery must never call the tokenizer');
  },
};

let cloneRoot: string;

beforeEach(async () => {
  cloneRoot = await mkdtemp(join(tmpdir(), 'dd-discovery-'));
});

afterEach(async () => {
  await rm(cloneRoot, { recursive: true, force: true });
});

async function writeMd(relPath: string, content: string): Promise<void> {
  const full = join(cloneRoot, relPath);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content, 'utf8');
}

describe('discover — bucket inclusion/exclusion + shape', () => {
  it('includes markdown under specs/docs/insights at any depth, excludes everything else', async () => {
    await writeMd('docs/a.md', 'a'.repeat(40));
    await writeMd('specs/nested/deep/b.md', 'b'.repeat(8));
    await writeMd('insights/c.md', 'c'.repeat(4));
    await writeMd('src/README.md', 'not in a bucket'); // excluded: no bucket segment
    await writeMd('README.md', 'root file'); // excluded: no directory segment at all
    await writeMd('other/d.md', 'excluded bucket'); // excluded: not a configured bucket

    const { documents, summary } = await discover(cloneRoot, throwingTokenizer);

    const paths = documents.map((d) => d.path).sort();
    expect(paths).toEqual(['docs/a.md', 'insights/c.md', 'specs/nested/deep/b.md']);
    expect(summary.document_count).toBe(3);
    expect(summary.clone_available).toBe(true);
  });

  it('returns the three DiscoveredDocument fields with a size-derived token estimate', async () => {
    await writeMd('docs/sized.md', 'x'.repeat(40)); // 40 bytes → ceil(40/4) = 10 tokens

    const { documents } = await discover(cloneRoot, throwingTokenizer);

    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({
      path: 'docs/sized.md',
      bucket: 'docs',
      estimated_tokens: 10,
    });
    expect(Object.keys(documents[0]!).sort()).toEqual(['bucket', 'estimated_tokens', 'path']);
  });

  it('outermost bucket wins: docs/specs/x.md is bucketed as "docs", not "specs"', async () => {
    await writeMd('docs/specs/x.md', 'content');

    const { documents } = await discover(cloneRoot, throwingTokenizer);

    expect(documents).toHaveLength(1);
    expect(documents[0]!.bucket).toBe('docs');
  });
});

describe('discover — configurable BUCKETS', () => {
  afterEach(() => {
    vi.doUnmock('./constants.js');
    vi.resetModules();
  });

  it('changing the BUCKETS constant changes what discovery matches', async () => {
    await writeMd('docs/a.md', 'included under default BUCKETS');
    await writeMd('vendor-notes/b.md', 'excluded under default BUCKETS');

    // Sanity check with the REAL constants first (imported once, unaffected
    // by the mock registered below since ESM modules are cached per test file
    // unless explicitly reset).
    const before = await discover(cloneRoot, throwingTokenizer);
    expect(before.documents.map((d) => d.path)).toEqual(['docs/a.md']);

    // Now swap BUCKETS to a different set and re-import discovery fresh.
    vi.resetModules();
    vi.doMock('./constants.js', () => ({
      BUCKETS: ['vendor-notes'] as const,
    }));
    const { discover: discoverWithCustomBuckets } = await import('./discovery.js');

    const after = await discoverWithCustomBuckets(cloneRoot, throwingTokenizer);
    expect(after.documents.map((d) => d.path)).toEqual(['vendor-notes/b.md']);
  });
});

describe('discover — clone absent', () => {
  it('returns empty + clone_available:false (no throw) when cloneRoot is null', async () => {
    const { documents, summary } = await discover(null, throwingTokenizer);

    expect(documents).toEqual([]);
    expect(summary.document_count).toBe(0);
    expect(summary.total_estimated_tokens).toBe(0);
    expect(summary.clone_available).toBe(false);
  });

  it('returns empty + clone_available:false (no throw) when cloneRoot does not exist on disk', async () => {
    const missing = join(cloneRoot, 'does-not-exist');

    const { documents, summary } = await discover(missing, throwingTokenizer);

    expect(documents).toEqual([]);
    expect(summary.clone_available).toBe(false);
  });
});
