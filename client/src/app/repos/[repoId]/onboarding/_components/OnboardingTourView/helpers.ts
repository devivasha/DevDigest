/** Split a bare backtick-delimited narrative string into plain-text and
 *  inline-code segments, e.g. "See `src/server.ts` for..." →
 *  [{ type: "text", value: "See " }, { type: "code", value: "src/server.ts" },
 *   { type: "text", value: " for..." }].
 *  The architecture narrative is untrusted model output (spec: Untrusted
 *  inputs) — this never uses dangerouslySetInnerHTML; every segment renders
 *  as a plain React text node, so it is auto-escaped regardless of content. */
export type NarrativeSegment =
  | { type: "text"; value: string }
  | { type: "code"; value: string };

export function splitNarrative(narrative: string): NarrativeSegment[] {
  const segments: NarrativeSegment[] = [];
  const re = /`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(narrative)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: narrative.slice(lastIndex, match.index) });
    }
    segments.push({ type: "code", value: match[1] ?? "" });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < narrative.length) {
    segments.push({ type: "text", value: narrative.slice(lastIndex) });
  }
  return segments;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type RelativeTimeParts =
  | { unit: "now" }
  | { unit: "minutes" | "hours" | "days"; count: number };

/** Coarse relative-time bucketing for the "last refreshed …" header text.
 *  Returns a unit + count rather than a formatted string so the caller
 *  renders it through `useTranslations` (ICU plural forms) instead of
 *  hardcoding English words here. */
export function getRelativeTimeParts(iso: string, now: number = Date.now()): RelativeTimeParts {
  const then = Date.parse(iso);
  const diff = Number.isNaN(then) ? 0 : Math.max(0, now - then);
  if (diff < MINUTE_MS) return { unit: "now" };
  if (diff < HOUR_MS) return { unit: "minutes", count: Math.max(1, Math.round(diff / MINUTE_MS)) };
  if (diff < DAY_MS) return { unit: "hours", count: Math.max(1, Math.round(diff / HOUR_MS)) };
  return { unit: "days", count: Math.max(1, Math.round(diff / DAY_MS)) };
}

/** Build a same-origin GitHub blob URL for a verified in-tree repo path.
 *  Only ever composed from `window.location`-independent, server-controlled
 *  data (repo full name + default branch) plus a path the server already
 *  grounded against the real index/clone (AC-13) — never from raw model
 *  text — so this can never produce a `javascript:`-style URL. */
export function githubOpenUrl(
  repoFullName: string | null | undefined,
  defaultBranch: string | null | undefined,
  path: string,
): string | null {
  if (!repoFullName) return null;
  const branch = defaultBranch || "main";
  const encoded = path
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `https://github.com/${repoFullName}/blob/${branch}/${encoded}`;
}
