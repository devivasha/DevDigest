/* PrBriefCard — Why+Risk Brief for the Overview tab. Fuses reused signals
   (intent, blast summary, smart-diff stats, linked issue, attached specs)
   into a short reviewer briefing via a single server-side LLM call, cached
   per-PR (`pr_brief`) and refreshed by a Regenerate button. Read-only —
   emitted file paths are already path-grounded server-side; the card only
   renders them as blob-URL links (or non-navigating controls) at PR head
   SHA. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel, Button, Skeleton, Badge, MonoLink } from "@devdigest/ui";
import type { RiskSeverity } from "@devdigest/shared";
import { useBrief, useRegenerateBrief } from "@/lib/hooks/brief";
import { githubBlobUrl } from "@/lib/utils/githubUrls";

interface PrBriefCardProps {
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
}

/** risk_level (high/medium/low) is a DIFFERENT axis from finding Severity
    (CRITICAL/WARNING/…) — do not reuse SeverityBadge/SEV. Icon + text label
    always accompany colour (never colour alone). */
const RISK_LEVEL_MAP: Record<RiskSeverity, { icon: "AlertTriangle" | "AlertOctagon" | "Info"; color: string; bg: string }> = {
  high: { icon: "AlertTriangle", color: "var(--crit)", bg: "var(--crit-bg)" },
  medium: { icon: "AlertOctagon", color: "var(--warn)", bg: "var(--warn-bg)" },
  low: { icon: "Info", color: "var(--info, var(--sugg))", bg: "var(--info-bg, var(--sugg-bg))" },
};

function PathLink({
  path,
  repoFullName,
  headSha,
}: {
  path: string;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const href = repoFullName && headSha ? githubBlobUrl(repoFullName, headSha, path) : undefined;
  return <MonoLink href={href}>{path}</MonoLink>;
}

export function PrBriefCard({ prId, repoFullName, headSha }: PrBriefCardProps) {
  const t = useTranslations("brief");
  const { data, isLoading, isError } = useBrief(prId);
  const regen = useRegenerateBrief(prId);

  const regenerateButton = (
    <Button
      kind="ghost"
      size="sm"
      icon="RefreshCw"
      loading={regen.isPending}
      aria-label={t("regenerateAria")}
      onClick={() => regen.mutate()}
    >
      {t("regenerate")}
    </Button>
  );

  return (
    <Card pad style={{ marginBottom: 0 }}>
      <SectionLabel icon="Sparkles" right={regenerateButton}>
        {t("sectionLabel")}
      </SectionLabel>

      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton height={16} width="90%" />
          <Skeleton height={14} width="70%" />
          <Skeleton height={14} width="80%" />
        </div>
      )}

      {isError && !isLoading && (
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>{t("error")}</p>
      )}

      {!isLoading && !isError && data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <p
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                margin: "0 0 6px 0",
              }}
            >
              {t("whatLabel")}
            </p>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: 0, lineHeight: 1.55 }}>
              {data.what}
            </p>
          </div>

          <div>
            <p
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                margin: "0 0 6px 0",
              }}
            >
              {t("whyLabel")}
            </p>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: 0, lineHeight: 1.55 }}>
              {data.why}
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              {t("riskLevel")}
            </span>
            {(() => {
              const rl = RISK_LEVEL_MAP[data.risk_level];
              return (
                <Badge color={rl.color} bg={rl.bg} icon={rl.icon}>
                  {t(`riskLevelLabels.${data.risk_level}`)}
                </Badge>
              );
            })()}
          </div>

          <div>
            <p
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                margin: "0 0 6px 0",
              }}
            >
              {t("risksLabel")}
            </p>
            {data.risks.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>{t("emptyRisks")}</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {data.risks.map((risk, i) => {
                  const rl = RISK_LEVEL_MAP[risk.severity];
                  return (
                    <li key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Badge color={rl.color} bg={rl.bg} icon={rl.icon}>
                          {t(`riskLevelLabels.${risk.severity}`)}
                        </Badge>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                          {risk.title}
                        </span>
                      </div>
                      <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
                        {risk.explanation}
                      </p>
                      {risk.file_refs.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                          {risk.file_refs.map((path) => (
                            <PathLink key={path} path={path} repoFullName={repoFullName} headSha={headSha} />
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div>
            <p
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                margin: "0 0 6px 0",
              }}
            >
              {t("reviewFocusLabel")}
            </p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {data.review_focus.map((item, i) => (
                <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13 }}>
                  <PathLink path={item.path} repoFullName={repoFullName} headSha={headSha} />
                  <span style={{ color: "var(--text-muted)" }}>—</span>
                  <span style={{ color: "var(--text-secondary)" }}>{item.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}

export default PrBriefCard;
