import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { DegradedReason } from "@devdigest/shared";
import { s } from "../styles";

/** Degraded badge — icon + text label + reason text, never colour alone
 *  (WCAG 2.1 AA, AC-11). `no_data` (no clone / not indexed) additionally
 *  shows a CTA that navigates to the existing add/refresh/index flow
 *  (`/onboarding`, the first-run wizard) — this feature never triggers
 *  cloning or indexing itself (AC-12). `repo_too_large` shows the AC-19
 *  "large repo" note instead. */
export function DegradedBanner({ reason }: { reason: DegradedReason | undefined }) {
  const t = useTranslations("onboarding");
  return (
    <div style={{ ...s.banner, ...s.degradedBanner }} role="status">
      <Icon.AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={s.bannerBody}>
        <div>
          <strong>{t("degraded.badge")}</strong>
          {reason && <span> — {t(`degraded.reason.${reason}`)}</span>}
        </div>
        {reason === "repo_too_large" && <div>{t("degraded.largeRepoNote")}</div>}
        {reason === "no_data" && (
          <div>
            <Link href="/onboarding" style={{ color: "inherit", fontWeight: 600, textDecoration: "underline" }}>
              {t("degraded.cta")}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
