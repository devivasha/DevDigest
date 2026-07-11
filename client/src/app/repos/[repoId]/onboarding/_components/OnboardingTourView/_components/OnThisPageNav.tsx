import { useTranslations } from "next-intl";
import { SECTION_IDS } from "../constants";
import { s } from "../styles";

/** "ON THIS PAGE" anchor nav. Plain in-page `<a href="#id">` links — native
 *  browser anchor navigation is keyboard-operable (Tab + Enter) with no
 *  extra JS needed; `activeId` highlights the currently-visible section. */
export function OnThisPageNav({ activeId }: { activeId: string | null }) {
  const t = useTranslations("onboarding");
  return (
    <nav aria-label={t("onThisPage")} style={s.nav}>
      <div style={s.navLabel}>{t("onThisPage")}</div>
      <ul style={s.navList}>
        {SECTION_IDS.map((id) => (
          <li key={id}>
            <a
              href={`#${id}`}
              style={{
                ...s.navLink,
                ...(activeId === id ? s.navLinkActive : {}),
              }}
              aria-current={activeId === id ? "true" : undefined}
            >
              {t(`sections.${id}.title`)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
