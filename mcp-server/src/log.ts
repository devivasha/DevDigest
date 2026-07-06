/**
 * log.ts — stderr-ONLY logger.
 *
 * CRITICAL: over stdio, stdout is the JSON-RPC channel. Any `console.log`
 * (which writes to stdout) corrupts the protocol and breaks the client
 * connection. Every diagnostic MUST go to stderr. Never call `console.log`
 * anywhere in this package — use these helpers, which wrap `console.error`.
 */

function emit(level: string, msg: string, extra?: unknown): void {
  const line = extra === undefined ? `[mcp:${level}] ${msg}` : `[mcp:${level}] ${msg} ${safe(extra)}`;
  // console.error → stderr. Do NOT switch to console.log.
  console.error(line);
}

function safe(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const log = {
  info: (msg: string, extra?: unknown) => emit("info", msg, extra),
  warn: (msg: string, extra?: unknown) => emit("warn", msg, extra),
  error: (msg: string, extra?: unknown) => emit("error", msg, extra),
};
