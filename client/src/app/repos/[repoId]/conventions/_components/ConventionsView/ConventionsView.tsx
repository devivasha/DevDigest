"use client";

import React from "react";
import { useParams } from "next/navigation";
import { Button, EmptyState, ErrorState, Skeleton, Icon } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useActiveRepo } from "@/lib/repo-context";
import {
  useConventions,
  useScanConventions,
  useAcceptConvention,
  useUpdateConventionRule,
  useBuildConventionSkill,
} from "@/lib/hooks/conventions";
import type { ConventionCandidate } from "@devdigest/shared";
import { ConventionCard } from "../ConventionCard";
import { CreateSkillModal } from "../CreateSkillModal";

export function ConventionsView() {
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoName = activeRepo?.full_name?.split("/")[1] ?? repoId;

  const { data: candidates, isLoading, isError, refetch } = useConventions(repoId);
  const scan = useScanConventions();
  const accept = useAcceptConvention();
  const updateRule = useUpdateConventionRule();
  const buildSkill = useBuildConventionSkill(repoId);

  const [skillModalBody, setSkillModalBody] = React.useState<string | null>(null);

  const repoCloned = Boolean(activeRepo?.clone_path);

  const acceptedCount = (candidates ?? []).filter((c) => c.accepted).length;
  const totalCount = (candidates ?? []).length;

  async function handleScan() {
    await scan.mutateAsync(repoId);
  }

  async function handleCreateSkill() {
    const result = await buildSkill.refetch();
    if (result.data?.body) {
      setSkillModalBody(result.data.body);
    }
  }

  function handleDeselectAll() {
    for (const c of candidates ?? []) {
      if (c.accepted) {
        accept.mutate({ id: c.id, repoId, accepted: false });
      }
    }
  }

  return (
    <AppShell
      crumb={[{ label: "Skills Lab" }, { label: "Conventions" }]}
    >
      {skillModalBody !== null && (
        <CreateSkillModal
          body={skillModalBody}
          repoName={repoName}
          acceptedCount={acceptedCount}
          onClose={() => setSkillModalBody(null)}
        />
      )}

      <div style={{ padding: "24px 32px", maxWidth: 960, margin: "0 auto" }}>
        {/* Page header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 6 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
              Conventions in{" "}
              <span style={{ color: "var(--accent)" }}>{repoName}</span>
            </h1>
            {candidates && candidates.length > 0 && (
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 0" }}>
                Detected from {totalCount} candidate{totalCount !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            disabled={scan.isPending || !repoCloned}
            onClick={handleScan}
            title={!repoCloned ? "Repository must be indexed before scanning" : undefined}
          >
            {scan.isPending ? "Scanning…" : "Re-scan"}
          </Button>
        </div>

        {/* Toolbar */}
        {candidates && candidates.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 20,
              paddingTop: 8,
            }}
          >
            <button
              onClick={handleDeselectAll}
              style={{
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "3px 10px",
                fontSize: 12,
                cursor: "pointer",
                color: "var(--text-secondary)",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Icon.X size={10} />
              Deselect all
            </button>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {acceptedCount} of {totalCount} accepted
            </span>
            <div style={{ flex: 1 }} />
            <Button
              kind="primary"
              size="sm"
              icon="Sparkles"
              disabled={acceptedCount === 0 || buildSkill.isFetching}
              onClick={handleCreateSkill}
            >
              {buildSkill.isFetching ? "Building…" : "Create skill"}
            </Button>
          </div>
        )}

        {/* States */}
        {(isLoading || scan.isPending) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Skeleton height={160} />
            <Skeleton height={160} />
            <Skeleton height={160} />
          </div>
        )}

        {isError && !scan.isPending && (
          <ErrorState body="Could not load conventions." onRetry={() => refetch()} />
        )}

        {!isLoading && !isError && !scan.isPending && !repoCloned && (
          <EmptyState
            icon="ListChecks"
            title="Repository not indexed"
            body="This repository hasn't been cloned and indexed yet. Connect it in Settings → Repositories, then trigger a full index before scanning for conventions."
          />
        )}

        {!isLoading && !isError && !scan.isPending && repoCloned && candidates?.length === 0 && (
          <EmptyState
            icon="ListChecks"
            title="No conventions yet"
            body="Click Re-scan to analyse the repository and detect coding conventions automatically."
            cta="Scan now"
            onCta={handleScan}
          />
        )}

        {/* Convention cards grouped by category */}
        {!isLoading && !scan.isPending && repoCloned && candidates && candidates.length > 0 && (
          <CategoryGroups
            candidates={candidates}
            repoId={repoId}
            onAccept={(id) => accept.mutate({ id, repoId, accepted: true })}
            onReject={(id) => accept.mutate({ id, repoId, accepted: false })}
            onRuleChange={(id, rule) => updateRule.mutate({ id, repoId, rule })}
            pending={accept.isPending || updateRule.isPending}
          />
        )}
      </div>
    </AppShell>
  );
}

function CategoryGroups({
  candidates,
  repoId,
  onAccept,
  onReject,
  onRuleChange,
  pending,
}: {
  candidates: ConventionCandidate[];
  repoId: string;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onRuleChange: (id: string, rule: string) => void;
  pending?: boolean;
}) {
  const byCategory = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const arr = byCategory.get(c.category) ?? [];
    arr.push(c);
    byCategory.set(c.category, arr);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {Array.from(byCategory.entries()).map(([category, items]) => (
        <div key={category}>
          <h3
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: "0 0 10px",
            }}
          >
            {category}
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((c) => (
              <ConventionCard
                key={c.id}
                candidate={c}
                repoId={repoId}
                onAccept={() => onAccept(c.id)}
                onReject={() => onReject(c.id)}
                onRuleChange={(rule) => onRuleChange(c.id, rule)}
                pending={pending}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
