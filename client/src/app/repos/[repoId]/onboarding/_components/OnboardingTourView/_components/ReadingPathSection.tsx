import { useTranslations } from "next-intl";
import type { OnboardingReadingPathItem } from "@devdigest/shared";
import { SECTION_ICON } from "../constants";
import { s } from "../styles";
import { SectionCard } from "./SectionCard";
import { OpenLink } from "./OpenLink";

/** Section 4 — Guided reading path: ordered rows of path + rationale + Open
 *  (AC-9). Order (rank DESC) is decided server-side — this renders the
 *  array in the order it arrives, numbered for the reading sequence. */
export function ReadingPathSection({
  readingPath,
  repoFullName,
  defaultBranch,
}: {
  readingPath: OnboardingReadingPathItem[];
  repoFullName: string | null | undefined;
  defaultBranch: string | null | undefined;
}) {
  const t = useTranslations("onboarding");
  const ordered = [...readingPath].sort((a, b) => a.order - b.order);
  if (ordered.length === 0) {
    return (
      <SectionCard id="readingPath" icon={SECTION_ICON.readingPath} title={t("sections.readingPath.title")}>
        <p style={s.emptyRow}>{t("sections.readingPath.empty")}</p>
      </SectionCard>
    );
  }
  return (
    <SectionCard id="readingPath" icon={SECTION_ICON.readingPath} title={t("sections.readingPath.title")}>
      {ordered.map((item) => (
        <div key={item.order} style={s.row}>
          <span style={s.orderBadge} aria-hidden="true">
            {item.order}
          </span>
          <div style={s.rowMain}>
            <code style={s.rowPath}>{item.path}</code>
            <div style={s.rowWhy}>{item.rationale}</div>
          </div>
          <OpenLink path={item.path} repoFullName={repoFullName} defaultBranch={defaultBranch} />
        </div>
      ))}
    </SectionCard>
  );
}
