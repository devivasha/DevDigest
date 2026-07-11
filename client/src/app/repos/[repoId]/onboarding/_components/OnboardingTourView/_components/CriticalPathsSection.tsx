import { useTranslations } from "next-intl";
import type { OnboardingCriticalPath } from "@devdigest/shared";
import { SECTION_ICON } from "../constants";
import { s } from "../styles";
import { SectionCard } from "./SectionCard";
import { OpenLink } from "./OpenLink";

/** Section 2 — Critical paths: ranked rows of path + one-line "why it
 *  matters" + Open (AC-7). Ranking (rank + importer/caller count) is decided
 *  server-side — this renders the array in the order it arrives. */
export function CriticalPathsSection({
  criticalPaths,
  repoFullName,
  defaultBranch,
}: {
  criticalPaths: OnboardingCriticalPath[];
  repoFullName: string | null | undefined;
  defaultBranch: string | null | undefined;
}) {
  const t = useTranslations("onboarding");
  if (criticalPaths.length === 0) {
    return (
      <SectionCard id="criticalPaths" icon={SECTION_ICON.criticalPaths} title={t("sections.criticalPaths.title")}>
        <p style={s.emptyRow}>{t("sections.criticalPaths.empty")}</p>
      </SectionCard>
    );
  }
  return (
    <SectionCard id="criticalPaths" icon={SECTION_ICON.criticalPaths} title={t("sections.criticalPaths.title")}>
      {criticalPaths.map((cp) => (
        <div key={cp.path} style={s.row}>
          <div style={s.rowMain}>
            <div style={s.rowPath}>
              <code>{cp.path}</code>
              {cp.callerCount != null && (
                <span style={s.rowWhy}>{t("sections.criticalPaths.usedBy", { count: cp.callerCount })}</span>
              )}
            </div>
            <div style={s.rowWhy}>{cp.why}</div>
          </div>
          <OpenLink path={cp.path} repoFullName={repoFullName} defaultBranch={defaultBranch} />
        </div>
      ))}
    </SectionCard>
  );
}
