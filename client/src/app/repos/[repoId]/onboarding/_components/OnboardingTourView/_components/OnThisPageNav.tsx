import { useTranslations } from "next-intl";
import { SECTION_IDS } from "../constants";
import { s } from "../styles";

/** "ON THIS PAGE" anchor nav. Plain in-page `<a href="#id">` links — native
 *  browser anchor navigation is keyboard-operable (Tab + Enter) with no
 *  extra JS needed; `activeId` highlights the currently-visible section.
 *  `onSelect` lets a click set the active item explicitly, since a clicked
 *  section near the bottom can't scroll to the top for the observer to catch
 *  it — the native anchor jump is preserved (no preventDefault). */
export function OnThisPageNav({
  activeId,
  onSelect,
}: {
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("onboarding");
  return (
    <nav aria-label={t("onThisPage")} style={s.nav}>
      <div style={s.navLabel}>{t("onThisPage")}</div>
      <ul style={s.navList}>
        {SECTION_IDS.map((id) => (
          <li key={id}>
            <a
              href={`#${id}`}
              onClick={() => onSelect(id)}
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
