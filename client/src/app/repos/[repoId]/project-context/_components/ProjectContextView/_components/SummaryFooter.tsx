import { useTranslations } from "next-intl";
import type { DiscoverySummary } from "@devdigest/shared";
import { getRelativeTimeParts } from "../helpers";
import { s } from "../styles";

/**
 * `● {document_count} documents · ≈ {total_estimated_tokens} tokens total ·
 * refreshed {relative}` — deliberately no "chunks"/"indexed"/index wording:
 * this feature reads files fresh on each run, it is not a RAG index (AC-7).
 */
export function SummaryFooter({ summary }: { summary: DiscoverySummary }) {
  const t = useTranslations("projectContext");
  const rel = getRelativeTimeParts(summary.refreshed_at);
  const relative = rel.unit === "now" ? t("footer.justNow") : t(`footer.${rel.unit}Ago`, { count: rel.count });
  return (
    <div style={s.footer}>
      <span aria-hidden="true">●</span>
      <span>
        {t("footer.summary", {
          count: summary.document_count,
          tokens: summary.total_estimated_tokens,
          relative,
        })}
      </span>
    </div>
  );
}
