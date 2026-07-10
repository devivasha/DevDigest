/* /repos/:repoId/project-context — discovery list of repo markdown docs
   (specs/docs/insights) with a Preview/Edit drawer. Read fresh on each run,
   NOT an index — see SummaryFooter for the AC-7 wording constraint. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Skeleton, EmptyState, ErrorState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useProjectContext } from "@/lib/hooks";
import { useActiveRepo, useRepoNotFound } from "@/lib/contexts/repoContext";
import { ApiError } from "@/lib/api";
import { SKELETON_ROWS, type DrawerSelection } from "./constants";
import { s } from "./styles";
import { DocumentRow } from "./_components/DocumentRow";
import { SummaryFooter } from "./_components/SummaryFooter";
import { DocumentDrawer } from "./_components/DocumentDrawer";

export function ProjectContextView() {
  const t = useTranslations("projectContext");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const { data, isLoading, isError, error, refetch } = useProjectContext(repoId);
  const [selection, setSelection] = React.useState<DrawerSelection | null>(null);

  const repoName = activeRepo?.full_name ?? repoId;

  // Stale/unknown :repoId → friendly empty state instead of a 404 error.
  if (repoNotFound) {
    return (
      <AppShell crumb={[{ label: repoName, mono: true }, { label: t("breadcrumb") }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={[{ label: repoName, mono: true }, { label: t("breadcrumb") }]}>
      <div style={s.pageHeader}>
        <h1 style={s.pageTitle}>{t("title")}</h1>
        <p style={s.pageSubtitle}>{t("subtitle")}</p>
      </div>

      <div style={s.card}>
        {isLoading ? (
          <div style={s.loadingStack}>
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <Skeleton key={i} height={32} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            title={t("errorTitle")}
            body={error instanceof ApiError ? error.message : t("errorBody")}
            onRetry={() => refetch()}
          />
        ) : !data || data.summary.clone_available === false ? (
          // Distinct not-available state — this is an expected condition
          // (no local clone yet), not an error (AC-5).
          <EmptyState icon="GitBranch" title={t("notAvailable.title")} body={t("notAvailable.body")} />
        ) : data.documents.length === 0 ? (
          <EmptyState icon="FileText" title={t("list.emptyTitle")} body={t("list.emptyBody")} />
        ) : (
          <>
            <div style={s.list}>
              {data.documents.map((doc) => (
                <DocumentRow
                  key={doc.path}
                  doc={doc}
                  onPreview={(path) => setSelection({ path, tab: "preview" })}
                />
              ))}
            </div>
            <SummaryFooter summary={data.summary} />
          </>
        )}
      </div>

      {selection && (
        <DocumentDrawer
          key={selection.path}
          repoId={repoId}
          path={selection.path}
          initialTab={selection.tab}
          onClose={() => setSelection(null)}
        />
      )}
    </AppShell>
  );
}
