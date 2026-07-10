/** Split a repo-relative doc path into its containing folder and filename. */
export function splitPath(path: string): { folder: string; filename: string } {
  const idx = path.lastIndexOf("/");
  if (idx === -1) return { folder: "", filename: path };
  return { folder: path.slice(0, idx), filename: path.slice(idx + 1) };
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type RelativeTimeParts =
  | { unit: "now" }
  | { unit: "minutes" | "hours" | "days"; count: number };

/**
 * Coarse relative-time bucketing for the summary footer's "refreshed …" text.
 * Returns a unit + count rather than a formatted string so the caller renders
 * it through `useTranslations` (ICU plural forms) instead of hardcoding
 * English words here — keeps every user-facing word translatable.
 */
export function getRelativeTimeParts(iso: string, now: number = Date.now()): RelativeTimeParts {
  const then = Date.parse(iso);
  const diff = Number.isNaN(then) ? 0 : Math.max(0, now - then);
  if (diff < MINUTE_MS) return { unit: "now" };
  if (diff < HOUR_MS) return { unit: "minutes", count: Math.max(1, Math.round(diff / MINUTE_MS)) };
  if (diff < DAY_MS) return { unit: "hours", count: Math.max(1, Math.round(diff / HOUR_MS)) };
  return { unit: "days", count: Math.max(1, Math.round(diff / DAY_MS)) };
}
