/**
 * Stderr-only logger.
 *
 * IMPORTANT: stdout is the JSON-RPC transport channel for the MCP protocol.
 * Writing ANYTHING to stdout (including console.log) corrupts the protocol.
 * ALL logging MUST go through this module using console.error (stderr).
 *
 * Do NOT use console.log anywhere under src/ — use log.info / log.warn / log.error.
 */

function fmt(level: string, message: string, data?: unknown): string {
  const ts = new Date().toISOString();
  if (data !== undefined) {
    return `[${ts}] ${level} ${message} ${JSON.stringify(data)}`;
  }
  return `[${ts}] ${level} ${message}`;
}

export const log = {
  info(message: string, data?: unknown): void {
    console.error(fmt('INFO ', message, data));
  },

  warn(message: string, data?: unknown): void {
    console.error(fmt('WARN ', message, data));
  },

  error(message: string, data?: unknown): void {
    console.error(fmt('ERROR', message, data));
  },
};
