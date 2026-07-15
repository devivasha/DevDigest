/* safeHttpUrl — guards `<a href>` against `javascript:`/other unsafe schemes
 * reaching the DOM from untrusted data (e.g. `CiRun.github_url`, ingested
 * from CI and never validated server-side). Returns the URL unchanged only
 * when its protocol is `http:`/`https:`; returns `undefined` for anything
 * else (malformed URLs, `javascript:`, `data:`, etc.) so callers can render
 * a plain-text fallback instead of a clickable link. */
export function safeHttpUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}
