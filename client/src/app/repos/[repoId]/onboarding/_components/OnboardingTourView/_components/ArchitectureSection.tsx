import { useTranslations } from "next-intl";
import type { OnboardingArchitecture } from "@devdigest/shared";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import { SECTION_ICON } from "../constants";
import { splitNarrative, githubOpenUrl } from "../helpers";
import { s } from "../styles";
import { SectionCard } from "./SectionCard";

/** Section 1 — Architecture overview: short narrative with inline code refs
 *  rendered as clickable Open affordances (AC-6), plus the component
 *  diagram. `diagram` feeds `MermaidDiagram({ chart })` directly — pass the
 *  string straight through, render nothing when it is `null`. Only inline
 *  code spans that match a server-grounded `codeRefs` path (AC-13) become
 *  links; everything else (including unverifiable paths) stays plain text,
 *  i.e. de-linked. */
export function ArchitectureSection({
  architecture,
  repoFullName,
  defaultBranch,
}: {
  architecture: OnboardingArchitecture;
  repoFullName: string | null | undefined;
  defaultBranch: string | null | undefined;
}) {
  const t = useTranslations("onboarding");
  const verifiedPaths = new Set(architecture.codeRefs.map((ref) => ref.path));
  const segments = splitNarrative(architecture.narrative);

  return (
    <SectionCard id="architecture" icon={SECTION_ICON.architecture} title={t("sections.architecture.title")}>
      {architecture.narrative ? (
        <p style={s.narrative}>
          {segments.map((seg, i) => {
            if (seg.type === "text") return <span key={i}>{seg.value}</span>;
            const href = verifiedPaths.has(seg.value)
              ? githubOpenUrl(repoFullName, defaultBranch, seg.value)
              : null;
            return href ? (
              <a
                key={i}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("openLabel", { path: seg.value })}
                style={s.inlineCodeLink}
              >
                {seg.value}
              </a>
            ) : (
              <code key={i} style={s.inlineCode}>
                {seg.value}
              </code>
            );
          })}
        </p>
      ) : (
        <p style={s.emptyRow}>{t("sections.architecture.empty")}</p>
      )}

      {architecture.diagram && <MermaidDiagram chart={architecture.diagram} />}
    </SectionCard>
  );
}
