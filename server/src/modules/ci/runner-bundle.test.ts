import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Hermetic unit tests for `loadRunnerBundleFile`/`RunnerBundleMissingError`
 * (MEDIUM finding: missing test coverage). `RUNNER_BUNDLE_PATH` is resolved
 * relative to the module file (not injectable), and reading the real
 * ncc-built `agent-runner/dist/index.js` would require a real build artifact
 * on disk (see `server/insights/INSIGHTS.md`'s 2026-07-15 note on
 * `.it.test.ts` files needing `agent-runner` built first) — so `node:fs/
 * promises`'s `readFile` is mocked at the module boundary (fs, not network;
 * no adapters/mocks.ts port exists for this — the module has no injectable
 * seam for the filesystem read itself, only for the whole loader function via
 * `RunnerBundleLoader`, which `CiService`'s own tests already exercise).
 */
const readFileMock = vi.fn();
vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

const { loadRunnerBundleFile, RunnerBundleMissingError } = await import('./runner-bundle.js');
const { RUNNER_ENTRY_PATH } = await import('./constants.js');

describe('loadRunnerBundleFile', () => {
  beforeEach(() => {
    readFileMock.mockReset();
  });

  it('reads the ncc-built bundle off disk and returns it as a non-editable CiFile at RUNNER_ENTRY_PATH', async () => {
    readFileMock.mockResolvedValue('// compiled runner bundle contents');

    const file = await loadRunnerBundleFile();

    expect(file).toEqual({
      path: RUNNER_ENTRY_PATH,
      contents: '// compiled runner bundle contents',
      editable: false,
    });
    expect(readFileMock).toHaveBeenCalledTimes(1);
    expect(readFileMock.mock.calls[0]?.[1]).toBe('utf8');
  });

  it('throws a typed RunnerBundleMissingError (not a raw fs error) when the bundle is absent', async () => {
    readFileMock.mockRejectedValue(Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' }));

    await expect(loadRunnerBundleFile()).rejects.toThrow(RunnerBundleMissingError);
  });

  it('RunnerBundleMissingError carries the resolved path, a 500 status, and a build-it-yourself message', async () => {
    readFileMock.mockRejectedValue(new Error('ENOENT'));

    try {
      await loadRunnerBundleFile();
      throw new Error('expected loadRunnerBundleFile to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(RunnerBundleMissingError);
      const bundleErr = err as InstanceType<typeof RunnerBundleMissingError>;
      expect(bundleErr.code).toBe('runner_bundle_missing');
      expect(bundleErr.statusCode).toBe(500);
      expect(bundleErr.message).toContain('agent-runner');
      expect(bundleErr.message).toContain('dist');
      expect(bundleErr.message).toContain('index.js');
      expect(bundleErr.message).toContain('cd agent-runner && pnpm build');
    }
  });
});
