"use client";

/* CiTab — Agent editor "CI" tab (T10, AC-1/18/19/20). Lists this agent's
   `ci_installations` (repo + status + D5 workflow-version snapshot),
   its CI-sourced run history, a "Fail CI on" selector bound to
   `agents.ci_fail_on` (reuses the SAME `useUpdateAgent` mutation
   `ConfigTab` uses — no new endpoint), and an "Add to CI" button that
   opens the T9 `ExportWizard`. The wizard's open/close state is local to
   this component (React best practice: push state down to where it's
   used). */

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, FormField, Skeleton, SelectInput } from "@devdigest/ui";
import { ExportWizard } from "@/components/ci/ExportWizard";
import { useAgent, useUpdateAgent } from "@/lib/hooks/agents";
import { useAgentInstallations, useAgentCiRuns } from "@/lib/hooks/ci";
import { CI_FAIL_ON_VALUES } from "../ConfigTab/constants";
import { InstallationsList } from "./InstallationsList";
import { RunsList } from "./RunsList";
import { s } from "./styles";

export function CiTab({ agentId, agentName }: { agentId: string; agentName?: string }) {
  const t = useTranslations("agents");
  const [wizardOpen, setWizardOpen] = React.useState(false);

  const agentQuery = useAgent(agentId);
  const installationsQuery = useAgentInstallations(agentId);
  const runsQuery = useAgentCiRuns(agentId);
  const updateAgent = useUpdateAgent();

  const ciFailOnOptions = React.useMemo(
    () => CI_FAIL_ON_VALUES.map((v) => ({ value: v, label: t(`config.ciFailOnOptions.${v}`) })),
    [t],
  );

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={s.headerText}>
          <h2 style={s.h2}>{t("ciTab.heading")}</h2>
          <p style={s.subtitle}>{t("ciTab.subtitle")}</p>
        </div>
        <Button kind="primary" icon="Workflow" onClick={() => setWizardOpen(true)}>
          {t("ciTab.addToCi")}
        </Button>
      </div>

      {agentQuery.data && (
        <div style={s.section}>
          <FormField label={t("ciTab.failOn.label")} hint={t("ciTab.failOn.hint")}>
            <SelectInput
              value={agentQuery.data.ci_fail_on}
              onChange={(v) =>
                updateAgent.mutate({ id: agentId, patch: { ci_fail_on: v as (typeof CI_FAIL_ON_VALUES)[number] } })
              }
              options={ciFailOnOptions}
            />
          </FormField>
        </div>
      )}

      <div style={s.section}>
        <div style={s.sectionTitle}>{t("ciTab.installations.title")}</div>
        {installationsQuery.isLoading && <Skeleton height={80} />}
        {!installationsQuery.isLoading && installationsQuery.isError && (
          <ErrorState onRetry={() => installationsQuery.refetch()} body={t("ciTab.loadError")} />
        )}
        {!installationsQuery.isLoading &&
          !installationsQuery.isError &&
          (installationsQuery.data?.length ?? 0) === 0 && (
            <EmptyState icon="Workflow" title={t("ciTab.installations.empty")} />
          )}
        {!installationsQuery.isLoading &&
          !installationsQuery.isError &&
          (installationsQuery.data?.length ?? 0) > 0 && (
            <InstallationsList installations={installationsQuery.data!} />
          )}
      </div>

      <div style={s.section}>
        <div style={s.sectionTitle}>{t("ciTab.runs.title")}</div>
        {runsQuery.isLoading && <Skeleton height={80} />}
        {!runsQuery.isLoading && runsQuery.isError && (
          <ErrorState onRetry={() => runsQuery.refetch()} body={t("ciTab.loadError")} />
        )}
        {!runsQuery.isLoading && !runsQuery.isError && (runsQuery.data?.length ?? 0) === 0 && (
          <EmptyState icon="Clock" title={t("ciTab.runs.empty")} />
        )}
        {!runsQuery.isLoading && !runsQuery.isError && (runsQuery.data?.length ?? 0) > 0 && (
          <RunsList runs={runsQuery.data!} />
        )}
      </div>

      {wizardOpen && (
        <ExportWizard agentId={agentId} agentName={agentName ?? ""} onClose={() => setWizardOpen(false)} />
      )}
    </div>
  );
}
