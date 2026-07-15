/* ConfigureRun — the interactive body of /multi-agent (T13). Repo + PR
   selectors (URL-driven via ?repo=/&pr=), workspace agent checkboxes with a
   per-agent est time·cost (from useMultiAgentEstimate), a fan-out summary
   line, and a launch button that fires useLaunchMultiAgentRun and navigates
   to the new run's results page.
   AC-5: no PR selected → empty agents state + disabled run button.
   AC-6/AC-7: per-agent estimate renders for EVERY listed agent row, checked
   or not, once a PR is chosen — the estimate hook is called with every
   listed agent's id (not just the selected ones) so every row has data to
   show, with a "no estimate yet" placeholder for cold-start agents. It stays
   disabled until a PR is chosen and there is ≥1 listed agent.
   AC-8: a summary estimate line for the CURRENT SELECTION, fan-out framed —
   computed client-side (`summarizeSelectedEstimate`) from the full
   estimate response, since the server's own `summary` field now aggregates
   every listed agent rather than just the selected subset.
   AC-9: every estimate is visibly "≈"/"est." and NEVER blocks the run — a
   selected agent whose estimate hasn't arrived yet ("no estimate yet") does
   not disable the launch button. */
"use client";

import React, { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Icon } from "@devdigest/ui";
import { SelectInput } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useRepos } from "@/lib/hooks/repos";
import { usePulls } from "@/lib/hooks/pulls";
import { useAgents } from "@/lib/hooks/agents";
import { useLaunchMultiAgentRun, useMultiAgentEstimate } from "@/lib/hooks/multiAgent";
import type { Agent, MultiAgentEstimateAgent } from "@devdigest/shared";
import { formatCost, formatDuration, summarizeSelectedEstimate } from "./helpers";
import { AGENT_THEMES } from "../_shared/agentTheme";
import { s } from "./styles";

const REPO_PARAM = "repo";
const PR_PARAM = "pr";

/** One agent's est time·cost text, or the "no estimate yet" placeholder when
   the estimate hasn't resolved for this agent (cold-start, or the response
   just hasn't arrived yet). Always renders SOME text — every listed agent
   row shows an estimate or the placeholder, regardless of checkbox state
   (AC-6/AC-7). */
function agentEstimateText(
  t: ReturnType<typeof useTranslations>,
  entry: MultiAgentEstimateAgent | undefined,
): string {
  if (!entry) return t("configure.estimateUnknown");
  const durationKnown = entry.est_duration_ms != null;
  const costKnown = entry.est_cost_usd != null;
  if (!durationKnown && !costKnown) return t("configure.estimateUnknown");
  const parts: string[] = [];
  if (durationKnown) {
    parts.push(t("configure.estimateDurationApprox", { duration: formatDuration(entry.est_duration_ms!) }));
  }
  if (costKnown) {
    parts.push(t("configure.estimateCostApprox", { cost: formatCost(entry.est_cost_usd!) }));
  }
  return parts.join(" · ");
}

export function ConfigureRun() {
  const t = useTranslations("multiAgent");
  // `agents.json`'s "Repository" label is reused here rather than adding a new
  // multiAgent.json key (out of this task's owned paths) — same cross-namespace
  // reuse pattern as EvalDashboardView borrowing shell.json's "nav.agents".
  const tAgents = useTranslations("agents");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const repoId = search.get(REPO_PARAM);
  const prIdParam = search.get(PR_PARAM);

  const { data: reposData } = useRepos();
  const { data: pullsData } = usePulls(repoId);
  const { data: agentsData } = useAgents();

  // Gate query-derived rendering behind mount to avoid an SSR/CSR hydration
  // mismatch: on the server these client queries have no data, but on the
  // client the shared QueryClient may already hold cached repos/pulls/agents,
  // so the first client render would otherwise emit <option>s / an agent list
  // the server HTML never contained. Reporting "no data yet" until mounted
  // keeps the first client render identical to the server, then fills in.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const repos = mounted ? reposData : undefined;
  const pulls = mounted ? pullsData : undefined;
  const agents = mounted ? agentsData : undefined;

  const pr = pulls?.find((p) => p.id === prIdParam) ?? null;
  const prId = pr?.id ?? null;

  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  // A PR switch invalidates any in-progress agent selection for the previous PR.
  useEffect(() => {
    setSelectedAgentIds([]);
  }, [prId]);

  // Every LISTED agent's id, not just the selected ones — AC-6/AC-7 requires
  // every row to show its own estimate (or a "no estimate yet" placeholder)
  // as soon as a PR is chosen, before any checkbox is touched.
  const listedAgentIds = (agents ?? []).map((a) => a.id);
  const estimate = useMultiAgentEstimate(prId, listedAgentIds);
  const launch = useLaunchMultiAgentRun();

  const pushParams = useCallback(
    (next: Record<string, string | null>) => {
      const params = new URLSearchParams(search.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value == null) params.delete(key);
        else params.set(key, value);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, search],
  );

  const handleRepoChange = useCallback(
    (value: string) => pushParams({ [REPO_PARAM]: value || null, [PR_PARAM]: null }),
    [pushParams],
  );
  const handlePrChange = useCallback(
    (value: string) => pushParams({ [PR_PARAM]: value || null }),
    [pushParams],
  );

  const toggleAgent = useCallback((agentId: string) => {
    setSelectedAgentIds((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId],
    );
  }, []);

  const allSelected =
    listedAgentIds.length > 0 && selectedAgentIds.length === listedAgentIds.length;
  const handleToggleAll = () => setSelectedAgentIds(allSelected ? [] : listedAgentIds);

  const handleLaunch = useCallback(async () => {
    if (!prId || selectedAgentIds.length === 0) return;
    const result = await launch.mutateAsync({ prId, agentIds: selectedAgentIds });
    router.push(`/multi-agent/${result.id}`);
  }, [prId, selectedAgentIds, launch, router]);

  const repoLabel = tAgents("context.repoLabel");
  const repoOptions = [
    { value: "", label: repoLabel },
    ...(repos ?? []).map((r) => ({ value: r.id, label: r.full_name })),
  ];
  const prSelectorLabel = t("configure.prSelectorLabel");
  const prOptions = [
    { value: "", label: prSelectorLabel },
    ...(pulls ?? []).map((p) => ({ value: p.id ?? "", label: `#${p.number} ${p.title}` })),
  ];

  // Computed over the CURRENT SELECTION only — `estimate.data.summary` now
  // aggregates every listed agent (since the hook is called with every
  // listed id, not just selected ones), so it can no longer be used directly
  // as "the selection's" summary.
  const selectedSummary = summarizeSelectedEstimate(selectedAgentIds, estimate.data?.agents);
  const summaryDurationText =
    selectedSummary.est_duration_ms != null
      ? formatDuration(selectedSummary.est_duration_ms)
      : t("configure.estimateUnknown");
  const summaryCostText =
    selectedSummary.est_cost_usd != null ? formatCost(selectedSummary.est_cost_usd) : t("configure.estimateUnknown");
  const summaryLine = t("configure.summaryLine", {
    count: selectedAgentIds.length,
    duration: summaryDurationText,
    cost: summaryCostText,
  });

  const launchDisabled = !prId || selectedAgentIds.length === 0 || launch.isPending;

  return (
    <AppShell crumb={[{ label: t("configure.title") }]}>
      <div style={s.page}>
        <h1 style={s.h1}>{t("configure.title")}</h1>

        <div style={s.selectorRow}>
          <div style={s.selectorCol}>
            <span style={s.label}>{repoLabel}</span>
            <SelectInput value={repoId ?? ""} onChange={handleRepoChange} options={repoOptions} mono={false} />
          </div>
          <div style={s.selectorCol}>
            <span style={s.label}>{prSelectorLabel}</span>
            <SelectInput
              value={prIdParam ?? ""}
              onChange={handlePrChange}
              options={prOptions}
              mono={false}
            />
          </div>
        </div>

        {!prId ? (
          <EmptyState icon="GitPullRequest" title={t("configure.pickPrFirst")} />
        ) : (
          <div style={s.agentsSection}>
            <div style={s.agentsHeader}>
              <span style={s.label}>{t("configure.agentsToRun")}</span>
              {(agents ?? []).length > 0 && (
                <button type="button" style={s.selectAllBtn} onClick={handleToggleAll}>
                  {allSelected ? t("picker.clear") : t("configure.selectAll")}
                </button>
              )}
            </div>
            {(agents ?? []).length === 0 ? (
              <EmptyState title={t("picker.emptyState")} />
            ) : (
              <div style={s.agentList}>
                {(agents as Agent[]).map((agent, i) => {
                  const checked = selectedAgentIds.includes(agent.id);
                  const entry = estimate.data?.agents.find((a) => a.agent_id === agent.id);
                  const estimateText = agentEstimateText(t, entry);
                  const theme = AGENT_THEMES[i % AGENT_THEMES.length]!;
                  const IconComp = Icon[theme.icon as keyof typeof Icon];
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      aria-label={agent.name}
                      onClick={() => toggleAgent(agent.id)}
                      style={s.agentCard(theme.accent, checked)}
                    >
                      <span style={s.cardCheck(theme.accent, checked)} aria-hidden="true">
                        {checked && <Icon.Check size={12} style={{ color: "#fff" }} />}
                      </span>
                      <span style={s.iconTile(theme.accent)} aria-hidden="true">
                        <IconComp size={16} />
                      </span>
                      <span style={s.cardText}>
                        <span style={s.cardName}>{agent.name}</span>
                        <span style={s.cardDesc}>{agent.description}</span>
                      </span>
                      <span style={s.cardEstimate}>{estimateText}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div style={s.launchRow}>
          <Button
            kind="primary"
            icon="Sparkles"
            disabled={launchDisabled}
            loading={launch.isPending}
            onClick={handleLaunch}
            aria-label={t("picker.runReviewAriaLabel", { count: selectedAgentIds.length })}
          >
            {launch.isPending ? t("configure.launching") : t("picker.runReview", { count: selectedAgentIds.length })}
          </Button>
          <div style={s.launchInfo}>
            {selectedAgentIds.length === 0 ? (
              <span style={s.noSelection}>{t("configure.noAgentsSelected")}</span>
            ) : (
              <>
                <span style={s.summaryLine}>{t("configure.estimateApprox", { value: summaryLine })}</span>
                <span style={s.approxNote}>{t("configure.estimatesApproximate")}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

export default ConfigureRun;
