import { describe, it, expect } from 'vitest';
import { classifyFile } from './smart-diff-classifier.js';

describe('classifyFile', () => {
  // ── boilerplate ────────────────────────────────────────────────────────
  it('pnpm-lock.yaml → boilerplate', () => {
    expect(classifyFile('pnpm-lock.yaml')).toBe('boilerplate');
  });

  it('package-lock.json → boilerplate', () => {
    expect(classifyFile('package-lock.json')).toBe('boilerplate');
  });

  it('drizzle migration SQL → boilerplate', () => {
    expect(classifyFile('drizzle/0001_initial_schema.sql')).toBe('boilerplate');
  });

  it('dist output file → boilerplate', () => {
    expect(classifyFile('dist/server.js')).toBe('boilerplate');
  });

  it('vitest snapshot → boilerplate', () => {
    expect(classifyFile('src/__snapshots__/review.test.ts.snap')).toBe('boilerplate');
  });

  // ── wiring ─────────────────────────────────────────────────────────────
  it('src/index.ts → wiring', () => {
    expect(classifyFile('src/index.ts')).toBe('wiring');
  });

  it('next.config.ts → wiring', () => {
    expect(classifyFile('next.config.ts')).toBe('wiring');
  });

  it('vitest.config.ts → wiring', () => {
    expect(classifyFile('vitest.config.ts')).toBe('wiring');
  });

  it('tsconfig.json → wiring', () => {
    expect(classifyFile('tsconfig.json')).toBe('wiring');
  });

  it('Dockerfile → wiring', () => {
    expect(classifyFile('Dockerfile')).toBe('wiring');
  });

  // ── core ───────────────────────────────────────────────────────────────
  it('review service → core', () => {
    expect(classifyFile('src/modules/reviews/service.ts')).toBe('core');
  });

  it('smart-diff-classifier → core', () => {
    expect(classifyFile('src/modules/pulls/smart-diff-classifier.ts')).toBe('core');
  });

  it('React component → core', () => {
    expect(classifyFile('client/src/components/DiffViewer/DiffViewer.tsx')).toBe('core');
  });

  it('reviewer-core pipeline → core', () => {
    expect(classifyFile('reviewer-core/src/pipeline/run.ts')).toBe('core');
  });

  it('unit test file → core', () => {
    expect(classifyFile('src/modules/pulls/classifier.test.ts')).toBe('core');
  });
});
