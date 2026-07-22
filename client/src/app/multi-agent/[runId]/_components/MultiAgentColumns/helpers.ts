import type { AgentColumn, RunEvent } from "@devdigest/shared";

export interface ColumnLiveStatus {
  status: AgentColumn["status"];
  /** Human-readable failure reason, when known. Null when the column has not
   * failed, or has failed but no reason is available (e.g. after a restart
   * dropped the SSE stream before any error event arrived). */
  failedReason: string | null;
}

/**
 * Reconcile a column's live status from streamed SSE events (via
 * `useRunEvents`), falling back to the persisted `column.status` when no
 * terminal event has arrived yet for this run_id. This covers the
 * spec-accepted case where a page reload drops the live stream — the column
 * still shows its last known persisted status (T10 gotcha).
 *
 * The reload-path failure reason comes from `column.error`
 * (`agent_runs.error`, surfaced by the server's `loadColumns` — AC-16) rather
 * than `column.summary`: a failed run never gets a `reviews` row, so
 * `summary` is always null for it. `column.error` is what actually persists
 * the reason across a reload with no live SSE stream.
 *
 * A failed column never blocks its siblings from resolving/rendering (AC-16):
 * this function is pure and per-column, with no shared mutable state.
 */
export function resolveColumnStatus(column: AgentColumn, events: RunEvent[]): ColumnLiveStatus {
  const columnEvents = events.filter((event) => event.runId === column.run_id);

  const lastError = [...columnEvents].reverse().find((event) => event.kind === "error");
  if (lastError) {
    return { status: "failed", failedReason: lastError.msg };
  }

  const hasResult = columnEvents.some((event) => event.kind === "result");
  if (hasResult) {
    return { status: "done", failedReason: null };
  }

  return {
    status: column.status,
    failedReason: column.status === "failed" ? (column.error ?? null) : null,
  };
}

/** USD cost formatted to 2dp, or null when the cost isn't known yet. */
export function formatCost(usd: number | null): string | null {
  if (usd == null) return null;
  return `$${usd.toFixed(2)}`;
}

/** "8.2s" for sub-minute durations, "2m" once a minute or more, or null when
 * the duration isn't known yet. Mirrors `multi-agent/_components/helpers.ts`
 * (`formatDuration`) — duplicated rather than imported to avoid cross-feature
 * coupling between this feature's private `_components` dir and that one's
 * (see that file's own note on the same tradeoff). */
export function formatDuration(ms: number | null): string | null {
  if (ms == null) return null;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}
