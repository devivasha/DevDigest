/**
 * Config — read environment variables once at startup.
 *
 * NEVER reads secrets. NEVER logs to stdout (stdout is the JSON-RPC channel).
 * Any value that could be a secret should use SecretsProvider on the server side,
 * not here.
 */

export const config = {
  /** Base URL of the DevDigest API. Default: http://localhost:3001. */
  apiUrl: process.env['DEVDIGEST_API_URL'] ?? 'http://localhost:3001',

  /** Milliseconds between poll attempts when waiting for a review run. */
  pollIntervalMs: 2_000,

  /** Maximum milliseconds to wait for a review run before returning a timeout result. */
  runTimeoutMs: 120_000,
} as const;
