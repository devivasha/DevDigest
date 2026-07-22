"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, FormField, SearchableSelect } from "@devdigest/ui";
import type { CiTarget } from "@/vendor/shared/contracts/eval-ci";
import { useRepos } from "@/lib/hooks/repos";

/** AC-2: exactly four targets, in display order, `gha` recommended. */
const TARGET_ORDER: CiTarget[] = ["gha", "circle", "jenkins", "cli"];

export interface TargetStepProps {
  target: CiTarget;
  repo: string;
  onSelectTarget: (target: CiTarget) => void;
  onRepoChange: (repo: string) => void;
}

/** Step 1/4 — choose the CI target + the repo to export into (AC-1, AC-2). */
export function TargetStep({ target, repo, onSelectTarget, onRepoChange }: TargetStepProps) {
  const t = useTranslations("ci");

  // Populate the repo picker from the repos the user has already connected
  // (GET /repos). Selecting from this list — rather than free-typing owner/name —
  // guarantees a well-formed value, so the wizard's own Continue gate passes.
  const reposQuery = useRepos();
  const repoOptions = (reposQuery.data ?? []).map((r) => ({ value: r.full_name, label: r.full_name }));
  const noRepos = !reposQuery.isLoading && repoOptions.length === 0;

  return (
    <div style={{ padding: 24 }}>
      <div
        role="radiogroup"
        aria-label={t("exportWizard.steps.target")}
        style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginBottom: 24 }}
      >
        {TARGET_ORDER.map((option) => {
          const selected = target === option;
          const recommended = option === "gha";
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelectTarget(option)}
              style={{
                textAlign: "left",
                padding: 16,
                borderRadius: 10,
                border: `1.5px solid ${selected ? "var(--accent)" : "var(--border-strong)"}`,
                background: selected ? "var(--bg-hover)" : "var(--bg-elevated)",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
                  {t(`exportWizard.targets.${option}`)}
                </span>
                {recommended && (
                  <Badge color="var(--ok)" bg="var(--ok-bg)">
                    {t("exportWizard.recommended")}
                  </Badge>
                )}
              </div>
              <div className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {t(`exportWizard.targets.${option}Desc`)}
              </div>
            </button>
          );
        })}
      </div>

      <FormField
        label={t("exportWizard.repoLabel")}
        hint={noRepos ? t("exportWizard.repoEmpty") : t("exportWizard.repoHint")}
      >
        <SearchableSelect
          value={repo}
          onChange={onRepoChange}
          options={repoOptions}
          placeholder={
            reposQuery.isLoading ? t("exportWizard.repoLoading") : t("exportWizard.repoSearch")
          }
        />
      </FormField>
    </div>
  );
}
