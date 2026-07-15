/** Formats a duration in seconds as a human-readable string, e.g. "12.3s"
 *  or "2m 5s". Returns "—" for `null`/`undefined` (missing data). Shared by
 *  the CI Runs page (`/ci`) and the agent CI tab's run-history list. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}
