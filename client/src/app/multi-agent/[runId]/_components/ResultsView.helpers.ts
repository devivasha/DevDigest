/* Local formatters for ResultsView's header meta line. Scoped to this
   component only — not shared with MultiAgentColumns/MultiAgentTabs, which
   own their own formatting (see their respective styles/helpers files). */

/** "8.2s" under 60s, else whole minutes ("3m"). */
export function formatRunDuration(ms: number): string {
  if (ms < 60_000) return (ms / 1000).toFixed(1) + "s";
  return Math.round(ms / 60_000) + "m";
}

/** "$0.20"; missing/null cost renders as "$0.00". */
export function formatRunCost(usd: number | null | undefined): string {
  if (usd == null) return "$0.00";
  return "$" + usd.toFixed(2);
}
