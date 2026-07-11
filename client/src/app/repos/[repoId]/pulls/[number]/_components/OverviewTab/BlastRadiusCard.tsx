/* BlastRadiusCard — "what can this change break?" summary for the Overview
   tab. Reads purely from `repoIntel` + DB via GET /pulls/:id/blast (no LLM):
   a summary strip (symbols/callers/endpoints/cron counts), an honest
   partial/degraded badge, per-symbol expandable rows listing click-to-code
   callers + impacted endpoints/crons, and a "Prior PRs touching these files"
   accordion. Tree view is the default/required view; Graph is a stretch
   placeholder behind the same Chip toggle. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel, Badge, Chip, MonoLink, Icon, Skeleton } from "@devdigest/ui";
import type { DownstreamImpact } from "@devdigest/shared";
import { useBlastRadius } from "@/lib/hooks/pulls";
import { githubBlobUrl, githubPrUrl } from "@/lib/utils/githubUrls";

interface BlastRadiusCardProps {
  prId: string | null;
  repoFullName?: string | null;
  headSha?: string | null;
}

type ViewMode = "tree" | "graph";

/** METHOD from a "METHOD /path" endpoint string, for badge coloring. */
function methodOf(endpoint: string): string {
  return endpoint.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
}

const METHOD_COLOR: Record<string, { color: string; bg: string }> = {
  GET: { color: "var(--ok)", bg: "rgba(16, 185, 129, 0.12)" },
  POST: { color: "var(--accent-text, #6366f1)", bg: "var(--accent-bg, rgba(99, 102, 241, 0.12))" },
  PUT: { color: "var(--warn)", bg: "var(--warn-bg)" },
  PATCH: { color: "var(--warn)", bg: "var(--warn-bg)" },
  DELETE: { color: "var(--crit)", bg: "var(--crit-bg, rgba(239, 68, 68, 0.12))" },
};
const METHOD_COLOR_FALLBACK = { color: "var(--text-secondary)", bg: "var(--bg-hover)" };

function EndpointBadge({ endpoint }: { endpoint: string }) {
  const method = methodOf(endpoint);
  const c = METHOD_COLOR[method] ?? METHOD_COLOR_FALLBACK;
  return (
    <Badge color={c.color} bg={c.bg} mono>
      {endpoint}
    </Badge>
  );
}

function CronBadge({ cron, label }: { cron: string; label: string }) {
  return (
    <Badge color="var(--text-muted)" bg="var(--bg-hover)" icon="Clock" mono>
      {cron}
      {label ? ` · ${label}` : ""}
    </Badge>
  );
}

/** One expandable row for a changed symbol + its downstream callers. */
function SymbolRow({
  name,
  kind,
  impact,
  repoFullName,
  headSha,
  t,
}: {
  name: string;
  kind: string;
  impact: DownstreamImpact | undefined;
  repoFullName?: string | null;
  headSha?: string | null;
  t: ReturnType<typeof useTranslations>;
}) {
  const [open, setOpen] = React.useState(false);
  const callers = impact?.callers ?? [];
  const endpoints = impact?.endpoints_affected ?? [];
  const crons = impact?.crons_affected ?? [];

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOpen((o) => !o);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "9px 12px",
          cursor: "pointer",
          color: "var(--text-primary)",
        }}
      >
        <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
          {name}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{kind}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {t("callerCount", { count: callers.length })}
        </span>
        <Icon.ChevronDown
          size={14}
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s", color: "var(--text-muted)" }}
          aria-hidden="true"
        />
      </div>

      {open && (
        <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
          {callers.length > 0 ? (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              {callers.map((caller) => {
                const key = `${caller.file}:${caller.line}`;
                const href =
                  repoFullName && headSha
                    ? githubBlobUrl(repoFullName, headSha, caller.file, caller.line)
                    : undefined;
                return (
                  <li key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <Icon.CornerDownRight size={12} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
                    <MonoLink href={href}>{caller.file}:{caller.line}</MonoLink>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{caller.name}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>{t("noCallersForSymbol")}</p>
          )}

          {(endpoints.length > 0 || crons.length > 0) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {endpoints.map((e) => (
                <EndpointBadge key={e} endpoint={e} />
              ))}
              {crons.map((c) => (
                <CronBadge key={c} cron={c} label={t("cronBadge")} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function BlastRadiusCard({ prId, repoFullName, headSha }: BlastRadiusCardProps) {
  const t = useTranslations("blast");
  const { data, isLoading, isError } = useBlastRadius(prId);
  const [view, setView] = React.useState<ViewMode>("tree");
  const [historyOpen, setHistoryOpen] = React.useState(false);

  const viewToggle = (
    <div style={{ display: "flex", gap: 6 }}>
      <Chip icon="GitBranch" active={view === "tree"} onClick={() => setView("tree")}>
        {t("view.tree")}
      </Chip>
      <Chip icon="Workflow" active={view === "graph"} onClick={() => setView("graph")}>
        {t("view.graph")}
      </Chip>
    </div>
  );

  if (isLoading) {
    return (
      <Card pad style={{ marginBottom: 0 }}>
        <SectionLabel icon="Zap">{t("title")}</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton height={14} width="60%" />
          <Skeleton height={40} />
          <Skeleton height={40} />
        </div>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card pad style={{ marginBottom: 0 }}>
        <SectionLabel icon="Zap">{t("title")}</SectionLabel>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>{t("error")}</p>
      </Card>
    );
  }

  if (!data || data.changed_symbols.length === 0) {
    return (
      <Card pad style={{ marginBottom: 0 }}>
        <SectionLabel icon="Zap">{t("title")}</SectionLabel>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>{t("empty")}</p>
      </Card>
    );
  }

  const {
    changed_symbols: changedSymbols,
    downstream,
    impacted_endpoints: impactedEndpoints,
    impacted_crons: impactedCrons,
    status,
    degraded,
    history,
  } = data;

  const callerTotal = downstream.reduce((sum, d) => sum + d.callers.length, 0);
  const showDegraded = status !== "full" || degraded;
  const degradedKey = status !== "full" ? status : "degraded";
  const noDownstream = downstream.length === 0 || callerTotal === 0;
  const downstreamBySymbol = new Map(downstream.map((d) => [d.symbol, d]));

  // Only list symbols that actually have downstream callers — a symbol with
  // zero callers adds no signal, so it's dropped from the tree entirely.
  const symbolsWithCallers = changedSymbols.filter(
    (sym) => (downstreamBySymbol.get(sym.name)?.callers.length ?? 0) > 0,
  );

  return (
    <Card pad style={{ marginBottom: 0 }}>
      <SectionLabel icon="Zap" right={viewToggle}>
        {t("title")}
      </SectionLabel>

      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          {changedSymbols.length} {t("stat.symbols")} · {callerTotal} {t("stat.callers")} ·{" "}
          {impactedEndpoints.length} {t("stat.endpoints")} · {impactedCrons.length} {t("stat.crons")}
        </span>
        {showDegraded && (
          <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
            {t("degraded.badge")}
          </Badge>
        )}
      </div>

      {showDegraded && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px 0" }}>
          {t(`degraded.${degradedKey}`)}
        </p>
      )}

      {view === "graph" ? (
        <p
          role="status"
          aria-label={t("graph.ariaLabel")}
          style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}
        >
          {t("graph.empty")}
        </p>
      ) : noDownstream ? (
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
          {t("noDownstream", { count: changedSymbols.length })}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {symbolsWithCallers.map((sym) => (
            <SymbolRow
              key={`${sym.file}:${sym.kind}:${sym.name}`}
              name={sym.name}
              kind={sym.kind}
              impact={downstreamBySymbol.get(sym.name)}
              repoFullName={repoFullName}
              headSha={headSha}
              t={t}
            />
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => setHistoryOpen((o) => !o)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setHistoryOpen((o) => !o);
            }}
            style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
          >
            <Icon.History size={13} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              {t("priorPrs.title")}
            </span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {t("priorPrs.count", { count: history.length })}
            </span>
            <span style={{ flex: 1 }} />
            <Icon.ChevronDown
              size={13}
              style={{
                transform: historyOpen ? "rotate(180deg)" : "none",
                transition: "transform .15s",
                color: "var(--text-muted)",
              }}
              aria-hidden="true"
            />
          </div>

          {historyOpen && (
            <ul style={{ listStyle: "none", margin: "10px 0 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {history.map((pr) => {
                const href = repoFullName ? githubPrUrl(repoFullName, pr.pr_number) : undefined;
                return (
                  <li key={pr.pr_number} style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <MonoLink href={href}>#{pr.pr_number}</MonoLink>
                      <span>{pr.title}</span>
                    </div>
                    {pr.files_overlap.length > 0 && (
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                        {pr.files_overlap.join(", ")}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

export default BlastRadiusCard;
