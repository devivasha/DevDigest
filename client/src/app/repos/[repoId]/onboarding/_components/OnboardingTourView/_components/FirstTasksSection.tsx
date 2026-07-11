import { useTranslations } from "next-intl";
import type { OnboardingFirstTask } from "@devdigest/shared";
import { SECTION_ICON } from "../constants";
import { s } from "../styles";
import { SectionCard } from "./SectionCard";

/** Section 5 — First tasks: a bounded list of starter tasks (AC-10). */
export function FirstTasksSection({ firstTasks }: { firstTasks: OnboardingFirstTask[] }) {
  const t = useTranslations("onboarding");
  if (firstTasks.length === 0) {
    return (
      <SectionCard id="firstTasks" icon={SECTION_ICON.firstTasks} title={t("sections.firstTasks.title")}>
        <p style={s.emptyRow}>{t("sections.firstTasks.empty")}</p>
      </SectionCard>
    );
  }
  return (
    <SectionCard id="firstTasks" icon={SECTION_ICON.firstTasks} title={t("sections.firstTasks.title")}>
      {firstTasks.map((task, i) => (
        <div key={i} style={s.row}>
          <span style={s.orderBadge} aria-hidden="true">
            {i + 1}
          </span>
          <div style={s.rowMain}>
            <div style={s.taskTitle}>{task.title}</div>
            {task.detail && <div style={s.taskDetail}>{task.detail}</div>}
          </div>
        </div>
      ))}
    </SectionCard>
  );
}
