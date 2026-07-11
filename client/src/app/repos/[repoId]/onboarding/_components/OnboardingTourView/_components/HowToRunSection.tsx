import { useTranslations } from "next-intl";
import type { OnboardingHowToRunStep } from "@devdigest/shared";
import { SECTION_ICON } from "../constants";
import { s } from "../styles";
import { SectionCard } from "./SectionCard";
import { CopyButton } from "./CopyButton";

/** Section 3 — How to run locally: ordered commands, each with a copy
 *  button. Display-only — DevDigest never executes these commands (AC-8);
 *  `CopyButton` only ever calls `navigator.clipboard.writeText`. */
export function HowToRunSection({ howToRun }: { howToRun: OnboardingHowToRunStep[] }) {
  const t = useTranslations("onboarding");
  const ordered = [...howToRun].sort((a, b) => a.order - b.order);
  if (ordered.length === 0) {
    return (
      <SectionCard id="howToRun" icon={SECTION_ICON.howToRun} title={t("sections.howToRun.title")}>
        <p style={s.emptyRow}>{t("sections.howToRun.empty")}</p>
      </SectionCard>
    );
  }
  return (
    <SectionCard id="howToRun" icon={SECTION_ICON.howToRun} title={t("sections.howToRun.title")}>
      {ordered.map((step) => (
        <div key={step.order}>
          <div style={s.commandRow}>
            <span style={s.orderBadge} aria-hidden="true">
              {step.order}
            </span>
            <code style={s.commandText}>{step.command}</code>
            <CopyButton text={step.command} label={t("sections.howToRun.copyLabel", { command: step.command })} />
          </div>
          {step.note && <div style={s.commandNote}>{step.note}</div>}
        </div>
      ))}
    </SectionCard>
  );
}
