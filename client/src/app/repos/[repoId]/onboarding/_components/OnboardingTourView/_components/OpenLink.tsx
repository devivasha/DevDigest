import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { githubOpenUrl } from "../helpers";

/** "Open" action — links to a verified in-tree repo path only. `path` values
 *  reaching this component are already server-grounded (AC-13); the href is
 *  always built from `https://github.com/{repoFullName}/blob/...` (never
 *  from raw model text), so it can never be a `javascript:`-style URL. When
 *  the repo's full name isn't loaded yet, renders disabled rather than a
 *  dead/unsafe link. */
export function OpenLink({
  path,
  repoFullName,
  defaultBranch,
}: {
  path: string;
  repoFullName: string | null | undefined;
  defaultBranch: string | null | undefined;
}) {
  const t = useTranslations("onboarding");
  const href = githubOpenUrl(repoFullName, defaultBranch, path);

  if (!href) {
    return (
      <span
        aria-disabled="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 12,
          color: "var(--text-muted)",
          padding: "4px 9px",
          opacity: 0.6,
        }}
      >
        <Icon.ExternalLink size={12} />
        {t("open")}
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("openLabel", { path })}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 12,
        fontWeight: 600,
        color: "var(--accent-text)",
        padding: "4px 9px",
        borderRadius: 5,
        border: "1px solid var(--border-strong)",
        textDecoration: "none",
        flexShrink: 0,
      }}
    >
      <Icon.ExternalLink size={12} />
      {t("open")}
    </a>
  );
}
