/* routes.test.ts — AC-19 rate-limit behavior for the brief routes.
 *
 * The real app disables the rate-limit plugin under `nodeEnv==='test'`
 * (see app.ts) so integration suites can hammer endpoints. Here we register
 * the plugin in a test-local Fastify instance so the per-route
 * `config.rateLimit { max: 10 }` on the brief routes is actually enforced, and
 * assert the AC-19 observable: the 11th request within the window -> HTTP 429.
 *
 * No DB/LLM is needed: the rate-limit `onRequest` hook rejects the 11th request
 * BEFORE any handler runs, and the first 10 handler invocations (which would hit
 * a stub container) simply error out — we only assert their status is not 429.
 */
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { describe, it, expect } from 'vitest';
import briefRoutes from './routes.js';

const UUID = '00000000-0000-0000-0000-000000000000';

async function buildRateLimitedApp() {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // Container is only dereferenced inside handlers; a stub suffices — the 11th
  // request is rejected by the rate-limit hook before any handler executes.
  app.decorate('container', {} as never);
  // Global limit generous; the brief routes' per-route { max: 10 } overrides it.
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  await app.register(briefRoutes);
  await app.ready();
  return app;
}

describe('brief routes — rate limit (AC-19)', () => {
  it('GET /pulls/:id/brief rejects the 11th request in the window with HTTP 429', async () => {
    const app = await buildRateLimitedApp();
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        const res = await app.inject({ method: 'GET', url: `/pulls/${UUID}/brief` });
        statuses.push(res.statusCode);
      }
      // First 10 are within budget (not rate-limited); the 11th is 429.
      expect(statuses.slice(0, 10)).not.toContain(429);
      expect(statuses[10]).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('POST /pulls/:id/brief/regenerate rejects the 11th request in the window with HTTP 429', async () => {
    const app = await buildRateLimitedApp();
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        const res = await app.inject({ method: 'POST', url: `/pulls/${UUID}/brief/regenerate` });
        statuses.push(res.statusCode);
      }
      expect(statuses.slice(0, 10)).not.toContain(429);
      expect(statuses[10]).toBe(429);
    } finally {
      await app.close();
    }
  });
});
