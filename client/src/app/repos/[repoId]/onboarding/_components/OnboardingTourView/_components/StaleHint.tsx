import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { s } from "../styles";

/** "Facts changed — regenerate" hint (AC-16): the repo index has been
 *  refreshed since this tour was generated. */
export function StaleHint() {
  const t = useTranslations("onboarding");
  return (
    <div style={{ ...s.banner, ...s.staleBanner }} role="status">
      <Icon.Info size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{t("stale.hint")}</span>
    </div>
  );
}
