"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Toggle } from "@devdigest/ui";
import { useSecretsStatus } from "@/lib/hooks/settings";
import type { CiTarget } from "@/vendor/shared/contracts/eval-ci";
import {
  GITHUB_TOKEN_SECRET_NAME,
  PROVIDER_SECRET_NAME,
  SUPPORTED_TRIGGERS,
  type SupportedTrigger,
} from "./constants";
import type { WizardPostAs } from "./types";

const POST_AS_OPTIONS: WizardPostAs[] = ["github_review", "pr_comment", "none"];

/** Maps `WizardPostAs` values to `ci.json`'s `exportWizard.postAs.*` key suffixes
 *  (snake_case value → camelCase key: `github_review` → `githubReview`). */
const POST_AS_LABEL_KEY: Record<WizardPostAs, string> = {
  github_review: "githubReview",
  pr_comment: "prComment",
  none: "none",
};

/** Small uppercase section heading — matches the Preview step's "FILES TO CREATE". */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 12,
        fontWeight: 700,
        color: "var(--text-muted)",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

export interface ConfigureStepProps {
  target: CiTarget;
  triggers: string[];
  postAs: WizardPostAs;
  onToggleTrigger: (trigger: SupportedTrigger) => void;
  onChangePostAs: (postAs: WizardPostAs) => void;
}

/** Step 3/4 — trigger toggles (AC-8) + "Post results as" radios with a
 *  merge-blocking hint (AC-9) + the repo secrets the generated runner needs. */
export function ConfigureStep({ target, triggers, postAs, onToggleTrigger, onChangePostAs }: ConfigureStepProps) {
  const t = useTranslations("ci");
  const secretsQuery = useSecretsStatus();
  const providerConfigured = Boolean(secretsQuery.data?.openrouter);
  const githubAutoProvided = target === "gha";

  const secrets: { name: string; label: string; ok: boolean }[] = [
    {
      name: PROVIDER_SECRET_NAME,
      label: providerConfigured ? t("exportWizard.secretSet") : t("exportWizard.secretNotSet"),
      ok: providerConfigured,
    },
    {
      name: GITHUB_TOKEN_SECRET_NAME,
      label: githubAutoProvided ? t("exportWizard.secretAutoProvided") : t("exportWizard.secretRequired"),
      ok: githubAutoProvided,
    },
  ];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24 }}>
      {/* TRIGGER — one labelled row per supported trigger, toggles in a card. */}
      <div>
        <SectionLabel>{t("exportWizard.triggerLabel")}</SectionLabel>
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-elevated)" }}>
          {SUPPORTED_TRIGGERS.map((trigger, i) => {
            const label = t(`exportWizard.triggerNames.${trigger}`);
            return (
              <div
                key={trigger}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "14px 16px",
                  borderTop: i === 0 ? "none" : "1px solid var(--border)",
                }}
              >
                <span style={{ fontSize: 14, color: "var(--text-primary)" }}>{label}</span>
                <Toggle
                  on={triggers.includes(trigger)}
                  onChange={() => onToggleTrigger(trigger)}
                  ariaLabel={label}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* POST RESULTS AS — radios (gha review is recommended). */}
      <div>
        <SectionLabel>{t("exportWizard.postResultsLabel")}</SectionLabel>
        <div role="radiogroup" aria-label={t("exportWizard.postResultsLabel")} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {POST_AS_OPTIONS.map((option) => {
            const selected = postAs === option;
            const recommended = option === "github_review";
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChangePostAs(option)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 4px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    flexShrink: 0,
                    border: `1.5px solid ${selected ? "var(--accent)" : "var(--border-strong)"}`,
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {selected && (
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)" }} />
                  )}
                </span>
                <span style={{ fontSize: 14, color: "var(--text-primary)" }}>
                  {t(`exportWizard.postAs.${POST_AS_LABEL_KEY[option]}`)}
                </span>
                {recommended && (
                  <Badge color="var(--ok)" bg="var(--ok-bg)">
                    {t("exportWizard.recommended")}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10, lineHeight: 1.45 }}>
          {t("exportWizard.postAsHint")}
        </div>
      </div>

      {/* SECRETS — what the generated runner reads from the repo's env. */}
      <div>
        <SectionLabel>{t("exportWizard.secretsLabel")}</SectionLabel>
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-elevated)" }}>
          {secrets.map((secret, i) => (
            <div
              key={secret.name}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "14px 16px",
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
              }}
            >
              <span className="mono" style={{ fontSize: 13, color: "var(--text-primary)" }}>
                {secret.name}
              </span>
              <Badge
                color={secret.ok ? "var(--ok)" : "var(--text-muted)"}
                bg={secret.ok ? "var(--ok-bg)" : "var(--bg-hover)"}
              >
                {secret.label}
              </Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
