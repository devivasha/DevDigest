/** Lightweight client-side `owner/name` shape check (AC-28 does the authoritative
 *  4xx validation server-side; this only gates the wizard's own "Continue" button
 *  so the user isn't sent to Preview/Configure/Install with an obviously bad repo). */
export function isValidRepo(repo: string): boolean {
  const trimmed = repo.trim();
  if (trimmed.includes(" ")) return false;
  const parts = trimmed.split("/");
  return parts.length === 2 && (parts[0]?.length ?? 0) > 0 && (parts[1]?.length ?? 0) > 0;
}
